import Stripe from 'npm:stripe@^22';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? 'https://www.getdirectowner.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PLANS = {
  free: { amountCents: 0, label: 'Free listing' },
  featured: { amountCents: 999, label: 'Featured listing' },
  premium: { amountCents: 2999, label: 'Premium listing' },
} as const;

type Plan = keyof typeof PLANS;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
  );

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return json({ error: 'Authentication required' }, 401);

  const payload = await req.json().catch(() => null);
  const listingId = payload?.listingId;
  const plan = payload?.plan as Plan;
  if (typeof listingId !== 'string' || !(plan in PLANS)) {
    return json({ error: 'A valid listingId and plan are required' }, 400);
  }

  const selectedPlan = PLANS[plan];
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: listing, error: listingError } = await admin
    .from('listings')
    .select('id, owner_id, title, plan, status')
    .eq('id', listingId)
    .eq('owner_id', user.id)
    .single();

  if (listingError || !listing) return json({ error: 'Listing not found' }, 404);
  if (!['draft', 'pending_payment'].includes(listing.status)) {
    return json({ error: 'Listing is not eligible for payment' }, 409);
  }

  if (plan === 'free') {
    const { error } = await admin.from('listings').update({ plan, status: 'active' }).eq('id', listingId);
    if (error) return json({ error: 'Unable to activate free listing' }, 500);
    return json({ free: true, listingId });
  }

  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2025-06-30.basil' });
  const { data: payment, error: paymentError } = await admin
    .from('payments')
    .insert({ listing_id: listingId, owner_id: user.id, plan, amount_cents: selectedPlan.amountCents })
    .select('id')
    .single();

  if (paymentError || !payment) return json({ error: 'Unable to create payment record' }, 500);

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: { name: selectedPlan.label, description: `DirectOwner listing: ${listing.title}` },
        unit_amount: selectedPlan.amountCents,
      },
      quantity: 1,
    }],
    customer_email: user.email,
    metadata: { paymentId: payment.id, listingId, ownerId: user.id, plan },
    success_url: `${Deno.env.get('SITE_URL') ?? 'https://www.getdirectowner.com'}/sell.html?payment=success`,
    cancel_url: `${Deno.env.get('SITE_URL') ?? 'https://www.getdirectowner.com'}/sell.html?payment=cancelled`,
  });

  await admin.from('payments').update({ stripe_checkout_session_id: session.id }).eq('id', payment.id);
  await admin.from('listings').update({ plan, status: 'pending_payment' }).eq('id', listingId);

  return json({ checkoutUrl: session.url });
});
