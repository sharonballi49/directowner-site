# Seller disclosures

Built October 1, 2026 from main 58ed54b (published buyer tools).

## Behavior

Seven explicit answers cover titled ownership, title status, outstanding loans/liens, damage history, mechanical/electrical issues, maintenance records, and independent-inspection willingness. New and edited listings require a choice in each form field, including unknown where appropriate. Known damage and issues require 10–1,000 characters of public detail. No IDs, title documents, loan statements, or contact information are requested in this section.

A shared renderer labels all statements **Seller reported—not independently verified** on public detail pages, the buyer plan, and the review queue. The comparison page includes seller-reported title, lien, and inspection answers. Missing legacy answers always say Not provided. No verification badge, insurance, warranty, escrow, or inspection service is implied.

## Database and rollout

Apply `supabase/migrations/20261001000100_seller_disclosures.sql` before merging the frontend to main. The additive migration creates one JSONB column with a strict shape/enum/text constraint, a pure validation helper, and one owner-only atomic editing RPC. Existing editing functions remain available for compatibility. Empty `{}` is accepted by the column for old clients/legacy listings; the new editor RPC requires all answers. Unknown is not treated as a clean title or absence of problems.

The RPC validates vehicle fields, checks authenticated ownership and editable status, and updates ordinary details plus disclosures in one transaction. It cannot set ownership, payment plan, publication status, or review decisions. The existing broad review trigger automatically invalidates an approved/rejected submission on disclosure edits, and increments its revision. Reviewer RPCs already return the table row type, so they include the new field without widening reviewer access.

Supabase's default function grants were observed during the live rollback-only compatibility test. The RPC explicitly revokes execution from both PUBLIC and anon, then grants authenticated execution. Tests simulate those default grants. The validation helper reads no data and can be called by database roles that need to evaluate the column constraint.

A rollback-only migration test in the actual project returned true for legacy compatibility, invalid-answer rejection, anonymous edit blocking, and authenticated edit availability. No changes from those dry runs were committed.

## Validation

`npm test` covers seller form validation, same-insert creation, same-RPC editing, retained answers on failed saves, escaped seller text, legacy rendering, public/reviewer display, backend shape limits, ownership, anonymous denial, atomic failure, sold-listing rejection, and edit re-review, plus the existing marketplace/review/report/buyer-tools suite.

A production deployment must apply the additive migration, confirm the column constraint and function permissions, publish the UI, then verify the live form. Do not publish a BMW test listing to demonstrate the feature. No paid services are needed.

## Rollback

Revert the frontend PR if necessary. Keep the additive column/functions so existing submitted answers are retained. Do not drop the column or erase seller responses as a routine rollback. Prior frontend clients ignore the field and continue to work.
