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
- Audit every Whisper entry point (including existing history, sync, media,
  receipts, presence and direct RLS) for the chosen access and revocation rules.
  The included tests cover send/open/reaction/realtime, not the entire audit.
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
4. Point `TEST_DATABASE_URL` at that disposable database and run
   `python3 supabase/relationship-work/05_concurrency.py`.

This is partial engineering verification, not a production-safety or release
certification.
