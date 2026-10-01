# Refund synchronization

The deployed webhook handled successful and failed checkout events but ignored refunds. The October 1 sandbox payment therefore stayed paid in DirectOwner after Stripe refunded it.

## Behavior

- Verify Stripe signatures, then retrieve current Checkout Session and PaymentIntent data using the server-side Stripe key.
- Sum only succeeded refunds, across all pages of the charge's refund list. Pending or failed refunds do not remove benefits.
- Atomically validate stored checkout identity, listing, owner, package, amount, currency and payment intent before changing payment and listing state.
- Track partial refunded amounts while retaining paid status and benefits. Full refunds mark the payment refunded, remove its package and pause active listings when no other purchase backs the current package. Preserve sold/rejected states and newer pending purchases.
- Never reduce the successfully refunded amount on older/repeated events. Replaying checkout completion retrieves current refunds and cannot restore refunded benefits.
- The SQL function is executable only by service_role. Sellers cannot mark their own payments paid/refunded.
- Existing listing review and test-privacy controls remain in effect.

## Deployment order

1. Apply `supabase/migrations/20261001000200_payment_refunds.sql`.
2. Deploy `supabase/functions/stripe-webhook/index.ts`, retaining signature-based authentication and the existing webhook secret. Do not enable gateway JWT verification for Stripe deliveries.
3. In the existing Stripe event destination, retain checkout.session.completed and checkout.session.async_payment_failed; include checkout.session.async_payment_succeeded, charge.refunded, refund.created, refund.updated, and refund.failed. The handler also accepts legacy charge.refund.updated.
4. Resend the October 1 sandbox charge.refunded event, or its original checkout.session.completed event. Both reconcile the current Stripe refund state. Verify the exact test listing a71a3b9b-c2e0-4bc6-bbc8-a3d3cd82ba94 has payment refunded, refunded_amount_cents=999, plan free, status paused, is_test=true. Do not manually mark it refunded as a substitute for testing webhook delivery.
5. Repeat a delivery and verify the state stays unchanged. Future real payments require separately verified live Stripe activation, configuration, and event delivery.

## Verification

`npm test` includes database permission, checkout mismatch, partial/full refund, duplicate/stale delivery, refund-before-checkout, other paid package/newer package, sold-state preservation and atomic rollback tests. Webhook tests cover signature rejection, current-state reconciliation, successful-only refund sums, asynchronous success, charge/refund event variants and retry responses on failures.
