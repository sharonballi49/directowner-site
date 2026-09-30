# DirectOwner inventory and safety improvements

Prepared September 30, 2026 on `fix/public-inventory-and-buyer-flow`.

## Included

- Homepage and Browse share active inventory, exclude the known BMW test ID, and show honest empty/error states. The BMW is not deleted or changed by the frontend.
- Homepage search carries vehicle type, keyword and location to Browse. Browse adds a maximum budget and corrects minimum-price comparisons from dollars to cents.
- Listing inquiry labels explain that email goes to support. Each public detail page has a listing-specific report email.
- Listing fields interpolated into HTML are escaped. Hidden loading/error content stays hidden.
- Mobile navigation works across the site, including sign-in, with accessible expanded state and Escape support.
- Selling instructions explain draft/plan/publish behavior. Trust language does not imply that published listings have verified identity or ownership.
- A separate SQL migration restricts access to the test listing to its owner and blocks client-side publication/paid-plan spoofing. Trusted server functions retain control of status and plan.

## Validation

Run `npm ci` and `npm test`. Eleven tests cover inventory visibility, search and budgets, real detail links, empty/error states, HTML injection, reporting, menus, local links, and database authorization using an isolated PGlite database. No live listings, payments, messages, or account data were changed during testing.

JavaScript syntax and `git diff --check` also passed. Desktop/mobile rendering still needs preview verification after upload; DOM tests are not a visual or end-to-end production audit.

## Deployment

1. Apply the branch to the GitHub repository and use the hosting provider's preview deployment to inspect homepage, Browse, seller form and mobile menu. The repository's About link points to Vercel; the actual production connection needs confirmation in the account.
2. In Supabase, compare the live schema/policies with the repository, then apply only `supabase/migrations/20260930000100_keep_test_listing_private.sql`. Do not re-run the initial migration on an existing database. Frontend changes work before the new migration, but frontend filtering alone does not make a database record private.
3. Verify anonymously that the BMW is absent, and as its owner that it remains available in My Listings. Check normal draft saving and trusted free/paid publication.
4. Verify listing photos. The original migration configures a private bucket while current frontend code uses public photo URLs. Preserve the live configuration until it is inspected; never put identity/ownership documents in a public vehicle-photo bucket.

The checked-in backend is incomplete relative to the frontend: fields such as mileage and seller_location, and functions used for editing/status management, are not fully represented in the initial migration. Do not treat this repository as a complete backup of the live Supabase configuration.

## Next safety work

Build these capabilities before claiming verified listings or a safer marketplace than a competitor:

- A server-enforced moderation state and an admin review queue. Successful listing payment must not bypass safety review. Edits to approved listings should trigger re-review of material changes.
- Verified email/phone, followed by a suitable identity provider and separate ownership evidence. Display narrowly defined badges and review dates. Keep identity documents out of public listings and collect only what is necessary.
- Authenticated private messaging, block/report controls, rate limits, and a moderation audit trail. The current reporting button opens email and does not create a moderation case automatically.
- Duplicate VIN/photo and suspicious-price checks, backed by human review and an appeal process.
- Clear title/lien/damage disclosures and independent inspection options. Payment and vehicle closing should use vetted providers with an explicit dispute process.
- Monitor confirmed scam reports, response time, repeat offenders and report outcomes. Comparative safety claims need evidence.

Before charging for promotion, reconcile the visible price ranges with server prices ($9.99 Featured and $29.99 Premium in the checked-in function), define duration, and implement the promised placement. This change does not alter pricing or payment processing.
