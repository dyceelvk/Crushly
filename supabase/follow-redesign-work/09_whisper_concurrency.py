"""Disposable holup_disposable DB ONLY. Concurrent sends cannot exceed quota."""
import concurrent.futures
import threading
import psycopg2
# A disposable database, never production. Override the location when the
# throwaway server is not the default local socket.
DSN=__import__('os').environ.get('HOLUP_TEST_DSN','dbname=holup_disposable host=/var/run/postgresql')
conn=psycopg2.connect(DSN); conn.autocommit=True
with conn.cursor() as c:
    c.execute("select p.id,u.id from profiles p join auth.users u on u.id=p.auth_user_id where u.email in ('marcus@crushly.app','tobi@crushly.app') order by u.email")
    (a,au),(b,bu)=c.fetchall()
    c.execute("update profiles set onboarded=true,status='active' where id in (%s,%s)",(a,b))
    c.execute("update privacy set profile_visibility='everyone',incognito=false,holup_whisper_open=false where user_id in (%s,%s)",(a,b))
for i in range(20):
    with conn.cursor() as c:
        c.execute('delete from blocks where (blocker_id=%s and blocked_id=%s) or (blocker_id=%s and blocked_id=%s)',(a,b,b,a))
        c.execute('delete from conversations where user_a=least(%s,%s) and user_b=greatest(%s,%s)',(a,b,a,b))
        c.execute("select set_config('request.jwt.claim.sub',%s,false)",(str(au),))
        c.execute('select holup_begin_whisper_request(%s)',(b,)); cv=int(c.fetchone()[0]['id'])
        c.execute("insert into messages(conversation_id,sender_id,kind,body) values(%s,%s,'text','first')",(cv,a))
    gate=threading.Barrier(2)
    def send():
        with psycopg2.connect(DSN) as db, db.cursor() as cur:
            cur.execute("select set_config('request.jwt.claim.sub',%s,true)",(str(au),)); gate.wait(timeout=10)
            try:
                cur.execute("insert into messages(conversation_id,sender_id,kind,body) values(%s,%s,'text','racing')",(cv,a))
                return True
            except psycopg2.Error as e:
                if 'Wait for this Whisper request' not in str(e): raise
                return False
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        fs=[pool.submit(send),pool.submit(send)]; outcomes=[f.result(timeout=15) for f in fs]
    assert sum(outcomes)==1, f'exactly one second message must commit, got {outcomes}'
    with conn.cursor() as c:
        c.execute('select request_messages from holup_whisper_permissions where conversation_id=%s',(cv,)); assert c.fetchone()[0]==2
        c.execute('select count(*) from messages where conversation_id=%s',(cv,)); assert c.fetchone()[0]==2
with conn.cursor() as c: c.execute('delete from conversations where user_a=least(%s,%s) and user_b=greatest(%s,%s)',(a,b,a,b))
conn.close()
print('20 two-message quota races passed on disposable database')
