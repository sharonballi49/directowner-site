import Stripe from 'npm:stripe@^22';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2025-06-30.basil' });
const cryptoProvider = Stripe.createSubtleCryptoProvider();

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const signature = req.headers.get('Stripe-Signature');
  if (!signature) return new Response('Missing signature', { status: 400 });

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      Deno.env.get('STRIPE_WEBHOOK_SECRET')!,
      undefined,
      cryptoProvider,
    );
  } catch (error) {
    console.error('Stripe signature verification failed', error);
    return new Response('Invalid signature', { status: 400 });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const paymentId = session.metadata?.paymentId;
    const listingId = session.metadata?.listingId;
    if (!paymentId || !listingId || session.payment_status !== 'paid') {
      return Response.json({ received: true });
    }

    // Idempotent updates: repeated webhook deliveries leave the same final state.
    const { error: paymentError } = await admin
      .from('payments')
      .update({
        status: 'paid',
        stripe_payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : null,
      })
      .eq('id', paymentId)
      .eq('status', 'pending');

    if (paymentError) {
      console.error('Payment update failed', paymentError);
      return new Response('Payment update failed', { status: 500 });
    }

    const { error: listingError } = await admin
      .from('listings')
      .update({ status: 'active' })
      .eq('id', listingId)
      .eq('status', 'pending_payment');

    if (listingError) {
      console.error('Listing activation failed', listingError);
      return new Response('Listing activation failed', { status: 500 });
    }
  }

  if (event.type === 'checkout.session.async_payment_failed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const paymentId = session.metadata?.paymentId;
    if (paymentId) {
      await admin.from('payments').update({ status: 'failed' }).eq('id', paymentId).eq('status', 'pending');
    }
  }

  return Response.json({ received: true });
});
