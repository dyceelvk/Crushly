"""Real concurrent RPC calls: per-member reservations must not overrun 40/hour."""
from concurrent.futures import ThreadPoolExecutor

import psycopg2


def test_upload_quota(uri):
    owner = psycopg2.connect(uri)
    owner.autocommit = True
    with owner.cursor() as cur:
        cur.execute("select id, auth_user_id from profiles where name = 'Daniel'")
        member, uid = cur.fetchone()
        cur.execute('select count(*) from media_upload_reservations where user_id=%s', (member,))
        assert cur.fetchone()[0] == 0, 'quota test requires an unused seeded member'

    def reserve(_):
        conn = psycopg2.connect(uri)
        conn.autocommit = True
        try:
            with conn.cursor() as cur:
                cur.execute("set statement_timeout = '15s'")
                cur.execute("select set_config('request.jwt.claim.sub', %s, false)", (str(uid),))
                cur.execute('set role authenticated')
                try:
                    cur.execute("select media_upload_ticket('vibes','video/mp4',1024)")
                    return True
                except psycopg2.Error as error:
                    if '__CRUSHLY__429__' not in str(error):
                        raise
                    return False
        finally:
            conn.close()

    try:
        with ThreadPoolExecutor(max_workers=8) as pool:
            accepted = sum(pool.map(reserve, range(45)))
        assert accepted == 40, f'expected exactly 40 reservations, accepted {accepted}'
        with owner.cursor() as cur:
            cur.execute('select count(*) from media_upload_reservations where user_id=%s', (member,))
            assert cur.fetchone()[0] == 40
        print('concurrent quota regression passed: 40 accepted, 5 rejected')
    finally:
        with owner.cursor() as cur:
            cur.execute('delete from media_upload_reservations where user_id=%s', (member,))
        owner.close()
