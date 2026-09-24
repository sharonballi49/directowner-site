import Stripe from 'npm:stripe@^22';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const allowedOrigin = Deno.env.get('ALLOWED_ORIGIN') ?? 'https://www.getdirectowner.com';
const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Credentials': 'true',
};

const PLANS = {
  free: { amountCents: 0, label: 'Free listing' },
  featured: { amountCents: 999, label: 'Featured listing' },
  premium: { amountCents: 2999, label: 'Premium listing' },
} as const;

type Plan = keyof typeof PLANS;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json({ error: 'Supabase server configuration is incomplete.' }, 500);
    }

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return json({ error: 'Authentication required. Please sign in again.' }, 401);

    const payload = await req.json().catch(() => null);
    const listingId = payload?.listingId;
    const plan = payload?.plan as Plan;
    if (typeof listingId !== 'string' || !(plan in PLANS)) {
      return json({ error: 'A valid listingId and plan are required.' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: listing, error: listingError } = await admin
      .from('listings')
      .select('id, owner_id, title, plan, status')
      .eq('id', listingId)
      .eq('owner_id', user.id)
      .single();

    if (listingError || !listing) return json({ error: `Listing lookup failed: ${listingError?.message ?? 'listing not found'}` }, 404);
    if (!['draft', 'pending_payment'].includes(listing.status)) {
      return json({ error: `Listing is not eligible for payment. Current status: ${listing.status}` }, 409);
    }

    const selectedPlan = PLANS[plan];
    if (plan === 'free') {
      const { error } = await admin.from('listings').update({ plan, status: 'active' }).eq('id', listingId);
      if (error) return json({ error: `Unable to activate free listing: ${error.message}` }, 500);
      return json({ free: true, listingId });
    }

    if (!stripeSecretKey) {
      return json({ error: 'Stripe is not configured yet. Add STRIPE_SECRET_KEY to Supabase Edge Function secrets.' }, 200);
    }

    const stripe = new Stripe(stripeSecretKey);
    const siteUrl = Deno.env.get('SITE_URL') ?? 'https://www.getdirectowner.com';

    const { data: existingPayment, error: existingPaymentError } = await admin
      .from('payments')
      .select('id, stripe_checkout_session_id, status')
      .eq('listing_id', listingId)
      .eq('owner_id', user.id)
      .eq('plan', plan)
      .eq('status', 'pending')
      .not('stripe_checkout_session_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingPaymentError) console.error('Existing payment lookup failed:', existingPaymentError);

    if (existingPayment?.stripe_checkout_session_id) {
      try {
        const existingSession = await stripe.checkout.sessions.retrieve(existingPayment.stripe_checkout_session_id);
        if (existingSession.status === 'open' && existingSession.payment_status === 'unpaid' && existingSession.url) {
          return json({ checkoutUrl: existingSession.url, reused: true });
        }
      } catch (stripeError) {
        console.error('Existing Stripe session lookup failed:', stripeError);
      }
    }

    let paymentId = existingPayment?.id;
    if (!paymentId) {
      const { data: payment, error: paymentError } = await admin
        .from('payments')
        .insert({ listing_id: listingId, owner_id: user.id, plan, amount_cents: selectedPlan.amountCents })
        .select('id')
        .single();

      if (paymentError || !payment) return json({ error: `Unable to create payment record: ${paymentError?.message ?? 'unknown database error'}` }, 500);
      paymentId = payment.id;
    } else {
      const { error: paymentResetError } = await admin
        .from('payments')
        .update({ amount_cents: selectedPlan.amountCents, stripe_checkout_session_id: null })
        .eq('id', paymentId);
      if (paymentResetError) console.error('Existing payment reset failed:', paymentResetError);
    }

    let session;
    try {
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: { name: selectedPlan.label, description: `DirectOwner listing: ${listing.title}` },
            unit_amount: selectedPlan.amountCents,
          },
          quantity: 1,
        }],
        customer_email: user.email ?? undefined,
        metadata: { paymentId, listingId, ownerId: user.id, plan },
        success_url: `${siteUrl}/sell.html?payment=success`,
        cancel_url: `${siteUrl}/sell.html?payment=cancelled`,
      });
    } catch (stripeError) {
      const message = stripeError instanceof Error ? stripeError.message : 'Stripe rejected the checkout request.';
      console.error('Stripe checkout creation failed:', stripeError);
      return json({ error: `Stripe checkout creation failed: ${message}` }, 200);
    }

    const { error: paymentUpdateError } = await admin.from('payments').update({ stripe_checkout_session_id: session.id }).eq('id', paymentId);
    if (paymentUpdateError) console.error('Payment update failed:', paymentUpdateError);
    const { error: listingUpdateError } = await admin.from('listings').update({ plan, status: 'pending_payment' }).eq('id', listingId);
    if (listingUpdateError) console.error('Listing update failed:', listingUpdateError);

    return json({ checkoutUrl: session.url });
  } catch (error) {
    console.error('create-checkout-session error:', error);
    return json({ error: error instanceof Error ? error.message : 'Unexpected checkout service error.' }, 200);
  }
});
