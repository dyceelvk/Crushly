# Keep Close subscriptions and Whisper requests: isolated experiment only

**Not a migration, not production-ready, not called by the current client.** The
previous `relationship-work/` approval-based Keep Close prototype is superseded
by the user's later decisions. Do not deploy either prototype.

## Confirmed product decisions

- Add Up remains a separate immediate, one-way follow. Keep Close is also an
  immediate, one-way subscription; two subscriptions create mutual Keep Close.
- The Space owner and people who subscribe to the owner through Keep Close may
  see the owner's Kept Close identity list (subject to profile/block privacy).
- Any otherwise eligible sender may send at most two Whisper messages as a
  request. The recipient may accept explicitly or by replying. Two means two
  total before acceptance, not two at a time; deleting a message cannot reset it.
- A setting lets any otherwise eligible person message without acceptance.
  Conversations started while the setting is on remain available if it is later
  switched off. An accepted conversation is independent of subsequent Keep Close
  changes. Blocks still stop contact.
- Existing conversations are to be preserved as accepted. The experiment does
  not automatically reopen a previously closed conversation or defeat a block.
  The adult age gate remains; teen mode must not launch until fully isolated.

## What has been built and tested

The standalone `v3_` experiment retains existing one-way Keeps and adds both
subscription directions for existing connections, provides directional subscribe,
withdraw, counts and a profile-filtered subscriber list, and stores a durable
message-request counter independently of message rows. The guard serializes
sends/decisions/blocks and covers inserted message kinds, including Moment
replies. Reply or explicit acceptance makes the request accepted; the first
message while open messaging is enabled creates a lasting conversation. The
migration initializes open messaging from the existing `who_can_message` choice.
A staged legacy-data fixture, idempotent replay, selected authorization tests and
seven concurrent database race cases pass in a fresh local PostgreSQL database.

The tests invoke a disposable security-definer test sender to exercise the
insert guard. **They do not test the real application send/open APIs.**

## Essential work before integration or release

- Rewrite real Whisper open/send, message list/read/media/reaction/presence,
  receipts, Moment replies, notifications, badges, call and realtime access so
  pending requests work without exposing more than intended; build explicit
  requests inbox, accept/decline UI, reply-to-accept behavior and open-setting UI.
  Ensure all entry points and installed clients use the same quota and policy.
- The old app and old schema still treat `connections` as a relationship for
  many profile/post/Moment privacy checks. The experimental `v3_` subscription
  functions deliberately do not rewrite that model. Align mutual Keep Close,
  existing relationship conversion, feeds, audiences, Add Up/list privacy,
  discovery, and old-client compatibility without affecting accepted Whispers.
- Integrate and test the empty-composer rule: the first *actual sender*, not
  the first person to open an empty composer, becomes the requester. A blank
  composer cannot itself accept a request; verify all client entry points.
- Define rejected-request retry/anti-harassment limits, settings changes,
  notification delivery, deletion and abuse controls; the experiment currently
  keeps a declined request closed and does not implement a new-request retry UI.
- Remove the currently unsafe private-channel assumption. Supabase caches
  realtime authorization on connection/token refresh, so blocking a pair must
  revoke active channels, not merely fail a subsequent join. Active calls need
  server-side termination and real-service verification. Calls remain disabled.
- Verify real row-level privileges and all direct table/RPC paths; ensure setting
  updates and send/block/accept races are serialized consistently. Add full
  integration, migration/rollback on representative data and physical Android
  tests. Already-received material cannot be recalled.
- Protected 13-second public-video previews, real teen isolation, the Android
  release smoke failure and other outstanding user requirements remain open.

## Disposable test database only

1. Initialize the Supabase stubs, apply and run the complete normal test suite
   through `supabase/tests/run.py`.
2. Run `supabase/relationship-work/02_fixture.sql` (destructive), then
   `01_experiment.sql` twice and `02_test.sql`, all with `ON_ERROR_STOP=1`.
3. Set `TEST_DATABASE_URL` to the disposable database and run
   `python3 supabase/subscription-whisper-work/03_concurrency.py` (destructive).

The test suite does not establish production safety and does not authorize rollout.
