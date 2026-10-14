# Crushly repository investigation

**Date:** 2026-10-13  
**Reviewed baseline:** `e0f4d54` on `arena/c42086c3-crushly`  
**Scope:** Expo app, Supabase migrations/RLS/RPCs, media Worker integration, setup artifacts and CI. No application behavior changed; no live database or deployment modified.

> **Follow-up:** fixes and automated regression tests have now been added on this
> branch. This document preserves the original findings; see
> [audit-fix-rollout.md](audit-fix-rollout.md) for implementation and deployment notes.
> The historical reproduction script deliberately stops at migration 025.

## Conclusion

This is not primarily a compile/build problem. The baseline checks pass, but several contracts between the client, database and file store disagree. The highest-priority faults concern private-media handling and authorization. Feature-level tests do not currently catch these integration failures.

## Checks performed

| Check | Result |
| --- | --- |
| Clean dependency install (`npm ci --no-audit --no-fund`) | Passed |
| App TypeScript (`npm run typecheck`) | Passed |
| Unit tests (`npm test`) | 100 app tests + 7 Didit tests passed |
| Web export (`npm run build:web`) | Passed using dummy offline Supabase configuration |
| Database smoke (`.venv/bin/python supabase/tests/run.py`) | Passed; all 25 migrations applied twice, seed and smoke assertions passed |
| Targeted database probes | Reproduced nine problematic behaviors/scenarios described below |
| Direct TypeScript media routing probe | `mediaKind('vibes/1/a.mp4')` returned `null` |
| Setup bundle inspection | Contains only migrations 001–010; migrations directory contains 001–025 |

The database tests used **throwaway local Postgres with the repository's Supabase stubs**, not the production Supabase stack. Browser E2E, Android/iOS execution, actual B2 uploads, provider callbacks and deployed configuration were not tested. Findings describe the checked-in implementation; production may have additional manual changes.

## Findings, in repair order

### 1. High — Private-media uploads fail open to public storage

**Locations:** `CrushlyApp/src/api/client.ts:225–248`; `supabase/migrations/20261008000003_storage.sql:11–25`.

`uploadMediaFile` catches every Worker upload error, including permission/quota failures, and falls back to Supabase Storage. The migrations create the `media` bucket as public and permit anonymous reads. No later migration makes it private.

**Evidence:** a simulated authenticated member could insert a chat-media object under their own folder; the anonymous role could then select it, and the bucket's `public` flag was true. The client fallback was verified by source inspection, not a live storage request.

**Impact:** a transient private-store failure can change a private chat attachment or connections-only Moment into a file accessible to anyone holding its URL. Worker authorization and quota failures can also be bypassed through this route.

**Repair:** fail closed for private media. If fallback is required, it must preserve the same authorization, expiry and quota rules. Plan compatibility/migration for existing public files rather than abruptly breaking their URLs.

### 2. High — Reserved staff usernames can be claimed through direct profile updates

**Locations:** `supabase/migrations/20261008000001_init.sql:312–314`; `supabase/migrations/20261010000013_reserved_usernames.sql:82–136`.

The `set_username` RPC checks reserved words and the daily change limit, but the profile update policy allows members to update their own row directly. There is no equivalent username trigger or column restriction. The verification badge has a dedicated guard; usernames do not.

**Evidence:** under the `authenticated` role, directly updating the seeded member's username to `support` succeeded, despite its reserved entry. The update also accepted a caller-supplied `username_updated_at`.

**Impact:** staff impersonation and bypass of the username change cooldown.

**Repair:** restrict direct writes to managed columns, retaining safe profile edits, or enforce username invariants at the database write boundary. Test direct REST/table writes as well as RPC calls.

### 3. High — Profile-photo authorization ignores blocking and visibility

**Location:** `supabase/migrations/20261010000017_vibes.sql:402–404`.

`can_view_media` returns `allowed: true` for any `photos/…` path once the caller has a member ID. It does not look up the photo, its owner, blocks or profile visibility.

**Evidence:** after inserting a block between two seeded members, the blocked peer's photo path still returned `{allowed: true, cacheable: true}`. Even a nonexistent photo row receives permission, though storage may subsequently return 404.

**Impact:** saved photo URLs remain authorized for blocked members. Orphaned files can remain readable; this is particularly concerning alongside finding 4.

**Repair:** resolve the actual photo/owner and apply the intended profile visibility and block rules on every request, including cache hits.

### 4. High — Worker media deletion fails its own ownership check

**Locations:** `supabase/migrations/20261010000017_vibes.sql:518–520`; `cloudflare/media-worker/src/index.ts:674–680`; `CrushlyApp/src/api/service.ts:293–303`.

The Worker supplies a URL shaped like `https://host/m/photos/123/file.jpg`. The SQL guard strips only the origin and compares the second path segment to the owner ID. That segment is `photos`, not `123`.

**Evidence:** for the same member-owned path, `can_manage_media(path, null)` returned true and `can_manage_media(path, actual_worker_shaped_url)` returned false.

**Impact:** normal Worker DELETE requests are denied. The app can remove a photo's database row, merely warn about cleanup, and leave its bytes behind. Combined with finding 3, removing a profile photo does not reliably revoke access through its saved URL.

**Repair:** canonicalize the `/m/` prefix consistently, verify path/URL identity, and test valid deletions plus cross-owner rejection. Address existing orphaned files separately.

### 5. High — Vibe uploads never reach their intended file store

**Locations:** `CrushlyApp/src/lib/mediaHost.ts:47–75`; `CrushlyApp/src/api/service.ts:1036–1051`; `supabase/migrations/20261008000003_storage.sql:20–25`.

`createVibe` uploads under `vibes/…`, but `MediaKind`, the routing parser, and the configured-kind filter omit `vibes`. Uploads therefore go directly to Supabase Storage, whose insert policy accepts only photos, moments and messages.

**Evidence:** executing the actual TypeScript parser returned `null` for a Vibe path. In local Postgres, an authenticated insert at `media/vibes/<own-id>/audit.mp4` was rejected by RLS.

**Impact:** Vibe creation fails with the checked-in configuration. Adding an environment variable alone cannot fix it because the parser/filter also reject the kind.

**Repair:** add Vibes to the shared media routing contract and test upload, playback, deletion and expiry end to end.

### 6. Medium — Upload quota counts published rows, not uploads

**Locations:** `supabase/migrations/20261010000023_circle_video.sql:62–84`; `cloudflare/media-worker/src/index.ts:619–627`.

The upload ticket function counts existing photos/messages/posts/etc. It never records a ticket or upload reservation. Uploading without subsequently publishing a row does not consume the quota; ordinary text messages also count against it.

**Evidence:** 41 successive upload-ticket requests succeeded for one seeded member without creating any published rows. No real files were uploaded.

**Impact:** the advertised 40/hour protection does not bound file uploads or orphaned storage. Busy text conversations can instead block legitimate media uploads.

**Repair:** use an atomic, server-side upload ledger/quota with expiry and orphan cleanup. Also remove the quota-bypassing fallback in finding 1.

### 7. Medium — Sending a chat message can skip an unseen incoming message

**Locations:** `CrushlyApp/src/api/hooks.ts:636–639, 702–703`; `supabase/migrations/20261008000002_functions.sql:845–849`.

The same cursor tracks both fetched messages and newly sent messages. A successful send advances it to the outgoing ID, even when earlier incoming messages have not been fetched.

**Reproduction:** load message A; the peer sends B between polls; the local member sends C; the send handler advances the cursor to C. The next query requests IDs greater than C and never fetches B. Using the last-polled cursor retrieves B.

This sequence was reproduced against the real local `get_messages` RPC using the cursor update from the hook. It was not a mounted React/browser test.

**Impact:** an incoming message can be absent until the conversation reloads. The message still exists in the database.

**Repair:** keep the receive cursor separate from optimistic/sent-message IDs and deduplicate when polling catches up. Add a controlled two-party timing regression test.

### 8. Medium — The documented manual database setup is 15 migrations behind

**Locations:** `supabase/setup.sql`; `supabase/setup/`; `supabase/scripts/bundle-setup.mjs`; root README deployment instructions.

The bundle and numbered setup parts stop at migration 010, while the app expects migrations through 025: usernames, posts, Circles, Vibes, engagement, editing and overload cleanup.

**Impact:** following the documented SQL-editor setup cannot create the backend expected by this app. The client also recommends this outdated bundle when reporting missing schema.

**Repair:** regenerate both forms using `cd supabase && npm run bundle:sql`, update the instructions and gate CI on generated-artifact parity. Existing smoke tests exercise migrations, not the committed setup bundle.

### 9. Medium — Invisible posts can make a populated feed appear empty

**Locations:** `supabase/migrations/20261010000020_post_engagement.sql:279–288, 328–348`; `supabase/migrations/20261010000024_post_video.sql:87–98`; `CrushlyApp/src/api/hooks.ts:221–243`.

Feed functions apply `LIMIT` before `can_view_post`. Blocked/private posts consume the page budget. The client can only continue from the last returned post, so a completely filtered page supplies no usable next cursor.

**Evidence:** with a newer blocked post and an older visible post, `flow_feed(1)` returned no items; `flow_feed(2)` returned the visible post.

**Repair:** filter authorization before limiting, or paginate scanned rows with an explicit continuation cursor. Add mixed-visibility feed tests.

### 10. Medium — The comments limit does not limit comments

**Location:** `supabase/migrations/20261010000020_post_engagement.sql:159–175`.

`post_comments_feed` applies `LIMIT` after `jsonb_agg`. At that point there is one aggregate row, so the limit does not constrain the comments inside it.

**Evidence:** a post with three comments returned all three when requested with `p_limit = 1`.

**Impact:** response sizes and query work grow with the full comment history despite the documented cap.

**Repair:** order and limit an inner comments query before aggregation; add a continuation mechanism if needed.

## Why the current tests remain green

- Unit tests mainly cover pure helpers rather than mounted stateful hooks or storage integration.
- Database smoke tests cover substantial functionality, but not these direct-write, URL-shape, quota and mixed-visibility cases.
- Migration tests do not check generated setup parity.
- A successful web export proves bundling, not authorization correctness or deployed configuration.

## Reproducing the investigation safely

`docs/audit/reproduce.py` creates its own disposable Postgres, applies the repository stubs/migrations/seed and runs the targeted probes. It does not accept or use a live database URL.

```bash
python -m venv .venv
.venv/bin/pip install pgserver psycopg2-binary
.venv/bin/python docs/audit/reproduce.py
```

**These diagnostic assertions confirm that the audited defects are present. They are not acceptance tests for correct behavior.** After fixes, convert the scenarios to normal regression tests with corrected expectations. The chat probe models the hook's cursor update; fallback behavior additionally relies on the client code path described above.

## Recommended next work

1. Close the media privacy and username authorization gaps; fix deletion and determine orphan cleanup requirements.
2. Restore Vibe routing and implement real upload accounting without a public fallback.
3. Correct chat receive cursors and feed/comment pagination.
4. Regenerate setup artifacts and add regression/parity gates.
5. Validate these fixes in staging with real Supabase/Worker integration, two member accounts and native builds before production rollout.

No live incident, exposed production file, or deployed schema state is asserted by this local audit.
