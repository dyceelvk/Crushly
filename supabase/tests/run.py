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
# Supabase records and executes migrations once; these one-shot migrations
# create security-sensitive tables rather than claiming to be re-runnable.
ONE_SHOT_MIGRATIONS = {
    '20261109133904_manual_evidence_retention_foundation.sql',
    '20261109134050_protect_evidence_cleanup_auth.sql',
    '20261109140000_manual_verification_backend_inactive.sql',
}
SEED = ROOT.parent / 'seed.sql'
# Two ways to run: `pgserver` conjures a throwaway Postgres (default), or
# TEST_DATABASE_URL points at one we were given. A plain Postgres is not a
# Supabase project, so it still needs stubs.sql — TEST_USE_STUBS=1 says exactly
# that. Without it, pointing at a URL means "the real platform schemas are
# already there", which is what `supabase start` gives you.
DB_URL = __import__('os').environ.get('TEST_DATABASE_URL')
STUBS = (not DB_URL) or __import__('os').environ.get('TEST_USE_STUBS') == '1'

# `pgserver` is only needed to conjure a throwaway Postgres. When
# TEST_DATABASE_URL points at a server we were given, the import is dead weight
# — and on a machine where pgserver has no wheel (no wheel for this Python, or
# an offline box) it turns a working test run into an ImportError. Import it
# where it is used, not at the top.
pgserver = None
if STUBS and not DB_URL:
    import pgserver


def main() -> int:
    data_dir = None
    if DB_URL:
        uri = DB_URL
    else:
        data_dir = tempfile.mkdtemp(prefix='crushly-pg-')
        db = pgserver.get_server(data_dir)
        uri = db.get_uri()

    # Migrations contain em dashes and curly quotes. A database whose locale
    # defaults to SQL_ASCII would reject them, so ask for UTF-8 explicitly
    # rather than depending on the host's environment.
    conn = psycopg2.connect(uri, client_encoding='UTF8')
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
        # Re-apply only migrations designed for re-runs. Production's
        # migration history runs every version once; the one-shot security
        # migrations above must not recreate protected tables or reset data.
        for f in MIGRATION_FILES:
            if f.name in ONE_SHOT_MIGRATIONS:
                continue
            if not run_file(f):
                return 1
        print('re-runnable migrations applied twice')
        if not run_file(SEED):
            return 1
        print('migrations + seed applied')
        for table in ['profiles', 'photos', 'crushes', 'connections', 'conversations', 'messages', 'moments', 'notifications']:
            cur.execute(f'select count(*) from {table}')
            print(f'  {table}: {cur.fetchone()[0]}')
        # Existing call smoke cases exercise the enabled feature; production defaults off.
        cur.execute("update public.holup_features set enabled=true where key='calls'")
        if not run_file(ROOT / 'smoke.sql'):
            return 1
        if not run_file(ROOT / 'internal_profile_serializer.sql'):
            return 1
        if not run_file(ROOT / 'policy_helpers.sql'):
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
        # A Circle you are not in is joinable by asking, and only the owner can
        # answer — enforced by the functions, not by the button.
        if not run_file(ROOT / 'circle_requests.sql'):
            return 1
        # Circles can be found, and there are exactly three ways in: open,
        # approved, or invited — each enforced here rather than by a button.
        if not run_file(ROOT / 'circle_discovery.sql'):
            return 1
        if not run_file(ROOT / 'shared_post.sql'):
            return 1
        # The Flow is ranked: scored from what people read, resumable by cursor,
        # and able to say why each post is where it is.
        if not run_file(ROOT / 'ranked_feed.sql'):
            return 1
        # Clips are back on. The rail that makes them visible is a public
        # surface with a ranking, so it is tested for what it must never show.
        if not run_file(ROOT / 'circles_and_clips.sql'):
            return 1
        # Your own post is a post: you may Crush it, it belongs in Crushes, and
        # both feeds can be walked to the end instead of stopping at one page.
        if not run_file(ROOT / 'own_posts_and_paging.sql'):
            return 1
        # Crushes shows eligible posts, not only your connections' posts: three
        # members' Space posts reach a reader who has added up with none of them,
        # while audience, blocks and Circle rooms still hold.
        if not run_file(ROOT / 'crushes_is_the_feed.sql'):
            return 1
        # Notifications are social: no Whisper rows, follows announced once and
        # switchable, mentions land on their post, Crush still notifies.
        if not run_file(ROOT / 'notifications_social.sql'):
            return 1
        if not run_file(ROOT / 'post_location.sql'):
            return 1
        if not run_file(ROOT / 'whisper_moment_links.sql'):
            return 1
        # Add Up is a request: it waits, it can be accepted, declined or taken
        # back, a second ask is a no-op, and a decline cools off for a week.
        # Keep Close is not part of any of it.
        if not run_file(ROOT / 'add_up_requests.sql'):
            return 1
        # Whisper is live: delivery is stamped once by the recipient, reading
        # implies having, receipts stay behind both switches, and the private
        # channel is only joinable by the two members of an open thread.
        if not run_file(ROOT / 'whisper_live.sql'):
            return 1
        if not run_file(ROOT / 'whisper_presence_guard.sql'):
            return 1
        if not run_file(ROOT / 'space_search.sql'):
            return 1
        if not run_file(ROOT / 'post_private.sql'):
            return 1
        if not run_file(ROOT / 'private_viewers.sql'):
            return 1
        cur.execute("update public.holup_features set enabled=false where key='calls'")
        if not run_file(ROOT / 'public_share.sql'):
            return 1
        if not run_file(ROOT / 'search_trends.sql'):
            return 1
        if not run_file(ROOT / 'admin_controls.sql'):
            return 1
        if not run_file(ROOT / 'admin_triage.sql'):
            return 1
        if not run_file(ROOT / 'space_counts.sql'):
            return 1
        # Holup is 16+: the floor is in the database, so it is tested there.
        if not run_file(ROOT / 'minimum_age.sql'):
            return 1
        print('ALL TESTS PASSED')
        return 0
    finally:
        conn.close()
        if data_dir:
            shutil.rmtree(data_dir, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
