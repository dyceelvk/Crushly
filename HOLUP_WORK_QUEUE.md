# Holup work queue — not a release checklist completion claim

## Latest decisions
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
