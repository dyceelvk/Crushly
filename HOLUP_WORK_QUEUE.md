# Holup work queue — not a release checklist completion claim

## SUPERSEDED earlier decisions (see v3 below)
- Add Up becomes an immediate one-way follow, not a request. Remove the matchmaking/mutual animation.
- Keep Close becomes a request that the other person accepts or declines. Whispers require an approved Keep Close relationship.
- Migration: preserve existing mutual connections as approved Keep Close relationships; old one-way Keep Close entries become pending requests; existing active Add Ups become follows. Never silently approve a one-sided Keep Close.
- Display counts for Add Ups and Kept Close on Spaces. Space owner always sees both identity lists. Any member of an approved Keep Close pair can see the owner's Kept Close identity list. Add Up identity-list visibility is controlled by the Space owner: everyone allowed to see the Space, approved Keep Close members, or only the owner. Enforce all access on the server, including blocked/profile-visibility rules.
- Full Notifications screen: Yours, From Holup, settings; categories including Whisper, post activity (likes/comments/mentions), Add Ups, and Kept Close. Route each to its actual item. Use real messages/announcements, never mock data.

## Earlier requirements still open
- Verify/deploy comment @/emoji placement, Space sharing and links, plain banner, link-enabled captions/messages/comments/bios, Space bio on header, functional post location and link controls.
- Server-backed Whisper delete for me and sender delete for everyone: local code and SQL tests in progress; real-device tests and deployment pending. Already-seen material cannot be recalled.
- Public videos: serve a genuinely truncated 13-second rendition to nonmembers, once per video/browser best-effort, no engagement, then prompt download. Never expose full source; recheck privacy and revocation at every access. Requires secure transcoding/serving design and verification.
- Isolated teen mode 12–17 with server-side prevention of adult contact and dating/romantic features. Do not lower age gate before end-to-end enforcement, moderation/safeguarding and tests.
- User's 21-second video retry and physical Android behavior still unverified. Exact Android 1.0.87 smoke failed; production remains 1.0.86. Do not publish stale/failed builds.
- Preserve privacy, private local drafts, stable feeds and the other existing acceptance criteria. Canonical holupapp.vercel.app; removed mecrushly.vercel.app must stay removed.

## Local checkpoint: Space counts and identity-list privacy (not deployable yet)
- Added a private-by-default server preference, profile/block-filtered paginated identity RPCs and Space count/list UI. Owner can select list visibility; all list access is checked server-side. SQL regression includes unauthorized access, all visibility modes, paging and hidden profiles. Browser interaction test uses a mocked API.
- Current counts are based on the **legacy** active Add Up rows and accepted connections. The Add Up/Keep Close transition is NOT implemented. Do not deploy this migration or UI independently: the labels and behavior only become correct with the complete relationship migration, installed-client compatibility and all access paths tested.
- Fresh PostgreSQL full suite, TypeScript, unit tests, mock web build and 20/20 offline browser checks passed. Native-device and concurrent-request verification remain open. Nothing from this checkpoint has shipped.

## Relationship experiment (not in migrations; not deployed)
- `supabase/relationship-work/` contains a disposable-database prototype for an atomic conversion, explicit Keep Close request/accept/decline, independent Add Up follows, no-send/reaction/realtime without approval, and pair-lock concurrency. A legacy decision RPC fails closed instead of silently accepting an unrelated follow.
- Fresh full legacy SQL regression passed, prototype applied twice, targeted migration/authorization tests passed, and three real PostgreSQL lock-race scenarios passed. This does **not** mean the redesign or release is complete: clients, notifications, the remaining Whisper/API/privacy audit, migration rollout/rollback, and integration tests remain. See the experiment README. Never deploy the experiment as-is.
- Hardened local Space identity-list filtering against legacy cancelled-Add-Up/profile-privacy exceptions; added a regression test. Full fresh SQL suite passed.

## Local client checkpoint — relationship redesign, still not deployable
- Added independent Add Up/Whisper controls, explicit Keep Close acceptance/decline and end confirmation, a reachable paginated request hub, notification markers/routes, and a server-backed Keep Close notification switch. Updated misleading legacy privacy/help wording. These app changes require the experimental server and must not be released alone.
- Prototype now returns follow-aware Space profile fields and a Keep Close hub, sends approval notifications, and has five real database lock-race scenarios. Full fresh legacy SQL suite before prototype, twice-applied prototype migration/targeted SQL, TypeScript, 300+3+7 unit tests, mock web build and 22 mock browser tests passed. Native and production integrated tests have not run.
- Installed-client compatibility/update gating; all relationship-dependent RPCs and full Whisper read/media/receipt revocation audit; production rollout/rollback and safety remain open. Teen isolation, true public video preview, Android release/device checks also remain blockers. Production unchanged.

## Moment replies → original Moment (local; not deployed)
- Whisper Moment replies now expose a separate View Moment action. The server resolves the message to the exact original Moment for a thread participant, checks hidden messages, blocks, current audience and 24-hour expiry, and returns no Moment content in the link response. Removed old Moment snapshots from message rows and private text from Moment-reply notifications; new replies store only an ID. Cached Moment feeds are not displayed on a failed refresh.
- Fresh PostgreSQL suite (including upgrade/redaction and unauthorized, hidden, blocked, revoked, expired, deleted and owner/sender cases), typecheck, 300+3+7 unit tests, mock web export and 24 browser tests passed. The new Moment tests also passed after applying the isolated relationship prototype. Physical Android and production verification remain outstanding. This is not deployed.
- User asked to launch everything; do not deploy the branch with incomplete relationship migration/compatibility, teen isolation, 13-second server previews, and failed Android release checks. Existing age gate stays.

## Whisper access audit checkpoint (isolated; not deployed)
- `06_whisper_access.sql` experimentally gates history, sync, direct message/reaction/conversation reads, media, Moment targets, presence, badges, receipts and call-room registration on an open, approved, unblocked pair. Sender receipt columns are no longer exposed through raw table reads; filtered RPCs remain available. Delete-for-me remains possible after unblocked separation at the RPC layer, but not yet from a separated-thread UI. User confirmed: preserve stored history but hide it until a new approval and reopening; blocked pairs cannot access it.
- Fresh disposable PostgreSQL: full legacy suite before experiment; core applied twice and earlier targeted tests; access experiment applied twice; access and Moment regression; request/block, approval/block, send/removal and delivery/read vs removal/block races in both orders; registration vs removal/block. These do not verify live Supabase, native Android or already-joined channels.
- Critical release blocker discovered: Realtime join authorization may be cached while clients can broadcast arbitrary payloads, so SQL join checks alone cannot guarantee immediate post-block revocation. Need server-enforced disconnection or replacement/disablement and real-service tests; active-call revocation, notification routing, cache behavior and installed-client compatibility also remain. Calls stay disabled, adult age gate stays in place, no production rollout.
- Confirmed policy with user: hide stored Whispers on separation until renewed approval; blocking denies access. Local client clears visible chat and invalidates older in-flight fetches when the server authoritatively denies the thread, disables composing, and hangs up the local call; a successful retry reconnects. Network errors do not masquerade as authorization revocation. This is not a substitute for forcing realtime revocation on the server.

## Latest decision: subscriptions + independent Whisper requests (v3)
- Add Up and Keep Close are separate immediate one-way subscriptions. Mutual Keep Close means both subscribe. Space owner and their Keep Close subscribers may see the Kept Close identities, subject to profile/block visibility.
- Whispers are independent of Keep Close: up to two messages total before acceptance; recipient may accept explicitly or by replying. An optional open setting allows any otherwise eligible sender to start without acceptance, and conversations started while it is on stay open when it is turned off. Existing conversations remain accepted; blocks still prevent contact. Unsubscribing must not end an accepted Whisper.
- Previous `relationship-work/` SQL and dependent approval-based UI are **superseded** and must not ship. New `supabase/subscription-whisper-work/` is a standalone partial experiment only: directional Keep Close, subscriber count/list gate, preserving legacy rows/chats, durable two-message quota, reply/open consent and pair-lock tests. Existing clients and real message RPCs do not yet use it. Fresh SQL baseline, twice-applied experiment, targeted tests and seven lock-race cases passed; not deployed. See the experiment README for gaps.
- Outstanding: redesign actual APIs/RLS/media/notifications/UI/settings and update gate, solve stale realtime and active call revocation, integrate both-user empty-chat behavior, abuse/retry controls, representative migration and rollback tests, teen isolation, protected video previews and Android release smoke/device tests. No launch yet.

## v3 actual-API and client checkpoint (still NOT deployable)
- The experimental 04 SQL now exercises actual Whisper open/send/list/access,
  request and decision RPCs, direct receipt restrictions, pending presence
  suppression, and fail-closed new Realtime/call joins. The client has an
  incoming requests tab, accept/decline, reply-to-accept handling, open-messaging
  setting, immediate Keep and a reachable subscription hub. Add Up follows have
  a provisional independent server implementation. Existing conversations stay
  accepted, and no changes have been deployed.
- Fresh disposable database: full legacy suite before v3, 01 and 04 applied
  twice, 02 and 05 assertions and 03 and 06 race suites passed. Real hosted
  PostgREST/Realtime, old clients, Android and real notification delivery have
  not been verified. Old connection-based privacy, Close-audience semantics,
  `close_ones`, notification/badge paths and direct legacy RPCs must still be
  reconciled; a subscriber list must not bypass profile/block privacy. See the
  experiment README. Cached joined Realtime sockets remain a critical unresolved
  revocation blocker. Keep calls and teen access disabled; do not publish.
- Local verification for this checkpoint: TypeScript, 300 + 3 + 7 unit tests,
  mock web export and 29 browser tests passed. Browser tests cover independent
  Keep/Add Up, subscription hub, incoming request accept/decline, reply-to-accept,
  open-setting changes, and the Moment-reply behavior with mocked APIs. SQL also
  covers incoming/outgoing/mutual hub paging, hidden profiles and blocks. This
  is not proof of real-service integration or release readiness.

## Latest correction: reciprocal Close Ones, independent Whispers
- The user clarified that Keep Close is a friends-style circle, not a subscription
  audience: each person adds immediately, no approval; they become Close Ones
  only if both add each other. “Connections”/“Close” privacy, including the
  Add Up identity-list Close setting, means mutual Close Ones only. The owner and
  mutual Close Ones can see the Kept Close identity list; it still counts/lists
  people who added the owner, not only mutual friends. Whispers stay independent.
- `08_mutual_close_experiment.sql` is an isolated follow-on to 01 + 04. It changes
  the shared connections helper to reciprocal Keeps, changes the Kept Close list
  permission to owner/mutual, and removes a historical Add Up exception that
  exposed Close-only Spaces. 04 now uses the shared list permission for both
  Space lists and filters Close Ones by profile/block privacy. 07 documents/tests
  the now-superseded intermediate subscriber ACL and runs **before** 08 only;
  09 tests the latest policy. Older descriptions in this file/README about
  subscriber access are superseded by this section.
- Fresh disposable SQL baseline + 01, 04, 08 applied twice; selected 02, 05, 07
  and 09 tests plus real-API races passed. 09 covers one-sided denial, incoming
  counts, mutual post/Moment/list access, no Add Up privacy bypass and preserved
  accepted Whispers when a mutual Keep ends. These are narrow local tests, not
  an exhaustive audit. Private Spaces may need a safe way for two people to add
  each other without exposing full content; legacy clients and destructive old
  RPCs need an update gate; realtime revocation, teen isolation, video previews,
  real-service tests, Android release and rollout/rollback remain blockers.
- Follow-on local guards: old directional Keep/let-go RPCs delegate to the
  pair-locked v3 methods; obsolete approval/cancellation and destructive
  remove-connection RPCs fail with an update-required error rather than changing
  someone else's Add Up or closing an accepted Whisper. This is not a substitute
  for an installed-client update gate. A fresh disposable rerun passed the full
  legacy baseline, applied 01/04/08 twice, 02/05/09 and both race suites. The
  intermediate 07 ACL test ran before 08. TypeScript, 300+3+7 unit tests, mock
  web build and 30/30 browser tests passed. No production rollout.

## Subsequent release work
- Android smoke: diagnosed that `wait_for` / screenshot can dismiss the IME
  after the Moment input was focused. The smoke script now explicitly refocuses
  the EditText immediately before typing, then still checks the exact value and
  draft restore. An identical earlier APK is being re-walked on a verify-only
  CI branch; no APK is published by that verification. Result must be checked.
- Supabase documents a management endpoint to shut down a project's Realtime
  connections (`POST /v1/projects/{ref}/config/realtime/shutdown`). This could
  remove cached channel grants during a carefully controlled fail-closed cutover,
  but it disconnects the whole project's Realtime, not one pair. It is not a
  substitute for per-block immediate revocation while joins remain enabled. No
  shutdown has been performed; behavior, reconnection, old clients and all
  unrelated channels require staging verification before any production use.
- `supabase/public-video-preview/` contains a local-only prototype that actually
  re-encodes a short MP4 and tests 21-second synthetic audio/video inputs. It is
  not a public preview feature: ingestion, sandboxing, authorization, serving,
  deletion, one-per-browser behavior and rollout all remain to be built/tested.
- Preview experiment now also has a disposable SQL rendition lookup which
  rechecks post/Space visibility, global sharing, source replacement, deletion,
  and fails closed for unrendered edits and alternate soundtracks. Fresh normal
  SQL suite followed by replayed experiment and targeted anonymous/privacy tests
  passed. It returns a rendition key only, never an original URL; there is still
  no ingestion, authenticated serving, browser limit, or production rollout.
- An aggregate-only production check found 7 onboarded non-demo profiles, 0
  valid under-18 birthdays, and 1 missing/invalid birthday. No identity was
  queried. Existing adult gating is client-side, so it is not sufficient to
  claim secure teen isolation. `adult-gate-work/` experiments with server-side
  validation at onboarding/birthday writes and robust date handling; it passes
  direct authenticated-write tests but does NOT gate all pre-onboarding social
  paths or solve the existing invalid record. No age/teen change has been deployed.
- Birthday client validation now rejects impossible calendar dates instead of
  accepting e.g. February 31. TypeScript, 300+3+7 unit tests, mock web build
  and 30/30 offline browser tests passed. The experimental server age guard
  passed twice-applied, direct-write boundary tests. The exact-APK Android
  re-walk was dispatched as CI run 42598886227 and was still running at the
  latest check; no release has been published.

## Private Close Ones flow and Android result
- CI 42598886227 succeeded, including re-walking the exact emulator APK from
  42570564697 with the corrected Moment-input focus handling. That proves that
  earlier binary passed the revised emulator walk, not that today's newer app
  branch has passed an Android release/device test or was published.
- In 08, a person who Keeps the recipient Close can appear as a minimal incoming
  card even when their Space is private. Only id/name are exposed (no photo,
  bio, age, handle, activity or other private details). The recipient can Keep
  back directly; the now-mutual pair gains access under existing privacy rules.
  A stranger cannot use this to Keep a private profile, and blocks win. This is
  an experiment, not deployed. Fresh legacy SQL + v3/08 replay, private-flow,
  Whisper behavior and race tests passed; real hosted tests remain required.
  Local verification: full fresh migration/test replay, both v3 concurrency
  scripts and private Keep-back tests passed; typecheck, 300 + 3 + 7 unit tests,
  mock build and all 31 mocked browser cases passed.
- A current-schema catalog audit found one still-executable legacy RPC,
  `crushes_feed()`, directly read historical `connections`. After someone
  stopped Keeping Close, it could return a formerly mutual private profile and
  pollute current Circle/share candidates. The local 08 experiment now derives
  that list from mutual Keeps and denies direct client access to the historical
  table. New test 11 reproduces the stale-row case and verifies both denial and
  a genuine mutual candidate; full fresh SQL, replay and both races passed.
  This is a compatibility-breaking change for clients that directly read the
  old table, so a real upgrade gate is still required. It does not complete the
  audit of every helper-dependent endpoint, media path or Realtime revocation.
- Verification-only branch `verify/holup-close-privacy` points to 8a26268;
  CI run 42601557167 was dispatched and is in progress. The verification branch
  does not publish the app. Android for current sources has not been built or
  walked against a properly staged backend; do not use the live backend as a
  substitute for staging a client that depends on undeployed v3 APIs.
  Outcome: CI 42601557167 completed successfully: app, full migration/RLS
  smoke, offline browser regressions, Worker bundle and release notes passed;
  exact-APK re-walk was intentionally skipped (no APK was supplied). CI does
  not run the experimental 08/10/11 scripts, which were tested locally above.

## Latest requested admin operations
- User requested full operations: reports, accounts, content, verification,
  announcements, feature switches and audit; and asked not to spend time on
  tests. Previous test-only Android build 42602690113 was cancelled accordingly.
- Admin operations prototype in `supabase/admin-operations-work/` adds
  server-authorized report list/review, minimal account search, verification
  status and admin activity, with access/action audit; the app has matching UI.
  It is deliberately NOT deployed. Account suspensions, content takedowns,
  evidence-backed manual verification review, full pagination, and complete
  administrator actions are not yet implemented. Do not represent it as a
  complete admin console or deploy without security/compatibility verification.
- A web export using the public production client configuration built locally;
  it was not deployed because its new APIs and safety controls are not live.
  No new test suite was run at the user's request. An untested notification
  privacy experiment is in `subscription-whisper-work/12_notification_privacy_experiment.sql`;
  its SQL and UI routing are not deployed or validated.
- Android build-only workflow dispatched as run 42605205587 on isolated branch
  `verify/holup-android-build-only`, commit 2b754ae (app sources ad750a7).
  This workflow does not run tests and cannot publish; result was in progress
  at dispatch. Never promote its artifact while required DB APIs are missing.

## Production incremental age hardening and latest build
- Production Supabase migration `20261109110817_harden_adult_profile_writes`
  was applied. This is the previously locally validated trigger/age function:
  profile birthday writes and onboarding completion now reject invalid or
  under-18 self-reported dates, and impossible dates no longer crash age_of.
  Production catalog confirms its trigger exists. This is partial protection:
  pre-onboarding social access is not comprehensively gated, self-reported
  birthdays do not verify age, and teen isolation is NOT enabled. Existing
  invalid records are not bulk-modified. Future migrations `000007`–`000011`
  predate this applied version, so normal db push may require a coordinated
  migration-history plan; never blindly run --include-all on production.
- Android build-only run 42605205587 succeeded and generated artifact
  13668875121. It contains app sources from ad750a7, was not tested or
  published, and lacks the newer reported-post admin work. The updated web
  build also completed locally and is not deployed.
- Reported-post inspection/removal by a server-authorized admin (with reason,
  confirmation, report/author matching and audit) and paged report browsing are
  prototyped locally. Media evidence, account suspensions, verification review,
  server authorization review and production deployment remain incomplete.
- Birthday recovery client flow was added locally for existing onboarded
  profiles with a missing, invalid or non-adult birthday. The member can enter
  a date, sign out or contact support rather than being silently locked out.
  This self-report UX is not identity verification, API authorization or teen
  mode; it is not built into a released app.
- Main commit ad03f71 records the already-applied production migration so the
  live schema does not have an untracked migration. It contains no app changes;
  commit uses [skip ci] in line with the user's request not to run tests.
- Vercel's production deployment for main ad03f71 is READY and promoted; it
  redeploys the prior app sources with the migration-record commit, not the new
  admin or birthday-recovery client. Android offered version remains 1.0.86.
- Local-only, previously unapplied migrations 000007–000011 have been renamed
  20261109110818–20261109110822, after the now-applied 20261109110817. This
  avoids needing `--include-all` solely to handle the new migration timestamp.
  Fixture references were updated. The new combined ordering has not been
  verified and must not be taken as approval to push it automatically.
- Additional pre-existing admin issue: `supabase/functions/verify-identity`
  references undefined `user.id` despite authorizing only a service-role key.
  It may fail when invoked. Do not simply remove that guard and enable it:
  its implementation automatically approves/rejects identities using AI despite
  describing itself as an assist, and an evidence-backed, authorized human
  review workflow is still required. This function was not changed or deployed.
- Latest local web export after the admin and birthday-recovery edits completed
  without running a new test suite; it was not deployed. Android candidate
  42605205587 is older than the latest local changes. Full admin operations,
  preview serving, server-wide age eligibility, teen separation, secure
  Realtime revocation and actual coordinated release remain open.

## Teen isolation decision and foundation
- User explicitly chose: Didit is **only for optional creator verification**;
  minors can use Holup without Didit. Creators may earn verification for
  virality/growth, and admins need controls to award it and ask applicants
  questions. Do not make Didit or a badge mandatory for teen accounts.
- With self-reported ages, an adult can lie. Account-group isolation can prevent
  correctly classified adults and teens from contacting each other, but cannot
  guarantee no adult will pose as a teen. Do not claim otherwise.
- New `supabase/teen-isolation/01_tenant_foundation.sql` is an UNDEPLOYED,
  unverified separate-project design: immutable self-reported teen DOB, minimum
  privacy profile, explicit consent state, immediate directional Keep/mutual
  Close Ones, blocks, and dynamic age eligibility. It is intentionally guarded
  against installation in the adult database. It does not yet offer chat,
  content, media, teen client, or admin interaction. It refuses teen social
  access pending guardian consent. Consent evidence/workflow, safety moderation,
  correct handling of adult impostors, account recovery, and country-specific
  legal review are prerequisites, not solved by a consent flag. Realtime and
  romantic features are absent. No teen project was created or enabled.
- Need design separate creator-recognition badge vs Didit identity assurance so
  an admin award based on popularity does not falsely claim document identity
  verification; include applications, questions, user replies and audit in the
  admin board. This replaces the earlier suggestion that Didit be required for
  age verification. No test suites were run at user's request.
- Teen safety reporting is additionally sketched as an isolated RPC with an
  adult-impostor category, rate limit and optional atomic block. This is not a
  staffed moderation queue or client UI; unreviewed and not deployed.

## Manual verification — current user priority
- User asked to pause Supabase changes and build admin-controlled verification.
  No Supabase project, Didit function, live database, production web or Android
  was changed for this task. Teen work is paused.
- Decisions: 10k incoming Add Ups, 1k image/video posts, 100 text posts, 500k
  Crushes/likes on posts, plus 3 posts in each of the last four 7-day periods
  for creator (gold); 5k Add Ups, 1k photo/video posts, 50 text posts and 50k
  Crushes on video posts for person ID (diamond blue). The user clarified all
  post thresholds count posts, PI 1k is photos+videos, admin retains existing
  verification/exemption, and Didit live capture is mandatory for person ID
  only and directed by admin. Creator badge recognizes popularity, not ID.
- Experimental `supabase/manual-verification-work/01_verification_experiment.sql`
  and local Settings/admin screens provide an unreleased prototype for progress,
  application, private text review, questions, gold approval and rejection
  with reasons/audit. PI approval fails closed without case-bound trusted Didit
  evidence. No provider evidence integration exists, so PI approval is not
  available. Document/selfie upload and secure admin viewing do not exist. The
  UI explicitly warns not to send documents in text messages. Existing live
  Didit functions still independently award badges and must be retired or
  switched to evidence-only before release; pending requests need a plan.
- See README for critical retention, secure evidence, session-binding, audit,
  migration and validation blockers. No tests were run. A web build was started
  after npm ci; outcome must be checked. No changes have shipped. Current counts
  exclude Circle posts and other reaction kinds; media classification by file
  extension needs production review, especially videos and public URLs.
- `npm ci` and the local web export completed successfully for the prototype;
  this was a build, not a test or deployment. Source work was committed as
  `a2eee15`. An earlier build attempt failed because dependencies were missing,
  and was retried only after installing them. Production remains unchanged.
- Continued local verification work: built experimental admin-requested,
  case-bound Didit session creation and server-fetched result verification;
  person badge still requires an explicit admin decision. Added prototype image
  upload/view to a separate private bucket via authenticated edge functions,
  owner removal and a durable cleanup queue. Added local-only legacy-auto-badge
  retirement SQL and removed unused old client entry points. None deployed.
  See `supabase/manual-verification-work/README.md` for substantial blockers:
  image sanitization/scanning, privacy/retention, scheduled cleanup, Didit
  workflow/configuration, real provider validation, old-client migration and
  security review. A web build started; its result must be checked.
- Latest local web export succeeded after the new verification UI and private
  attachment/capture controls were added; it is a build only and was not
  deployed. A subsequent small local change allows rechecking approved capture
  state; SQL/edge changes remain unexecuted. No test suite was run. The current
  live verification remains the old automatic flow until a safe coordinated
  release is possible. `git grep` found no named integration with other apps.

## Updated verification flow (latest user direction)
- User explicitly changed prior scope: Didit ID capture, liveness and face match
  are mandatory for BOTH creator and person ID verification. The admin reviews
  an application and requests Didit, which shows the applicant's capture button;
  after Didit approves, the admin assigns the proper badge. A single admin action
  should assign ALL ready approved applicants across both categories, creator
  gold and person ID diamond blue. One account cannot have two categories.
- Implemented locally only: shared capture request and individual approval for
  both categories, one-active-or-approved-case/member DB constraint, legacy badge
  preservation, counts and confirmed admin bulk assignment with case-specific
  audited results (`06_batch_award_experiment.sql`). Added signed Didit session
  webhook prototype (`07_capture_webhook_experiment.sql`, `edge/manual-didit-webhook.ts`)
  so approvals can arrive automatically; a server-fetched poll is a fallback.
  Event ordering and provider binding are fail-closed prototypes, not yet verified.
- Payment/Paystack integration and creator payouts explicitly deferred by user;
  do not implement or imply those work. Existing local SQL, edge functions and UI
  are experimental, undeployed, and must undergo privacy/security and integration
  review before handling actual identity documents. No production changes made.
- The verification admin list now has server-side category filters and pages;
  bulk assignment considers all ready cases, not only the visible page. Local
  web export and TypeScript compilation completed successfully. These are not
  security/integration tests, and no test suite was run. SQL, edge functions,
  provider results, storage and the batch operation remain unverified and
  undeployed. Production still uses the old flow; do not say otherwise.

## Production verification review in progress
- User now authorizes review and production release. No production app, schema or
  functions have been changed in this review yet. Active production still uses
  the old flow. Do not ship unreviewed privacy-sensitive documents or the whole
  unrelated branch.
- Read-only production catalog review: Holup has 7 active onboarded profiles,
  1 pending Didit request (Not Started), and 1 existing verified profile.
  Storage policies currently scope authenticated access to `media` or the old
  `verification` bucket; no broad policy for a new evidence bucket was found.
- Read-only GitHub Actions run 42617815324 inspected the GitHub-configured Didit workflow
  via the configured secrets without exposing them: published KYC, not archived,
  OCR + liveness + face match enabled. Production Supabase secret values were
  redacted, so whether it uses exactly the same workflow is not confirmed. No
  Didit configuration was changed. The
  dedicated manual-workflow env var is not configured in Supabase; local edge
  code now falls back to the existing configured workflow. Provider session and
  webhook behavior remain unverified.
- PostgreSQL 17 disposable DB `holup_review`, local process
  `isolated-holup-database-d7f66492`: stubs + production-equivalent migration
  versions through admin controls and applied adult guard, then experimental
  verification SQL 01–07 compiled. A targeted rollback-only disposable SQL
  review checked unauthorized access, forged approval, two-category prevention,
  batch mapping/idempotency and auditing and passed. This is not full security,
  storage, concurrency, provider integration or production validation.
- Review corrected count semantics: post reactions must use the same current
  count the app labels Crushes, rather than only `kind='crush'`. Change is local.
  Raw identity uploads still lack image sanitization/scanning, enforceable
  retention with monitored cleanup and tested lifecycle. The separate manual
  Didit webhook destination/secret has not been configured; old live endpoints
  can still auto-award. Production migration sequencing, installed clients,
  Android update and rollout/rollback remain open.
- The user selected **30 days after review completion** for Holup-hosted
  verification images. `08_retention_experiment.sql` now denies image reads at
  the cutoff and queues expired images; an isolated rollback-only check passed.
  Physical deletion still requires a deployed and monitored scheduler; no
  guarantee for backups, Didit-held evidence, stalled uploads or open cases.
- A local progress bug was found and fixed: a double-escaped SQL regex failed
  to recognize video filenames. Local rollback-only review now covers video and
  reaction counts. Classification remains extension-based and imperfect.
- During local edge review an invalid double-escaped URL regex was found and
  fixed. Web export and TypeScript compilation completed, but edge provider
  runtime and actual Didit sessions remain unverified.
- Didit webhook review also needs replay protection tied to authenticated body
  timestamps: the provider signs the body but the `X-Timestamp` header alone is
  not part of the V2 HMAC. Retained event IDs and session binding help, but
  signed timestamp/retry behavior and old-client/legacy endpoint cutover need a
  reviewed design and real provider validation before deployment.

- Follow-up: the local webhook now bounds the streamed request body and checks
  the HMAC-authenticated payload timestamp as well as the header timestamp.
  This is fail-closed but actual Didit retry timestamps, key rotation and real
  session behavior still require provider validation before deployment.
- `supabase/manual-verification-work/cleanup-scheduler.prototype.yml` sketches a
  credential-gated 15-minute cleanup scheduler. It is intentionally inactive;
  production needs a separately provisioned secret, reachable private worker,
  operational failure alerts, backlog monitoring, and validation of deletion
  and backup/provider retention before activating it.
- Private evidence now has a *local draft* resource-limited ImageMagick WASM
  decode/re-encode path, strips metadata, corrects EXIF orientation, rejects
  animation/oversized images, and attempts cleanup of the phone's temporary
  transformed image. Only synthetic Node-based fixtures were used; JPEG, PNG,
  WebP, orientation and EXIF stripping succeeded there; oversized and animated
  samples were rejected. A 1600px random JPEG used about 180 MiB in local Node,
  not representative of hosted edge. No malware-scan claim. WASM static bundle,
  hosted limits, malformed inputs, visual legibility, app caching and deletion
  remain release blockers; the function is not deployed.
- Cutover review found a separate legacy AI route that directly updates profile
  verification using service-role access; disabling only `apply_didit_status`
  would be insufficient. Local fail-closed replacements for that route, old
  session/status routes and the legacy webhook now exist under
  `supabase/manual-verification-work/edge/legacy-retirement/`. They must be
  coordinated with the new callback, active pending applicant, legacy installed
  clients and automatic deploy workflows; no production route was replaced.
- Read-only Didit configuration review run 42620848329 established that the
  GitHub API key and workflow fingerprints match Supabase secret fingerprints;
  therefore the previously inspected published KYC workflow is the one currently
  configured there. The Didit configuration reports zero enabled webhook
  destinations and no legacy webhook URL, so automatic callbacks are not set up.
  Provider data-retention months returned null; face retention reported
  `delete_with_session` with no fixed day value. This is not proof of a 30-day
  provider deletion guarantee. No provider settings were changed.
- Local web TypeScript compilation and an export passed for the image-work
  changes; edge syntax-only transpilation passed. No deployment performed.
- The manual Didit webhook draft now uses the same verified workflow-ID fallback
  as session creation; a separate webhook signing secret and provider
  destination are still required. The Supabase connector catalog returned a
  temporary load error on this turn; no production changes were made.

## Cleanup monitor and staging attempt
- Supabase connector recovered and Holup DB, Auth, REST and Storage reported
  healthy. Creating an isolated Supabase branch was denied with
  `entitlement_required`: branching requires Pro or higher. No new project or
  branch was created, and the plan was not changed. Do not retry with alternate
  branch options or use another project to bypass this restriction.
- Local cleanup monitor `09_cleanup_monitor_experiment.sql`, its heartbeat and
  admin UI display only aggregate queue/overdue counts and last success, and
  flag missing/failed/stale runs. Unauthorized access and stale/failure behavior
  were checked in a disposable PostgreSQL database; local typecheck/web export
  succeeded. No live worker, alerts or retention automation were deployed.
- `pg_cron` and `pg_net` are available on Holup but not installed; Vault is
  installed. This read-only information does not establish scheduler readiness
  and does not alter production. Provider webhook, provider retention,
  image-worker hosted deployment, safety review and cutover remain incomplete.

## Production badge-tier protection
- Production migration `20261109131025_protect_profile_badge_tier` was applied
  through Supabase and catalog/migration history confirmed. It blocks direct
  anonymous/authenticated badge-tier changes, preserves existing badges and
  leaves trusted server writes possible. This closes a production gap found in
  catalog review; it is **not** the new verification system or an award.
- The five still-unpublished local migrations were renamed to
  `20261109131026`–`20261109131030` and fixture references updated, so they sort
  after the newly applied migration. Their combined release/order still needs
  review. Manual verification, its Didit endpoints, 30-day cleanup and the new
  app remain undeployed; old Didit auto-awards remain live.

- Migration-only main commit `28e8eee` records the applied guard; Vercel
  automatically started production deployment `dpl_D5LmxXwihD98Wv11xy6xPQnFkU8s`,
  initially BUILDING. It contains no new verification UI. The experimental
  `01` draft now relies on the already-applied guard rather than adding a
  redundant second trigger. No other verification SQL was deployed.
- Vercel deployment `dpl_D5LmxXwihD98Wv11xy6xPQnFkU8s` finished READY and
  PROMOTED on `holupapp.vercel.app`; it is only the migration-record commit
  `28e8eee`, not the new app or verification flow.
- A local alternative JPEG-only processor was evaluated on synthetic input:
  approximately 1.0 seconds and 233 MiB RSS in Node for a 1600px noisy image.
  That does not establish hosted performance or replace the current draft.

## User-requested push/build
- Pushed local work branch `work/holup-viewer-privacy-controls` at `c99a2f8`
  to GitHub. This is a non-production branch; it is not a production release.
- Started no-test/no-publish Android candidate build on branch
  `build/holup-unreleased-candidate`, commit `4180f21`, GitHub run
  `42623845740`. The candidate has the same app source as `c99a2f8`; the extra
  commit changes the dispatch workflow only. Last observation: in progress at
  Compile Android app. Outcome is unknown, and the candidate is not a published,
  signed-and-verified update for existing installs. Check the GitHub run before
  making any claim that it succeeded or offering it for installation.
- Production web currently serves the badge-guard migration-only commit
  `28e8eee`. The new verification SQL, evidence processor and retention worker,
  Didit callback, the experimental app and unrelated outstanding work have not
  been deployed. Production legacy Didit auto-award still operates. Do not push
  the work branch to main or release its APK as if the dependencies were live.
- Android candidate GitHub run `42623845740` completed successfully; artifact
  `13678880892` contains a 95,083,972-byte APK SHA-256
  `f5c7d1c8d529e220d447a9569f090e0da8d5349daa6ba9c121ec5756c4663350`.
  `apksigner verify` shows certificate SHA-256
  `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`, the same
  as installed 1.0.86. This verifies signing-certificate equality, NOT a real
  update installation or app/backend functionality. The certificate is an
  Android debug certificate. The APK has NOT been released and must not be
  pumped while its backend dependencies and privacy protections are incomplete.
- 30-day deletion follow-up: production still has no manual-review case/file
  tables or evidence bucket; legacy `verification` bucket has zero objects.
  Did not claim that existing or future images are being deleted. Hardened the
  draft queue against stale-worker acknowledgements and queued failed/ambiguous
  upload paths. Disposable PostgreSQL checks passed for revision matching and
  authenticated-role denial; hosted worker, storage, crash recovery and actual
  scheduler remain unverified/undeployed. Do not enable evidence upload yet.

## Live 30-day evidence retention infrastructure
- Supabase production migrations `20261109133904_manual_evidence_retention_foundation`
  and `20261109134050_protect_evidence_cleanup_auth` created the private evidence
  bucket, case/file tables, versioned deletion queue and scheduler credential
  digest. No member/client access or evidence upload flow has been enabled.
- Protected Edge worker `manual-evidence-cleanup` v2 and GitHub Actions scheduler
  are live. The scheduler runs every 15 minutes (best effort). GitHub run
  `42627677177` configured the secret digest and succeeded; run `42627803588`
  created a synthetic Storage object, queued it, invoked the real worker, and
  confirmed the object was gone. The temporary check Edge function was removed.
  Heartbeat reported zero failures. This validates infrastructure only, not the
  real manual verification flow, prior legacy images, backups, provider retention,
  or guaranteed timing when jobs fail/backlogs grow.
- The manual verification app, reviewer endpoints, image upload processor,
  admin-requested Didit integration, identity capture, provider webhook and
  earlier-deletion UI are NOT deployed. Existing legacy Didit still operates.
  Do not solicit images or claim complete end-user 30-day deletion is live.
- The experimental 01/03/05/08/09 SQL now overlaps live tables/functions and
  must be reconciled with production, not executed as-is. The five unrelated
  pending local migrations are renumbered after the two live migrations.
- First scheduler setup run `42627496769` failed because the GitHub Supabase
  access token was unauthorized. The successful setup used the existing DB
  credential and a generated dedicated scheduler secret stored encrypted in
  GitHub; only its SHA-256 digest is stored in the database.
- Hosted processor feasibility: temporary Edge function (now deleted) fetched
  digest-pinned `@imagemagick/magick-wasm@0.0.45` WASM from jsDelivr, verified
  its SHA-256, initialized, and re-encoded synthetic JPEGs; HTTP 200 for a 32px
  image, two flat-color 1600px images, and one 1600px noisy 2.3MB synthetic
  JPEG (~0.98s end-to-end in that run). This is not a real-image, sustained
  load, malformed-input or security review. Updated the undeployed evidence
  draft to stream-limit and hash-verify the pinned WASM; no user image is sent
  to the CDN. CDN outages must fail uploads closed. The actual evidence upload
  endpoint, authorization and client are still not deployed.
- Production main `732d095` contains the scoped Space/layout, in-app link and
  share-menu fixes (no new verification UI). Local typecheck/web build passed.
  Vercel production deployment `dpl_AhaNdqQdf2q9fr4dKsyyZF3otmqJ` was BUILDING
  at last check; verify its final status before saying the changes are live.
  Android production build `42628810477` for 1.0.87 was dispatched on that
  commit; it was in progress. Its release workflow only publishes/announces if
  the build, emulator walk, and secret checks pass. Do not push additional main
  commits while that workflow may publish and push its release record. Check
  the job and actual `/version` before claiming an Android update was pumped.
- Production database migration `20261109140000_manual_verification_backend_inactive`
  succeeded via GitHub DB run `42629129432` from isolated branch commit
  `a8881fa`. It installs the reconciled review/capture/evidence functions but
  explicitly withholds all authenticated grants. Catalog checks confirm users
  cannot apply, award badges or list images through these functions. The real
  manual verification flow is not live; legacy Didit is untouched.
- Important: main still lacks the `20261109140000` migration file as of this
  entry. Do not run main's migration workflow or declare history synchronized.
  Wait for Android release run `42628810477` to finish before adding the exact
  recorded migration to the latest main, so its release-record bot push is not
  disrupted. Work-branch pending migrations renumbered `20261109140001`–`005`.
- Production Edge `manual-evidence` v1 was deployed with gateway JWT
  verification and pinned-source import at `5e3051829fe8e475d9f99ec94b0029563fd0b521`.
  Unauthenticated requests received HTTP 401. The real signed-in upload/read
  path, the full bundled runtime, malicious files and user-data deletion remain
  unverified. Member application/list RPC grants are still withheld and no
  manual cases exist; do not solicit IDs or claim the review feature works.
- Vercel `dpl_AhaNdqQdf2q9fr4dKsyyZF3otmqJ` finished READY/PROMOTED on
  `holupapp.vercel.app`; fetching the live JS confirmed the new Space-menu and
  post-link controls. It contains only the scoped `732d095` web fixes, not the
  rest of the experimental work. Android `42628810477` was still compiling at
  last check; no 1.0.87 Android release was confirmed.
- Protected production synthetic evidence lifecycle run `42630542894`
  succeeded: a temporary non-onboarded synthetic account/case signed in,
  uploaded a generated PNG through `manual-evidence` (sanitized to JPEG),
  read it, set the review decision to 31 days ago, verified access denial,
  ran the real cleanup worker and verified physical Storage deletion. Cleanup
  removed the temporary account/case. Post-check: synthetic accounts 0,
  synthetic cases 0, bucket objects 0, deletion queue 0, last_failed 0. The
  temporary diagnostic Edge function was deleted. This is one synthetic
  end-to-end path, not provider, malformed-image, rate/load or privacy audit.
- Production Edge `manual-didit` v1 now exists, JWT-gated and pinned to source
  `5e3051829fe8e475d9f99ec94b0029563fd0b521`. The capture backend requires an
  existing open case and admin-requested capture; user-facing case/capture RPC
  grants remain withheld. No real provider session was created or validated.
  The callback, workflow configuration, response shapes, retries and provider
  retention are not validated; webhook is not configured. Existing legacy
  Didit auto-award remains active, and manual verification is not yet live.

## Scoped Space/web and Android release completed
- Vercel `dpl_AhaNdqQdf2q9fr4dKsyyZF3otmqJ`, commit `732d095`, was READY and
  PROMOTED on `holupapp.vercel.app`. Its live JS contains the Space menu and
  post-link controls. Only scoped Space/banner, sharing, visible bio and link
  improvements are included; remaining experimental changes are not live.
- Android release run `42628810477` completed SUCCESS, including Android 9
  emulator walk. The release bot committed `3db4d50`, and the live Worker
  `/version` and `/download-info` both report 1.0.87/87, 95,047,292 bytes,
  SHA-256 `30862f3b2700ae8158275189e2666378d181fe0b42a4cfc84899471e833c5282`.
  This is the scoped Space/link app, not the earlier unreleased full candidate.
- Main commit `232272e` records live migration `20261109140000`, the two locked
  evidence/Didit Edge imports, and fixes the DB test stubs/one-shot replay
  handling. Local full disposable DB CI passed; GitHub CI run `42633311055`
  and deploy-web run `42633311151` were in progress at last check. Earlier CI
  run `42628797263` failed on incomplete storage stubs; it is superseded only
  if the new run succeeds. Vercel may deploy the record-only main commit next.
- Manual verification UI, applicant RPC grants, Didit provider callback and
  legacy auto-award retirement remain incomplete. No claim of full completion.
- GitHub CI `42633311055` and deploy-web `42633311151` passed on main
  `232272e`, including the fixed DB test fixtures.
- `APP_URL` was set to the authorized canonical `https://holupapp.vercel.app`.
  Before the latest web change, `/verification?didit=done` was a 404. Main
  `4f02ceb` adds a Vercel rewrite to the app root so the existing return-handler
  can see the original path/query. Deployment `dpl_4FKwhsiBUE5NWZq3oXMQoQiPv3Xb`
  was BUILDING at last check; verify the real callback returns 200 after it is
  promoted. This does not validate a provider session or release manual review.
- Web deployment `dpl_4FKwhsiBUE5NWZq3oXMQoQiPv3Xb` is READY/PROMOTED;
  canonical `/?didit=done` and `/verification?didit=done` both returned HTTP
  200 and HTML after deployment. This verifies routing, not a real Didit return
  or restored-session navigation. `/v/62` and direct post-share API both now
  return the application-level 404 `This post is not available`; do not claim
  that a currently available share was retested. The diagnostic remote branch
  `build/holup-evidence-diagnostic` was deleted; diagnostic function had already
  been removed.
- Didit sandbox is a separate application and sandbox-mode key; the live key
  cannot simulate sessions. Management app creation needs an owner/admin JWT,
  not just the current application API key. No Didit sandbox or genuine
  provider outcome is established. See https://docs.didit.me/integration/sandbox-testing
  and https://docs.didit.me/auth-api/create-application.
- Production cleanup was observed stale: GitHub's scheduled cleanup had no
  scheduled runs since setup; manually dispatched run `42643373100` succeeded.
  The 15-minute schedule was present but actual scheduler reliability was not
  demonstrated. Do not claim deadline physical deletion based on it alone.
- GitHub monitor main `4eadb34` checks cleanup heartbeat, failed items and
  overdue work hourly. It creates one generic assigned issue without member
  data on failure; a test issue #11 was created and closed by successful run
  `42643538066`, and healthy-check run `42643534374` succeeded. GitHub
  notification delivery to a human is unverified; both GitHub schedules share
  the same platform and cannot detect an Actions-wide outage. Gmail SMTP test
  runs `42643102407` and `42643231713` failed to send, so SMTP was removed.
- Attempted pg_net scheduler was disabled immediately: queue had PUBLIC read
  privileges from supabase_admin, which the migration role's REVOKE could not
  remove. No scheduler job ran; vault credential/function were removed and
  pg_net/pg_cron uninstalled after zero jobs and zero queue verified. Exact
  applied SQL and replay-safe migration markers are documented in
  `supabase/manual-verification-work/disabled-pg-net-scheduler-history.md`.
- Independent Cloudflare `holup-evidence-scheduler` 15-minute cron deployed in
  main `dce424e`, deploy run `42644261172` passed; deployment invoked its
  protected `/run` and successfully reached the Supabase cleanup worker.
  Anonymous GET returned 404, anonymous POST 401 using an ordinary user agent.
  Actual time-triggered execution has not yet been observed. GitHub cleanup
  remains a backup. Rotating `MANUAL_EVIDENCE_CLEANUP_SECRET` requires updating
  the DB digest via the cleanup workflow and redeploying the Cloudflare worker.
- The manual verification flow is still disabled for applicants; independent
  alert delivery, legal holds, provider/backup retention and real Didit flow
  remain unresolved. Do not solicit real IDs or claim complete retention.
- Main `dce424e` CI run `42644261238` and deploy-web run `42644261651`
  both passed. Pending, unreleased work-branch migrations were renamed from
  `20261109140001`–`005` to `20261109152301`–`305`, because production history
  now ends at `20261109152300`; their combined order still requires review
  before release. No relationship/Whisper migrations were applied here.
- User confirms the 30-day retention check is working and requests the other
  reported fixes. This is not confirmation that manual verification itself is
  enabled or that provider/backups are covered; those remain separate gaps.
- Post place tagging deployed to production DB as
  `20261109153400_post_location`, with typed place names (not coordinates),
  post-audience checks and atomic create. Web main `338e56a`, Vercel
  `dpl_DBucAUMQhjVQ8ZLL5WBtGuVhkTXB` is READY/PROMOTED; live JS contains the
  composer control and location RPC. CI `42646086924` and web workflow
  `42646087001` passed. Android 1.0.88 release run `42646506754` was dispatched;
  its final result is not yet known. Do not claim Android is updated until the
  run succeeds and the Worker announces 1.0.88.
- Remaining unreleased migrations were renumbered `20261109153401`–`004`
  after deployed location; they still need coordinated review before release.
- The user asked to move directly to the other reported fixes. For exact Moment
  replies, production migration `20261109153925_whisper_moment_links` is applied
  with a private hidden-message table foundation; existing Moment snapshot
  fields were removed from three message rows, and member/anonymous grants
  were checked. The tappable client is prepared in `/home/user/holup-moment-release`
  but has not been released. Crucially, this live migration is not yet on main:
  Android release `42646506754` commits directly to main without rebasing, so
  wait for it to finish before merging/releasing the Moment client and exact
  migration; do not run main database push in the meantime. The saved migration
  in the work branch matches the remote statement, excluding trailing newline.
- Remaining unpublished migrations were renumbered
  `20261109153926`–`928` after the live Moment migration.
- Moment reply isolated release is preserved on GitHub branch
  `build/holup-moment-replies` commit `9997703` (Android 1.0.89). Its SQL
  exactly matches live `20261109153925` apart from trailing newline. Its focused
  release CI run `42647737887` was dispatched but result unknown. Do not merge
  or push main until Android 1.0.88 run `42646506754` has finished its bot
  release commit; then rebase/cherry-pick the Moment release on latest main,
  wait for production web promotion, and dispatch Android 1.0.89 if safe.
- Moment isolated release CI `42647737887` passed. Android 1.0.88 is still
  building in run `42646506754`; its release must finish before main advances.
- Cleanup heartbeat subsequently showed a successful run at 15:45:31 UTC,
  `last_failed=0`, after the Cloudflare */15 cron had propagated; there were no
  GitHub cleanup runs after manual dispatch `42643373100` (15:18 UTC). This is
  consistent with a genuine timed Cloudflare invocation. It does not resolve
  the unrelated manual-verification, legal-hold or provider-retention gaps.
- Android 1.0.88 run `42646506754` FAILED before publication: Android 9 walk
  stayed in Discover preferences because the transparent modal exposed Home and
  Space in the accessibility tree underneath. The screenshot showed the actual
  `Close preferences` control; the walk was not falsely marked successful. Main
  `d22d646` now includes the selective Moment client plus production migration
  and fixes the walk to close this modal before continuing. Prior isolated CI
  `42647737887` passed. Android 1.0.89 (which includes location and Moment
  links) was dispatched as `42650994778`; current Worker still offers 1.0.87.
  Main CI `42650984180` and web workflow `42650984373` are in progress; do not
  claim the Moment UI or APK live without verifying their outcomes. Do not push
  main while Android build is running because its bot push has no rebase.
- Web Moment replies now live: Vercel production deployment
  `dpl_HLbpcjCKEG7C51dnQh9ABBwSfV8R` is READY/PROMOTED at main `d22d646`;
  web workflow `42650984373` and CI `42650984180` passed, and the canonical
  site's JavaScript contains `whisper_moment_target`. Still no real-device
  end-to-end user session was run. Android 1.0.89 run `42650994778` remains in
  progress; don't describe it as released until Worker `/version` matches.

## Current user direction and notification release
- User asked to do all listed work **except item 5** (verification image
  retention). Do not further develop retention in this batch. Manual verification
  must not be activated in a way that silently bypasses the existing privacy
  and retention protections; its unresolved retention dependency limits safe
  end-to-end activation until addressed.
- Notifications: live Supabase migration `20261109161552_whisper_activity_notifications`
  changes the existing notification function to emit content-free Whisper
  events, respect settings and deduplicate unread sender/thread events. Member
  execute denied, service_role allowed; stored SQL digest excluding newline
  `e40be4412f28560cdf975fdb48dce2559d665acb09d807c12591b04f7655dfee`
  matches repository. Candidate release branch `build/holup-notification-release`
  commit `0dd280a` includes full-screen Yours/From Holup/settings, grouped
  categories, actual notifications and the production migration; focused CI
  `42652614942` on `a2bc5f6` passed (same SQL, earlier filename). It retains
  legacy Add Up wording/routes until relationship backend cutover.
- This release is **not on main or live in the client**. Android 1.0.89 run
  `42650994778` was still compiling, so don't push main until finished: bot
  directly pushes release metadata. After finish fetch main, rebase/cherry-pick
  candidate carefully, bump Android to a new version with release note, push main,
  verify web/Vercel and then dispatch Android. The SQL migration is already
  production and main must acquire the exact file before another database push.
- Pending Whisper deletion and Space relationship migrations renumbered
  `20261109161553` and `20261109161554`; both remain unsafe to bulk deploy.
