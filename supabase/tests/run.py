"""Crushly backend smoke tests.

Applies the platform stubs (stubs.sql), all migrations and seed.sql to a throwaway
Postgres, then runs smoke.sql: RLS isolation, privacy (no coordinates or
birthdates on the wire), discover filtering, Crush → Mutual Crush, messaging,
read receipts, Moments, notifications, blocks and account deletion.

    python -m venv .venv && .venv/bin/pip install pgserver psycopg2-binary
    .venv/bin/python supabase/tests/run.py

`pgserver` ships a self-contained Postgres (no Docker needed). To run against a
`supabase start` stack instead, point TEST_DATABASE_URL at its Postgres and skip
stubs.sql (the real platform schemas are already there).
"""
import pathlib
import shutil
import sys
import tempfile

import psycopg2

ROOT = pathlib.Path(__file__).resolve().parent
MIGRATIONS = ROOT.parent / 'migrations'
# Only the SQL. `migrations/` also holds a README, and feeding that to psql
# fails with a syntax error that has nothing to do with any migration.
MIGRATION_FILES = sorted(p for p in MIGRATIONS.iterdir() if p.suffix == '.sql')
SEED = ROOT.parent / 'seed.sql'
STUBS = not bool(__import__('os').environ.get('TEST_DATABASE_URL'))

# `pgserver` is only needed to conjure a throwaway Postgres. When
# TEST_DATABASE_URL points at a server we were given, the import is dead weight
# — and on a machine where pgserver has no wheel (no wheel for this Python, or
# an offline box) it turns a working test run into an ImportError. Import it
# where it is used, not at the top.
if STUBS:
    import pgserver
else:
    pgserver = None


def main() -> int:
    if STUBS:
        data_dir = tempfile.mkdtemp(prefix='crushly-pg-')
        db = pgserver.get_server(data_dir)
        uri = db.get_uri()
    else:
        data_dir = None
        uri = __import__('os').environ['TEST_DATABASE_URL']

    conn = psycopg2.connect(uri)
    conn.autocommit = True
    cur = conn.cursor()

    def run_file(path: pathlib.Path):
        print(f'== {path.name}')
        try:
            cur.execute(path.read_text())
        except Exception as e:  # noqa: BLE001 - show the failing SQL context
            print(f'FAILED: {e}')
            conn.rollback()
            return False
        return True

    try:
        if STUBS and not run_file(ROOT / 'stubs.sql'):
            return 1
        for f in MIGRATION_FILES:
            if not run_file(f):
                return 1
        # Re-apply every migration: the SQL is intentionally re-runnable so
        # setup.sql can be pasted into a live project again without errors.
        for f in MIGRATION_FILES:
            if not run_file(f):
                return 1
        print('migrations applied twice (idempotent)')
        if not run_file(SEED):
            return 1
        print('migrations + seed applied')
        for table in ['profiles', 'photos', 'crushes', 'connections', 'conversations', 'messages', 'moments', 'notifications']:
            cur.execute(f'select count(*) from {table}')
            print(f'  {table}: {cur.fetchone()[0]}')
        if not run_file(ROOT / 'smoke.sql'):
            return 1
        # Comments are a conversation now: likes, one level of replies, and a
        # delete that cannot take somebody else's words with it.
        if not run_file(ROOT / 'comments.sql'):
            return 1
        # Saving a post is a row now, not a local flag that forgets.
        if not run_file(ROOT / 'saves.sql'):
            return 1
        # Every function that returns a post must return a whole one.
        if not run_file(ROOT / 'post_shape.sql'):
            return 1
        # Vibes are gone — the tables, the functions, and every reference to
        # them left inside a function body that still has to work.
        if not run_file(ROOT / 'no_vibes.sql'):
            return 1
        if not run_file(ROOT / 'shared_post.sql'):
            return 1
        # The Flow is ranked: scored from what people read, resumable by cursor,
        # and able to say why each post is where it is.
        if not run_file(ROOT / 'ranked_feed.sql'):
            return 1
        print('ALL TESTS PASSED')
        return 0
    finally:
        conn.close()
        if data_dir:
            shutil.rmtree(data_dir, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
