"""Disposable database only: test pair locks against real concurrent sessions.
Run with TEST_DATABASE_URL set after applying 01_core.sql. Not a deployment check.
"""
import os
import threading
import psycopg2

DSN = os.environ['TEST_DATABASE_URL']

def connect():
    c = psycopg2.connect(DSN)
    c.autocommit = False
    return c

def run(c, sql, params=()):
    with c.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchone() if cur.description else None

def auth(c, who):
    run(c, "select set_config('request.jwt.claim.sub',(select auth_user_id::text from profiles where id=%s),false)", (who,))
    run(c, 'set local role authenticated')

def cleanup():
    c = connect()
    run(c, 'delete from blocks where blocker_id in (7,8) and blocked_id in (7,8)')
    run(c, 'delete from connections where user_a=7 and user_b=8')
    run(c, 'delete from keeps where keeper_id in (7,8) and kept_id in (7,8)')
    run(c, 'delete from keep_close_requests where requester_id in (7,8) and recipient_id in (7,8)')
    run(c, 'delete from crushes where from_id in (7,8) and to_id in (7,8)')
    run(c, "update privacy set profile_visibility='everyone' where user_id in (7,8)")
    c.commit(); c.close()

def competing(fn):
    started = threading.Event(); done = threading.Event(); result = []
    def worker():
        c = connect()
        try:
            started.set(); fn(c); c.commit(); result.append('ok')
        except Exception as e:
            c.rollback(); result.append(str(e))
        finally:
            c.close(); done.set()
    t = threading.Thread(target=worker, daemon=True); t.start()
    assert started.wait(5)
    return t, done, result

def assert_waiting(done):
    # Used only to arrange a deliberate lock race, not to poll server startup.
    assert not done.wait(0.3), 'competing operation unexpectedly bypassed pair lock'

def verify():
    c = connect()
    assert not run(c, 'select is_connected_pair(7,8)')[0]
    assert run(c, "select count(*) from keep_close_requests where ((requester_id=7 and recipient_id=8) or (requester_id=8 and recipient_id=7)) and state='pending'")[0] == 0
    assert run(c, 'select count(*) from keeps where keeper_id in (7,8) and kept_id in (7,8)')[0] == 0
    c.close()

# Request holds the lock; a direct client block must wait then clean it up.
cleanup(); first = connect(); auth(first,7); run(first,'select keep_close(8)')
t, done, result = competing(lambda c: (auth(c,8), run(c,'insert into blocks(blocker_id,blocked_id) values(8,7)')))
assert_waiting(done); first.commit(); first.close(); assert done.wait(10); t.join(); assert result == ['ok'], result
verify()

# A block holds the lock; a request that began before its commit must fail.
cleanup(); first = connect(); auth(first,8); run(first,'insert into blocks(blocker_id,blocked_id) values(8,7)')
t, done, result = competing(lambda c: (auth(c,7),run(c,'select keep_close(8)')))
assert_waiting(done); first.commit(); first.close(); assert done.wait(10); t.join(); assert result and 'Space not available' in result[0], result
verify()

# Explicit approval and block, in both commit orders, must not leave a pair.
cleanup(); setup=connect(); auth(setup,7); run(setup,'select keep_close(8)'); setup.commit(); setup.close()
first=connect(); auth(first,8); run(first,'select accept_keep_close(7)')
t, done, result = competing(lambda c: (auth(c,7), run(c,'insert into blocks(blocker_id,blocked_id) values(7,8)')))
assert_waiting(done); first.commit(); first.close(); assert done.wait(10); t.join(); assert result == ['ok'], result
verify()
cleanup(); setup=connect(); auth(setup,7); run(setup,'select keep_close(8)'); setup.commit(); setup.close()
first=connect(); auth(first,7); run(first,'insert into blocks(blocker_id,blocked_id) values(7,8)')
t, done, result = competing(lambda c: (auth(c,8),run(c,'select accept_keep_close(7)')))
assert_waiting(done); first.commit(); first.close(); assert done.wait(10); t.join(); assert result and 'Request unavailable' in result[0], result
verify()

# Removal wins against a send that started with a previously-open conversation.
cleanup(); setup=connect(); run(setup,'insert into connections(user_a,user_b) values(7,8)'); run(setup,'insert into keeps(keeper_id,kept_id) values(7,8),(8,7)');
conv=run(setup,'insert into conversations(user_a,user_b,closed) values(7,8,false) on conflict(user_a,user_b) do update set closed=false returning id')[0]; setup.commit(); setup.close()
first=connect(); auth(first,7); run(first,'select let_go(8)')
t, done, result = competing(lambda c: (auth(c,8),run(c,"select send_message(%s,'text','racing',null,'{}')",(conv,))))
assert_waiting(done); first.commit(); first.close(); assert done.wait(10); t.join(); assert result and ('Keep Close approval' in result[0] or 'connection has ended' in result[0]), result
verify()
print('relationship concurrency tests passed (request/block and approval/block both orders; removal/send)')
