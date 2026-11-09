# Relationship redesign — isolated experiment, NOT a migration

Nothing in this directory is deployed or picked up by the normal migration runner.
Do not copy it to production or publish the dependent client as-is.

`01_core.sql` is an atomic prototype: existing connections remain approved;
legacy one-way Keeps become pending requests; active Add Ups stay follows;
explicit approval creates connections; removing Keep Close does not unfollow;
blocking severs both; and message sends, reactions, conversation opens and
realtime joins require approval. Old Add Up request-decision RPCs fail closed.
Pair locks serialize the tested request/block and approval/block in both orders, plus removal/send races. The Space
list helper additionally prevents a cancelled legacy Add Up from revealing a
connections-only profile.

## Known release blockers

- The local app now has prototype Space controls, paged Keep Close requests,
  request/acceptance notification text and routing, and a Keep Close notification
  switch. These changes depend on this experimental SQL and cannot be deployed
  against the old server. Offline browser tests do not prove native behavior.
- Profile serialization and `crushes_feed` have prototype replacements, but
  badges, Discover, historical notification cases and all relationship-dependent
  entry points still need a complete audit. Existing installed clients interpret
  these events differently; design and verify an update/compatibility gate before
  any rollout. The prototype uses the old `keep` kind with body markers for
  requests and approvals; old clients cannot interpret those safely.
- `06_whisper_access.sql` implements the user-confirmed policy in an experiment:
  after ending or blocking a pair, history/media are kept but not readable until
  fresh approval and reopening. Its SQL gates history, sync, Moment links, direct
  row reads, reactions, presence, media, badges, receipt writes and new call
  rooms. Sender-side delete remains possible after ending, but the UI does not
  yet provide a separated-thread deletion flow; block currently denies deletion.
  This needs a complete privacy/UX audit.
- A dangerous realtime gap remains: Supabase Realtime can cache channel
  authorization for an existing subscription, and clients can send arbitrary
  broadcast payloads, not merely the signals used by our client. A changed SQL
  `can_join_whisper` test does **not** prove immediate revocation of an already
  joined channel. Supabase documents the cached permissions explicitly at
  https://supabase.com/docs/guides/realtime/authorization. Design/test a
  server-enforced revocation or disable the unsafe
  transport with a compatible client; also prove active calls are terminated.
  The calls feature remains disabled in production. Do not ship on SQL tests alone.
- Direct `messages.read_at` and `delivered_at` were exposed by raw table SELECT
  despite receipt privacy. The experiment revokes that raw access and requires
  current clients to use the receipt-filtered RPC. This breaking change requires
  a verified installed-client gate. Verify real PostgREST privileges and behavior.
- Historical notification routing, client-side caches after revocation, genuine
  storage/Worker access, all background/push paths, and realtime behavior need
  integrated tests with real Supabase. The local app now clears visible chat
  history after an authoritative denial, suppresses stale in-flight responses
  and reconnects after a successful retry; this is not an immediate server-side
  socket revocation. Already downloaded or in-flight bytes cannot be recalled.
- Prove data conversion and atomic rollout against a representative copy, assess
  lock duration and rollback, and add migration tests to the canonical suite.
  This prototype intentionally keeps old migrations/tests unchanged.
- Teen-only mode, protected server-rendered public-video previews, and Android
  release/device verification remain separate launch blockers.

## Disposable-database verification

The fixtures in `02_fixture.sql` **delete real data**. Never run them against a
production, staging, or shared database. On an empty local PostgreSQL database
with Supabase stubs installed:

1. Run `supabase/tests/run.py` against that database to apply the normal schema,
   seed and full legacy tests. The stubbed platform setup is required first.
2. Run `02_fixture.sql`, then `01_core.sql` twice with `psql -v ON_ERROR_STOP=1`.
3. Run `03_test.sql` and `04_follow_whisper_test.sql` with the same setting.
4. Apply `06_whisper_access.sql` twice, then run `07_whisper_access_test.sql`.
5. Point `TEST_DATABASE_URL` at that disposable database and run `05_concurrency.py`
   and `08_receipt_concurrency.py`. These set up and change real rows and are
   strictly for disposable databases. Run `supabase/tests/whisper_moment_links.sql`
   after the prototype too.

This is partial engineering verification, not a production-safety or release
certification.
