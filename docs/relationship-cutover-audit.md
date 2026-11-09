# Holup relationship cutover — production audit and compatibility contract

**Status:** review artifact only. This is not a deployment approval and contains no production migration.

**Audited production project:** `yzcssyebozfkmojqqdhc`

**Schema history observed:** through `20261109182606_existing_close_ones`

**Draft client/source branch:** `build/holup-follow-draft` at `8675fad4a6305d6760063dcdd1e7c2ab8f6802d3`

## Decision

Add Ups, Homies and Whispers must be delivered as a single, versioned contract. The disposable scripts under `supabase/follow-redesign-work/` are useful model experiments, but are not independently deployable migrations.

No production DDL, DML, RLS, Realtime policy, bucket configuration, release configuration, or Android artifact was changed during this audit, with one exception: the reviewed minimum-age migration `20261109225634_minimum_age_16` recorded below.

## Minimum-age product decision

Holup is a single **16+** product: a person younger than 16 must not be granted access. This is not an adult-only product and does not require a second Supabase project, teen account type, or teen-mode account class.

**Applied:** migration `20261109225634_minimum_age_16` (source: `supabase/migrations/20261109225634_minimum_age_16.sql`) replaced the 18+ threshold in production on 2026-11-07. It reuses the existing `experimental_check_adult_profile` trigger and `experimental_adult_profile_gate` trigger definition, so it adds no new gate surface:

- the gate now refuses anyone whose birthdate is later than `current_date - 16 years`, with `403 minimum_age` and the message "Holup is for people aged 16 and over.";
- exactly 16 today is eligible;
- `preferences.age_min` defaults to 16 and a `preferences_age_range_check` constraint keeps both bounds inside 16..99 with `age_min <= age_max`;
- preflight confirmed 0 of 13 stored preference rows fell outside the new range, so no user data was rewritten.

Verified after applying: `pg_get_functiondef` shows the 16-year interval and no 18-year interval; the trigger is present and enabled (`tgenabled = O`); the default is `16`; the constraint is present. Gate behaviour was exercised through a session-local temp-table harness (no production rows written): 15 years blocked, 16 years minus one day blocked, exactly 16 allowed, 30 years allowed, 105 years blocked as `invalid_birthday`, malformed input blocked as `invalid_birthday`. Preference behaviour was exercised by updates that were rolled back: `age_min = 15` blocked, `age_min = 16, age_max = 99` allowed, inverted range blocked, and the sampled row was unchanged afterwards.

Ordering: the server change deliberately ships before the matching client copy. A more permissive server is harmless to already-installed 18+ clients, whereas 16+ copy in front of an 18+ server would show an eligible person a rejection they cannot resolve.

Backend coverage: `supabase/tests/minimum_age.sql` (wired into `supabase/tests/run.py`) asserts the same six behaviours against a throwaway Postgres — under-16 refused with the public code, sixteenth birthday admitted, the day before refused, malformed and implausible birthdays refused, the preference default and range constraint, and an onboarded profile with no birthday refused. It has **not been executed here**: this sandbox has no `pgserver` wheel and no Postgres binaries, so the local harness could not start. The assertions were instead exercised directly against the production trigger through a session-local temp-table harness that writes no member rows, and by rolled-back preference updates.

Outstanding age gap, not introduced or changed here: one profile row is `onboarded = true` with a null birthdate, so it predates the gate and is not age-verified. The trigger refuses that combination on any future write, so the row is legacy data that needs a separate, user-safe decision rather than a silent backfill.

## Validation status (2026-11-07)

The candidate is no longer only a model. On a disposable PostgreSQL 17 cluster, with every
migration in `supabase/migrations/` and `seed.sql` replayed from scratch:

- `04a_homies_migration_fixture.sql` → `01_follow_candidate.sql` → `04_homies_candidate.sql`
  → `07_whisper_candidate.sql` all apply cleanly on top of the deployed legacy baseline.
- `02_follow_test.sql`, `05_homies_test.sql`, `08_whisper_test.sql` all pass.
- Concurrency on a real server with real locks: 25 follow/block races, 25 request/block and
  25 accept/block races, 20 two-message quota races — all passed (`HOLUP_TEST_DSN` now
  overrides the hardcoded socket so the scripts can run anywhere).
- The full legacy suite still passes afterwards (28 files, `ALL TESTS PASSED`), so the
  candidates do not break what is live.

What this does **not** prove, and why the migration still must not ship alone: no legacy API,
notification, media, call or Realtime path reads the new state yet. `send_message`,
`open_conversation`, `ensure_conversation`, `remove_connection`, `can_view_media`,
`can_join_whisper`, the `messages_pair` policy and the `realtime.messages` policy are all
still keyed to legacy conversations. Applying the migration now would create relationship
state that installed clients neither see nor respect — exactly what the cutover rule forbids.

## What is live today

- **Add Ups / connections:** legacy `crushes`, `connections`, `keeps`, and `passes` are still authoritative in several routes.
- **Whispers:** legacy `conversations`/`messages` are opened by `open_conversation` and `ensure_conversation`; the latter reopens any closed pair conversation.
- **Legacy mutations still exposed:** `crush_member`, connection-request functions, `keep_close`, `let_go`, `remove_connection`, `open_conversation`, `ensure_conversation`, `send_message`, and `block_member`.
- **Realtime:** `realtime.messages` permits `whisper:<conversation_id>` based only on membership, `closed`, and blocks. It does not know consent state.
- **Calls:** `register_call_room` and `can_join_call` rely on the old `messaging_block_reason`, so a pending Whisper must be explicitly excluded from calls.
- **Media:** `media` is private and each media request is checked server-side. `can_view_media` already rejects blocks but currently only checks conversation membership for message media, not a Whisper-consent record.
- **Direct table reads:** no shipped client reads `messages` or `conversations` directly, but the existing `messages_pair` RLS policy would permit a participant to read a blocked pair’s messages if REST table access were used. The replacement must close this gap.

## Non-negotiable model

| Area | Required invariant |
| --- | --- |
| Add Ups | Directional. An Add Up is active immediately unless the recipient enables approval; then it is pending until they accept. It never creates a Homie or implicitly grants messaging. |
| Homies | Separate, symmetric friendship. Only explicit acceptance creates a permanent Homie. The only removal route for an accepted Homie is a block. Pending requests may be withdrawn or declined. |
| Historic conversion | Only `holup_existing_close_pairs` still present in `connections` become accepted Homies. Each other retained `keeps` row becomes a pending Homie request. Reciprocal Keeps remain two requests; they are never inferred as consent. Blocked pairs are excluded. |
| Whispers | Independent from Add Ups and Homies. A requester may send at most two messages while pending. The recipient’s reply or explicit acceptance accepts it. Recipient open-messaging opt-in accepts only upon a real first message and remains durable after that preference changes. |
| Existing Whisper history | Every existing, unblocked, open conversation becomes an accepted Whisper permission. Closed conversations remain closed and cannot be reopened by a legacy helper. |
| Blocks | One pair lock must serialize blocks, follow changes, Homie changes, Whisper opening/sending/accepting, and call creation. A block removes both directional follows, all Homie state, pending Whisper state, active call rooms, and closes only that pair’s conversation. Unblock never restores any of them. |
| Privacy | Space visibility, profile eligibility, blocks, and content visibility are checked by server functions. Follows/Homies never silently make a Space, Moment, post, message medium, receipt, or presence visible. |
| Moment replies | `reply_to_moment` must enter the same Whisper permission path. The reply stores only `momentId`; opening it must resolve the original Moment under current visibility, never a copied snapshot. |

## Required compatibility boundary

A new client must send a public, non-secret request header:

```
x-holup-contract: relationship-v2
```

The server checks it using `current_setting('request.headers', true)`. This is **not** authorization; it is a migration-version marker. Authentication, RLS, profile gates, block gates, and row-level permission checks remain mandatory.

After the cutover, every relationship-changing legacy RPC must reject with a clear `426 client_update_required` error unless it is a safety action. In particular, old versions must not be able to:

- create or reopen a Whisper with `open_conversation` / `ensure_conversation`;
- send a message that starts a consent request;
- add or remove a Keep, Add Up, connection, or Homie;
- call `remove_connection` and close a Whisper that is not part of that old relationship action.

Read-only conversation routes may remain compatible only if they use the new permission predicate. Block, unblock, report, and account-safety paths remain available without the marker; they acquire the same pair lock and perform the new cleanup.

A header is necessary because a database RPC cannot otherwise distinguish an installed old client from the new client using the same authenticated session. The app draft now sends this header globally; the production server must not enforce it until the coordinated release is ready.

## Replacement surface

The final single migration must install all of the following before it enables any cutover gate:

1. **Tables and indexes**
   - `holup_follow_settings`, `holup_follows`, rate-limit attempts;
   - `holup_homies`, `holup_homie_requests`, rate-limit attempts;
   - `holup_whisper_permissions`, plus `privacy.holup_whisper_open`;
   - indexes for incoming/outgoing lists, permission lookup, and pending messages.
2. **One shared pair lock and state helpers**
   - pair lock;
   - `holup_require_relationship_v2()`;
   - `holup_whisper_access(conversation, viewer)` and an assertion helper;
   - a controlled `holup_begin_whisper_request` that is the only creator/reopener of conversations.
3. **Conversion**
   - lock affected legacy tables while copying;
   - insert only unblocked historic accepted pairs from `holup_existing_close_pairs` plus still-live `connections`;
   - insert unblocked Keep rows as pending requests;
   - convert all unblocked open legacy conversations to accepted Whisper permissions;
   - make conversion idempotent and record a marker/counts for rollback review.
4. **Legacy safety wrappers**
   - `keep_close`, `let_go`, `crush_member`, request/answer/cancel connection routines, `remove_connection`, `ensure_conversation`, `open_conversation`, and legacy message-start paths must fail closed with `426` after the migration;
   - no legacy routine may delete `connections` or reopen/close a conversation as a side effect of relationship conversion;
   - `send_message` must use the same Whisper permission guard and must never bypass the two-message limit.
5. **Whisper reads and side effects**
   - `load_conversation`, `list_conversations`, `get_messages`, read/delivery receipts, reactions, presence, Moment-link resolution, calls, and notification routing must call the new predicate;
   - pending state is visible only to its requester and recipient; it is never made public;
   - a decline/withdraw closes or hides only the corresponding pending request and never closes another pair’s accepted Whisper.
6. **Data access / media / Realtime**
   - replace `messages_pair` and conversation policies with a block-aware, permission-aware predicate;
   - update `can_view_media` for `messages/` to require the same predicate;
   - update `can_join_whisper` to require current permission and make block revocation immediate for the next authorization check;
   - update `register_call_room`/`can_join_call` to require accepted state; close active call rooms on block;
   - preserve private bucket access and avoid public URL promotion.
7. **Space and notification APIs**
   - replace old relationship counts/lists with Add Up, Added Up, and Homie identities, using the chosen visibility setting and profile/block filtering;
   - make pending follow/Homie/Whisper notifications specific and non-duplicative;
   - remove stale “connection”/“mutual crush” text from the release client.

## Known blockers in the current draft

1. The SQL in `follow-redesign-work/` does not replace the legacy conversation, message, receipt, reaction, presence, call, Moment-reply, RLS, media, or Realtime surface.
2. `ensure_conversation` currently reopens closed threads. Without a replacement it can revive a declined or block-closed Whisper.
3. `remove_connection` calls `disconnect_pair`, which closes the pair’s conversation. It must not remain callable by old clients after Homies are independent.
4. Existing `send_message` is gated by old connection/`who_can_message` rules before the candidate Whisper insert trigger runs. This conflicts with independent request-first Whispers.
5. Existing `can_join_whisper` authorizes any unblocked conversation participant, regardless of request state; `can_join_call` has the same old relationship dependency.
6. The draft app has Add Up/Homie candidate UI, but the main Crushes and Whispers routes still use legacy RPCs and vocabulary. It does not yet provide request-state UI, recipient accept/decline controls, or the new open-messaging setting.
7. Moment replies currently use `ensure_conversation` directly and bypass the normal send RPC. They must be moved behind the new controlled conversation/permission path.
8. Message media is private and block-aware today, but needs Whisper-permission enforcement so a pending/declined/blocked conversation cannot be used as a durable media access handle.
9. Browser gesture coverage and Android release hardening remain separate unfinished work; neither can be represented as complete because of this database cutover.

## Validation matrix required before any production action

### Schema and conversion

- disposable branch with schema only: clean migration apply and a second idempotence apply;
- fixture accounts covering unblocked historic accepted pair, one Keep, reciprocal Keeps, blocked Keep, blocked connection, open thread, closed thread, pending legacy Add Up, and invisible Space;
- assertions that conversion counts match the fixture and zero blocked state survives.

### Concurrency and revocation

Run each with two authenticated sessions and explicit transaction barriers:

- follow versus block; Homie accept versus block; Whisper first/second send versus block; recipient accept/reply versus block;
- simultaneous two sends at the two-message boundary; simultaneous request/withdraw; two simultaneous Homie accepts;
- block after Realtime join, after a signed media request, and while a call channel exists;
- confirm every raced mutation either commits then is removed by the block, or fails. No post-block content, receipt, presence, notification, or broadcast is visible.

### Client / API / media

- release-client smoke on physical Android and iOS where available: Add Up immediate/pending, all list visibility settings, Homie request/accept/decline/withdraw, Whisper limit/accept/reply/open preference, Moment reply link, media, receipts, presence, calls, block/unblock;
- old installed build: relationship mutation gets an actionable update-required error and cannot close/reopen a Whisper; safety block/report still works;
- new build’s marker absent/present tests at the server boundary;
- direct REST/RLS rejection tests, Realtime authorization tests, and signed-media rejection after decline/block.

### Rollout controls

- export pre/post conversion counts (not private content), migration checksum, and rollback decision record;
- build and distribute the compatible client before enabling mutation gates;
- staged cohort first, monitored errors/permission denials, then full rollout;
- do not drop legacy tables or history during the cutover. Retain them read-only until a separately reviewed retention/rollback window expires.
