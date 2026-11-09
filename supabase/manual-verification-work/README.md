# Manual verification — Holup experiment, NOT deployed

Creator verification is gold and person ID verification diamond blue. The
existing administrator badge is retained and the admin account is exempt from
application thresholds. A reviewer makes the final decision. Didit is for
admin-requested live capture for both categories; successful ID, liveness and
face match are required before an admin assigns either badge. Gold recognizes
a creator; diamond blue indicates person ID verification. Each account may
hold only one category.

## Current prototype
- `01_verification_experiment.sql`: eligibility, cases, private review text,
  case-specific capture evidence and admin decisions/audit. See counts below.
- `02_capture_experiment.sql`: admin requests capture, applicant session claim,
  provider-session binding, case-bound result, and state. Edge prototype
  `edge/manual-didit.ts` validates a signed-in actor via Supabase Auth, creates
  a hosted session and fetches the provider decision itself, checking the
  session/workflow/vendor binding, live environment and approved ID, liveness,
  face match. It does not persist the provider's raw response or auto-award.
  The user or reviewer can tap Check capture status; a signed session webhook
  prototype in `07_capture_webhook_experiment.sql` and
  `edge/manual-didit-webhook.ts` also records results automatically. Results
  remain evidence only: they never assign badges without an admin action.
- `03_private_evidence_experiment.sql` and `edge/manual-evidence.ts` prototype
  image attachments in a new private bucket with server-mediated, authorized
  reads, admin-read audit, 5 MB limits and JPEG/PNG/WebP signature checks.
  Images are not posted in the public media bucket. The app can upload images
  and display them in the case. This code is NOT sufficient to claim security.
- `05_evidence_deletion_experiment.sql` and cleanup edge prototype make deleted
  evidence inaccessible first and queue actual object deletion durably, even
  when an account/case is removed. A protected scheduler must actually run the
  worker and be monitored. The API reports whether bytes were deleted or queued.
- `04_retire_legacy_autobadge.sql` sketches stopping old automatic badge writes
  without removing existing badges. Must be coordinated with existing edge
  routes, pending sessions, older clients and the app release; it is not live.
- `06_batch_award_experiment.sql` counts ready creator/person cases and assigns
  all ready cases in one confirmed admin action, mapping each category to the
  right badge, with a per-case audit and server-side result recheck. Counts are
  advisory; cases arriving after the batch snapshot wait for the next action.
- Settings/admin screens are connected to these *experimental* RPCs and edge
  functions. The admin may request Didit, ask questions and decide; applicant
  can reply, attach an image and open/check their requested capture. None of
  these functions currently exists on the production backend.

## Counts (proposed; require review before release)
Current, non-Circle posts; media means any current post with a media URL; text
means no media and nonempty body. Crushes count current post reactions in the
same way the app displays the post's Crushes count. Video uses filename extension, which may misclassify imports
and unusual URLs. Add Ups count active, onboarded, unblocked incoming accounts
in pending/accepted state. Creator weekly activity requires 3 posts in each of
four rolling non-overlapping 7-day periods. The case records eligibility at
application time. The current proposal excludes Circle posts but includes other
private posts; confirm this interpretation and review fraud/moderation rules.

## Required before launch
- Private uploads contain sensitive personal data. File signature checks do not
  sanitize images or detect malware. Add safe image decoding/re-encoding or
  scanning, review every storage policy (including broad legacy policies),
  enforce request/rate limits and check case isolation and signed-token/session
  behavior. Data URLs live in client memory and may be cached by image layers;
  verify native/web handling and secure removal. No guarantee is made yet.
- Establish a privacy notice, lawful basis and retention period for ID/selfie
  images and text; enforce it automatically. Deploy and monitor a secret-gated
  cleanup scheduler; cover abandoned uploads, incomplete reservations, failures,
  backups and data-subject requests. Never claim deletion before bytes are gone.
- Configure a dedicated production Didit workflow with ID, liveness and face
  match, live environment, and secure access to provider evidence for reviewers.
  The proposed poll and signed session webhook check the documented result
  shape but have not been exercised against a real session; event ordering,
  retries, destination configuration and race conditions must be reviewed. The
  V2 signature authenticates the body, not the separate X-Timestamp header;
  check the signed timestamp and replay/idempotency behavior too. Provider
  costs/configuration may apply.
  The creation lease can leave a provider-side orphan if a network request fails
  after provider creation; decide idempotency/reconciliation and billing limits.
- Retire existing auto-verification endpoints and settle or communicate what
  happens to outstanding applications, while preserving existing badges. Handle
  older clients and ensure no alternative SQL or edge path can award badges.
- Add notifications, withdrawal/appeals, application pagination, anti-fraud
  controls, role/admin authentication hardening and a complete moderation plan.
- SQL and edge prototypes have not been executed or security-reviewed. The user
  requested no tests, but sensitive-data release still requires necessary
  security and integration validation. No Supabase or production changes were
  made for this work. Do not merge these SQL experiments as migrations yet.

- `08_retention_experiment.sql` drafts the chosen 30-day post-review image
  expiry, denies reads at the deadline and queues deletion; a deployed, monitored
  scheduler and backup/provider retention policy are still needed. Abandoned
  reservations are queued after 24 hours. Open-case expiry needs a policy.

- Creator monetization and admin payouts are deferred: there is no payment,
  earnings calculation, payout dashboard or Paystack integration in this work.
