import Stripe from 'npm:stripe@^22';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
const stripe = stripeKey ? new Stripe(stripeKey) : null;
const cryptoProvider = Stripe.createSubtleCryptoProvider();
const json = (body: unknown, status = 200) => Response.json(body, { status });
const objectId = (value: any): string | null => typeof value === 'string' ? value : value?.id ?? null;

// Fetch current Stripe state, not the event snapshot. Replay of a pre-refund checkout
// must reconcile its refund rather than marking the payment paid again.
async function syncSession(admin: any, sessionId: string) {
  const session = await stripe!.checkout.sessions.retrieve(sessionId);
  const meta = session.metadata;
  if (!meta?.paymentId || !meta?.listingId || !meta?.ownerId || !meta?.plan) return;
  if (session.mode !== 'payment' || session.payment_status !== 'paid') return;
  const intentId = objectId(session.payment_intent);
  if (!intentId) throw new Error('Paid session has no payment intent');
  const intent = await stripe!.paymentIntents.retrieve(intentId);
  if (intent.status !== 'succeeded' || intent.currency !== session.currency || intent.amount_received !== session.amount_total
    || intent.livemode !== session.livemode) throw new Error('Checkout and payment intent mismatch');
  const chargeId = objectId(intent.latest_charge);
  if (!chargeId) throw new Error('Paid intent has no charge');
  // Paginate: a charge can have more refunds than an expanded snapshot includes.
  let refunded = 0;
  for await (const refund of stripe!.refunds.list({ charge: chargeId, limit: 100 })) {
    if (refund.status === 'succeeded') refunded += refund.amount;
  }
  const { error } = await admin.rpc('sync_stripe_payment', {
    p_payment_id: meta.paymentId, p_listing_id: meta.listingId, p_owner_id: meta.ownerId,
    p_plan: meta.plan, p_session_id: session.id, p_intent_id: intentId,
    p_amount: session.amount_total, p_currency: session.currency, p_refunded: refunded,
  });
  if (error) throw new Error(`Payment synchronization failed: ${error.message}`);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!stripe || !webhookSecret) return json({ error: 'Stripe webhook is not configured' }, 500);
  const signature = req.headers.get('Stripe-Signature');
  if (!signature) return json({ error: 'Missing Stripe signature' }, 400);
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(await req.text(), signature, webhookSecret, undefined, cryptoProvider);
  } catch {
    return json({ error: 'Invalid Stripe signature' }, 400);
  }
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  try {
    if (['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)) {
      await syncSession(admin, event.data.object.id);
    } else if (['charge.refunded','refund.created','refund.updated','refund.failed','charge.refund.updated'].includes(event.type)) {
      const object = event.data.object as any;
      let intentId = objectId(object.payment_intent);
      if (!intentId && object.charge) {
        intentId = objectId((await stripe.charges.retrieve(objectId(object.charge)!)).payment_intent);
      }
      if (intentId) {
        // Session metadata also handles refunds arriving before the checkout webhook.
        for await (const session of stripe.checkout.sessions.list({ payment_intent: intentId, limit: 100 })) {
          await syncSession(admin, session.id);
        }
      }
    } else if (event.type === 'checkout.session.async_payment_failed') {
      const session = await stripe.checkout.sessions.retrieve(event.data.object.id);
      if (session.payment_status === 'paid') {
        await syncSession(admin, session.id);
      } else if (session.metadata?.paymentId) {
        const { error } = await admin.from('payments').update({ status: 'failed' })
          .eq('id', session.metadata.paymentId).eq('stripe_checkout_session_id', session.id).eq('status', 'pending');
        if (error) throw error;
      }
    }
    return json({ received: true });
  } catch (error) {
    console.error('Stripe synchronization failed', event.id, error instanceof Error ? error.message : 'Database failure');
    // Non-2xx is required so Stripe retries transient API/database failures.
    return json({ error: 'Payment synchronization failed; retry required' }, 500);
  }
});
