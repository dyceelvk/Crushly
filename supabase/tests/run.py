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

import pgserver
import psycopg2

ROOT = pathlib.Path(__file__).resolve().parent
MIGRATIONS = ROOT.parent / 'migrations'
SEED = ROOT.parent / 'seed.sql'
STUBS = not bool(__import__('os').environ.get('TEST_DATABASE_URL'))


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
        for f in sorted(MIGRATIONS.iterdir()):
            if not run_file(f):
                return 1
        if not run_file(SEED):
            return 1
        print('migrations + seed applied')
        for table in ['profiles', 'photos', 'crushes', 'connections', 'conversations', 'messages', 'moments', 'notifications']:
            cur.execute(f'select count(*) from {table}')
            print(f'  {table}: {cur.fetchone()[0]}')
        if not run_file(ROOT / 'smoke.sql'):
            return 1
        print('ALL TESTS PASSED')
        return 0
    finally:
        conn.close()
        if data_dir:
            shutil.rmtree(data_dir, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
