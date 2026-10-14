"""Diagnostic reproductions for docs/repository-audit.md.

All writes target disposable local Postgres; no production credentials are used.
Assertions confirm the audited defects, NOT the desired fixed behavior.
This is deliberately not included in the normal smoke suite. After repairs,
turn these scenarios into regression tests with the opposite expectations.
Run with: .venv/bin/python docs/audit/reproduce.py
Dependencies: pgserver, psycopg2-binary (same as the existing smoke runner).
"""
from pathlib import Path
import tempfile
import pgserver
import psycopg2

ROOT = Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory(prefix='crushly-audit-') as tmp:
    db = pgserver.get_server(tmp)
    conn = psycopg2.connect(db.get_uri())
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute((ROOT / 'supabase/tests/stubs.sql').read_text())
    # Historical evidence only: reproduce the audited baseline, not the fixes.
    for f in sorted((ROOT / 'supabase/migrations').glob('*.sql')):
        if f.name > '20261012000025_drop_superseded_overloads.sql':
            continue
        cur.execute(f.read_text())
    cur.execute((ROOT / 'supabase/seed.sql').read_text())
    cur.execute("select id, auth_user_id from profiles where name = 'Daniel'")
    me, uid = cur.fetchone()
    cur.execute("select id from profiles where name = 'Marcus'")
    peer = cur.fetchone()[0]
    def auth():
        cur.execute("select set_config('request.jwt.claim.sub', %s, false)", (str(uid),))
        cur.execute('set role authenticated')
    def start():
        cur.execute('begin')
    def end():
        cur.execute('rollback')
        cur.execute('reset role')

    start(); auth()
    cur.execute("update profiles set username = 'support', username_updated_at = 0 where id = %s returning username", (me,))
    assert cur.fetchone()[0] == 'support'
    print('CONFIRMED: authenticated member can directly claim reserved @support')
    end()

    start(); auth()
    path = f'photos/{me}/audit.jpg'
    cur.execute('select can_manage_media(%s, null), can_manage_media(%s, %s)', (path, path, f'https://worker.example/m/{path}'))
    result = cur.fetchone()
    assert result == (True, False), result
    print('CONFIRMED: own media deletion allowed without URL, denied with actual Worker /m/ URL:', result)
    end()

    start(); auth()
    for _ in range(41):
        cur.execute("select media_upload_ticket('messages', 'video/mp4', 1024)")
        assert cur.fetchone()[0]['path'].startswith(f'messages/{me}/')
    print('CONFIRMED: 41 upload tickets issued without consuming the claimed 40/hour quota')
    end()

    start()
    cur.execute("insert into posts(author_id, body, audience) values (%s, 'audit', 'everyone') returning id", (me,))
    post = cur.fetchone()[0]
    cur.execute("insert into post_comments(post_id, author_id, body) select %s, %s, 'comment ' || n from generate_series(1,3) n", (post,me))
    auth()
    cur.execute('select jsonb_array_length(post_comments_feed(%s, 1)->\'items\')', (post,))
    count = cur.fetchone()[0]
    assert count == 3
    print('CONFIRMED: post_comments_feed(limit=1) returns', count, 'comments')
    end()

    start()
    cur.execute('delete from posts')
    cur.execute("insert into posts(author_id,body,audience,created_at) values (%s,'visible older','everyone',1)", (me,))
    cur.execute("insert into posts(author_id,body,audience,created_at) values (%s,'blocked newer','everyone',2)", (peer,))
    cur.execute('insert into blocks(blocker_id,blocked_id) values (%s,%s)', (me,peer))
    auth()
    cur.execute("select jsonb_array_length(flow_feed(1)->'items'), jsonb_array_length(flow_feed(2)->'items')")
    result = cur.fetchone()
    assert result == (0,1), result
    print('CONFIRMED: hidden newer post consumes page; limit=1 is empty, limit=2 finds visible older post:', result)
    cur.execute('select can_view_media(%s)', (f'photos/{peer}/saved-url.jpg',))
    verdict = cur.fetchone()[0]
    assert verdict['allowed'] is True
    print('CONFIRMED: blocked member photo path still receives media permission:', verdict)
    end()

    start(); auth()
    try:
        cur.execute("insert into storage.objects(bucket_id,name) values ('media',%s)", (f'vibes/{me}/audit.mp4',))
        raise AssertionError('vibe storage unexpectedly permitted')
    except psycopg2.errors.InsufficientPrivilege:
        print('CONFIRMED: Vibe fallback upload path rejected by storage RLS')
    end()

    start(); auth()
    cur.execute("insert into storage.objects(bucket_id,name) values ('media',%s)", (f'messages/{me}/audit.jpg',))
    cur.execute('reset role; set role anon')
    cur.execute("select count(*) from storage.objects where name=%s", (f'messages/{me}/audit.jpg',))
    assert cur.fetchone()[0] == 1
    cur.execute("select public from storage.buckets where id='media'")
    assert cur.fetchone()[0] is True
    print('CONFIRMED: chat fallback path can be uploaded by owner, bucket is public and anonymous SELECT permitted')
    end()

    start()
    cur.execute('insert into conversations(user_a,user_b) values (%s,%s) on conflict (user_a,user_b) do update set last_message_at=excluded.last_message_at returning id', (min(me,peer), max(me,peer)))
    conv = cur.fetchone()[0]
    cur.execute("insert into messages(conversation_id,sender_id,kind,body) values (%s,%s,'text','already loaded') returning id", (conv, me))
    last_loaded = cur.fetchone()[0]
    cur.execute("insert into messages(conversation_id,sender_id,kind,body) values (%s,%s,'text','incoming between polls') returning id", (conv, peer))
    unseen = cur.fetchone()[0]
    cur.execute("insert into messages(conversation_id,sender_id,kind,body) values (%s,%s,'text','outgoing reply') returning id", (conv, me))
    saved_id = cur.fetchone()[0]
    auth()
    cursor_after_send = max(last_loaded, saved_id)  # hooks.ts:703
    cur.execute("select get_messages(%s,%s,0,40)->'items'", (conv,cursor_after_send))
    actual = cur.fetchone()[0]
    assert actual == []
    cur.execute("select get_messages(%s,%s,0,40)->'items'", (conv,last_loaded))
    correct = cur.fetchone()[0]
    assert unseen in [m['id'] for m in correct]
    print('CONFIRMED RPC/cursor model: send-advanced cursor misses incoming message; last-polled cursor retrieves it')
    end()

    conn.close()
