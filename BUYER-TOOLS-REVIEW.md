# DirectOwner buyer tools and marketplace review

Reviewed October 1, 2026. This feature branch starts from main 9d8dd17 (merged listing review and reporting).

## Findings

The live homepage and browse page were inspected in the browser. Public inventory currently shows zero listings and an honest coming-soon state. Content review and private reports already exist. Seller introductions still depend on an email to support. That creates manual work and a slower path than an integrated inbox. Paid-plan benefits, payment completion, and customer demand have not been established by this review.

Facebook already supports vehicle discovery, seller ratings, and messaging. Meta also announced collections and tests of AI vehicle insights and suggested questions in November 2025; March 2026 updates add AI listing assistance, replies, and richer seller profiles. July 2026 materials describe a dedicated Seller app with inventory and performance tools. Availability can vary by account and region. This review used Meta's public documentation, not a signed-in Facebook buyer transaction. It does not establish that Facebook lacks any particular feature in every market.

DirectOwner should differentiate through a coherent private-vehicle buying process: visible unknowns, explicit owner disclosures, independent checks, useful inquiries, and responsive support. Do not claim verified owners, verified titles, fraud prevention, or superiority in measured safety without operational evidence.

## Implemented in this branch

- Browser-local vehicle buying plans with six self-recorded checks; clearly separate from platform verification.
- Four-item cost worksheet, cents-based arithmetic, and explicit unknown amounts. No guessed tax rate or automated quote.
- Up to three saved vehicle IDs; current approved public listing information is fetched again on opening comparison or a plan. No cached listing details shown if a listing is unavailable.
- Checks reset when the existing server-controlled review_revision changes. Cost estimates remain for the buyer to review.
- Selectable questions, read-only preview, copy fallback, and an explicit mailto support action. No messages sent automatically.
- General plan works without a listing or authentication; helpful while real inventory is being recruited.
- Print stylesheet, keyboard-labelled controls, mobile layout, resource links, and buyer-tools entry points on home, browse, detail, guide, and safety pages.
- Local-storage disclosure and clear-data control. Data is shared by users of the same browser, is not encrypted account storage, and does not sync between devices or tabs. No identity documents, titles, VINs, free-text notes, or payment information are collected by this tool.

## Validation and rollout

Run `npm test`: includes the existing database security/review/report tests and new buyer-workspace tests for arithmetic, unknown costs, checklist revision resets, hidden/test listings, failures, hostile seller text, limits, and storage failure. Existing Supabase SELECT rules and the already-deployed review_revision column are reused. No database migration, paid API, new tracking service, identity provider, or new infrastructure is needed.

A public preview may read existing approved listings, but tests use fixtures and do not create or publish a live test vehicle. Comparison and vehicle-specific behavior are covered with fixtures because there are no public live vehicles. Merge the reviewed branch to main to use the existing Vercel deployment. Revert this PR to roll back the UI; the browser storage key can remain harmlessly unused. Production publication is a separate step from preparing this review.

## Recommended next work

1. Structured seller disclosures: titled-owner attestation, title brand, lien, known damage, mechanical issues, service records, inspection willingness. All must say seller-reported. Include unknown choices, edit re-review, and backend validation.
2. Authenticated structured inquiries with private RLS, rate limits, abuse reporting, and seller responses. Define support ownership and response expectations first.
3. Seller availability reconfirmation and stale-listing expiry, with timestamps that actually describe availability. Requires server scheduling and notifications.
4. Optional third-party identity and inspection services only after provider selection, cost/privacy review, retention policy, and explicit badge definitions. Never collect identity documents in the current public photo bucket.
5. Verify paid placement and measurable seller value before promoting paid upgrades. Recruit real sellers in a focused local market and track useful inquiries, not just visits.

## Primary references

- https://about.fb.com/news/2025/11/facebook-marketplace-gets-a-glow-up/
- https://about.fb.com/news/2026/03/facebook-marketplace-new-meta-ai-tools-make-selling-faster-and-easier/amp/
- https://about.fb.com/news/2026/07/introducing-seller-app-facebook-marketplace/
- https://www.facebook.com/help/915385548593204/
- https://www.nhtsa.gov/recalls
- https://vehiclehistory.bja.ojp.gov/nmvtis_vehiclehistory
- https://www.txdmv.gov/motorists/buying-or-selling-a-vehicle
