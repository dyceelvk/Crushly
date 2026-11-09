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
