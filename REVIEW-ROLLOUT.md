# Listing review release

This release is prepared for deployment; its new migration is not yet applied. The previous safety release (PR #1 and `20260930000100`) is already live. Live inspection on September 30 confirmed a PUBLIC vehicle-photos bucket and owner-checked SECURITY DEFINER edit/pause/resume/sold functions. Existing checkout supports Free activation through the service role.

## User flow

1. A seller creates a draft and adds photos, then chooses a plan. Free activation or successful paid checkout sets the existing lifecycle status to `active`, but a separate review gate keeps it private.
2. The listing appears in the reviewer's private queue. Approval publishes an active listing. Rejection keeps it private and shows an actionable reason in My Listings.
3. Changing submitted details or photo references invalidates the decision and queues another review. Pausing, resuming, and marking sold continue to work; resuming never bypasses the review gate.
4. Signed-in buyers can report a public listing. One open report per buyer/listing is idempotent; new reports are limited to five in 24 hours with a per-user transaction lock. After a report is resolved, additional information goes to support rather than silently creating an invisible report.
5. Reviewers can reject and hide a reported listing, then record a separate report resolution. All approve/reject decisions record reviewer, version, time, and seller-facing rejection reason. Version checks reject stale decisions.

The Review Listings link appears only on the dashboard of an authorized reviewer. Every reviewer RPC also checks authorization. It is not a public navigation item. Approvals are content review, not identity/ownership/condition certification.

## Deploy in this order

1. Review and apply `supabase/migrations/20260930000200_listing_review.sql` to the confirmed DirectOwner project. It runs in one transaction. Existing active/paused listings enter review, including existing inventory; the BMW remains a private test and is excluded from review queues. No rows, files, or payments are deleted. No reviewer is granted automatically.
2. Obtain explicit approval for the exact DirectOwner user account to receive reviewer access. Match that account in `auth.users`; insert only its UUID into `public.listing_reviewers`. Use trusted SQL administration, never a browser-supplied role or user-editable metadata. This grants access to private listing content and buyer reports.
3. Merge the website changes and verify the Vercel production deployment. Database must precede frontend: the new pages select the moderation columns and fail closed if they are absent.
4. Verify signed-out users cannot use reviewer RPCs, the ordinary seller cannot self-approve, and the approved reviewer can load both queues. Use a clearly marked disposable listing for any live seller-flow test, with separate approval before publishing it to buyers. Do not approve the BMW test or charge a real payment for testing.
5. Confirm active nonapproved records are hidden through the public API while still visible to their owners. Check Free submission, review approval/rejection, feedback, edit re-review, reports and sign-out. Local automated tests cover these rules; no real Stripe charge was performed.

No Edge Function redeployment is needed. Both current activation paths are intercepted by the database review trigger. Paid-plan purchases still occur before content review, so the plan page discloses that payment does not guarantee approval and directs rejected paid sellers to support. This release does not implement refunds or change pricing.

## Photo integrity

New restrictive storage policies prevent inserting a path already referenced by a listing, overwriting vehicle-photo objects, or deleting referenced photos. The editor detaches a photo first (invalidating review) and then deletes its object. This prevents a seller from replacing the bytes under an approved photo URL without a new review. Existing own-folder storage policies remain in force.

The vehicle-photo bucket remains PUBLIC. Hiding a listing does not revoke previously known photo URLs. Never upload identity documents, titles with personal data, or payment details to that bucket. Private evidence uploads are not part of this release.

## Validation and recovery

`npm test`: 19 automated tests, including isolated PostgreSQL-compatible role/RLS/trigger/storage checks and DOM workflow tests. These do not constitute an end-to-end Stripe or production-browser seller test.

Keep the moderation gate enabled if a UI issue occurs; it fails closed. A previous frontend build can be restored temporarily, but it will not display review status or reviewer actions. Restore the review UI or use audited reviewer RPCs from trusted administration to process the queue. Do not drop the approval policy merely to restore visibility. The new migration is intentionally one-time; do not rerun it after success.
