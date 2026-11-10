"""DESTRUCTIVE FIXTURE: disposable PostgreSQL database only, never production.

Exercise real authenticated send_message / holup_accept_whisper vs block_member.
The shared pair lock must make either order safe; a blocked pair never retains
an open/accepted permission and neither can send or accept after block commits.
"""
import concurrent.futures
import os
import threading
import psycopg2

DSN = os.environ.get('HOLUP_TEST_DSN', 'dbname=holup_disposable host=/var/run/postgresql')
db = psycopg2.connect(DSN); db.autocommit = True
with db.cursor() as c:
    c.execute("select p.id,u.id from profiles p join auth.users u on u.id=p.auth_user_id where u.email in ('marcus@crushly.app','tobi@crushly.app') order by u.email")
    (a, au), (b, bu) = c.fetchall()
    c.execute("update profiles set onboarded=true,status='active' where id in (%s,%s)", (a,b))
    c.execute("update privacy set profile_visibility='everyone',incognito=false,holup_whisper_open=false where user_id in (%s,%s)", (a,b))

for action in ('send', 'accept'):
    for i in range(25):
        with db.cursor() as c:
            c.execute('delete from blocks where (blocker_id=%s and blocked_id=%s) or (blocker_id=%s and blocked_id=%s)', (a,b,b,a))
            c.execute('delete from conversations where user_a=least(%s,%s) and user_b=greatest(%s,%s)', (a,b,a,b))
            c.execute("select set_config('request.jwt.claim.sub',%s,false)", (str(au),))
            c.execute('select public.open_conversation(%s)', (b,)); cv = c.fetchone()[0]['id']
            c.execute("select public.send_message(%s,'text','first')", (cv,))
        gate = threading.Barrier(2)
        def try_action():
            try:
                with psycopg2.connect(DSN) as d, d.cursor() as c:
                    c.execute("select set_config('request.jwt.claim.sub',%s,true)", (str(au if action == 'send' else bu),))
                    c.execute('set local role authenticated'); gate.wait(timeout=10)
                    if action == 'send': c.execute("select public.send_message(%s,'text','racing')", (cv,))
                    else: c.execute('select public.holup_accept_whisper(%s)', (cv,))
                return True
            except psycopg2.Error as e:
                if not any(t in str(e).lower() for t in ('unavailable','not found','not available','cut off')):
                    raise
                return False
        def block():
            with psycopg2.connect(DSN) as d, d.cursor() as c:
                c.execute("select set_config('request.jwt.claim.sub',%s,true)", (str(bu),))
                c.execute('set local role authenticated'); gate.wait(timeout=10)
                c.execute('select public.block_member(%s)', (a,))
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(try_action), pool.submit(block)]
            for f in futures: f.result(timeout=15)
        with db.cursor() as c:
            c.execute('select c.closed,p.state from conversations c join holup_whisper_permissions p on p.conversation_id=c.id where c.id=%s',(cv,))
            assert c.fetchone() == (True,'blocked'), (action,i,'block must win in final state')
            c.execute("select set_config('request.jwt.claim.sub',%s,false)", (str(au),))
            try: c.execute("select public.send_message(%s,'text','after block')", (cv,))
            except psycopg2.Error: pass
            else: raise AssertionError('send after block succeeded')
            c.execute("select set_config('request.jwt.claim.sub',%s,false)", (str(bu),))
            try: c.execute('select public.holup_accept_whisper(%s)', (cv,))
            except psycopg2.Error: pass
            else: raise AssertionError('accept after block succeeded')
with db.cursor() as c:
    c.execute('delete from blocks where (blocker_id=%s and blocked_id=%s) or (blocker_id=%s and blocked_id=%s)', (a,b,b,a))
    c.execute('delete from conversations where user_a=least(%s,%s) and user_b=greatest(%s,%s)', (a,b,a,b))
db.close()
print('25 real send/block and 25 real accept/block races passed on disposable database')
