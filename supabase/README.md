# DirectOwner Supabase + Stripe backend

This folder contains the initial backend foundation for DirectOwner.

## What is included

- Supabase SQL migration for listings, payments, row-level security, and private vehicle-photo storage.
- Authenticated `create-checkout-session` Edge Function.
- Signature-verified `stripe-webhook` Edge Function.
- Stripe plan pricing enforced on the server:
  - Free: $0.00
  - Featured: $9.99
  - Premium: $29.99

The current paid prices are the starting prices from the site's pricing ranges. Before launch, decide whether Featured and Premium should have fixed prices or selectable price tiers, then update the server-side plan table—not client-side form values.

## Required setup before deployment

1. Create a Supabase project.
2. Run the SQL migration in `migrations/` using the Supabase SQL Editor or Supabase CLI.
3. Replace the placeholder `project_id` in `config.toml`.
4. Create or connect a Stripe account and keep Stripe in test mode initially.
5. Configure these Supabase Edge Function secrets:
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `SUPABASE_SERVICE_ROLE_KEY` (keep server-side only)
   - `SITE_URL`
   - `ALLOWED_ORIGIN`
6. Deploy both functions.
7. Configure a Stripe webhook endpoint pointing to:
   `https://YOUR_PROJECT_ID.supabase.co/functions/v1/stripe-webhook`
8. Subscribe at minimum to:
   - `checkout.session.completed`
   - `checkout.session.async_payment_failed`
9. Test successful, cancelled, failed, and repeated webhook deliveries before enabling live mode.

## Security notes

- Never put Stripe secret keys or the Supabase service-role key in HTML, JavaScript served by GitHub Pages, or GitHub Actions logs.
- Do not trust an amount or price sent by the browser; the Edge Function selects the amount from its own plan table.
- Stripe webhook requests are verified against the raw request body and signing secret.
- Payment fulfillment occurs from the webhook, not from the browser success page.
- Review and test RLS policies, upload size/type limits, moderation, rate limiting, backups, and account recovery before launch.

This is a backend foundation, not a production launch certification. Run security testing and verify the configuration in your own Supabase and Stripe accounts before accepting real money.
