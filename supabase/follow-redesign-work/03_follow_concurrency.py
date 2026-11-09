"""Disposable-database-only race check: a concurrent block must remove follows."""
import concurrent.futures
import threading
import psycopg2

# A disposable database, never production. Override the location when the
# throwaway server is not the default local socket.
DSN = __import__('os').environ.get('HOLUP_TEST_DSN', 'dbname=holup_disposable host=/var/run/postgresql')
conn=psycopg2.connect(DSN); conn.autocommit=True
with conn.cursor() as c:
    c.execute("select p.id,u.id from profiles p join auth.users u on u.id=p.auth_user_id where u.email in ('marcus@crushly.app','daniel@crushly.app') order by u.email")
    (b,bu),(a,au)=c.fetchall()
    c.execute("update profiles set onboarded=true,status='active' where id in (%s,%s)",(a,b))
    c.execute("update privacy set profile_visibility='everyone',incognito=false,who_can_crush='everyone' where user_id in (%s,%s)",(a,b))

def race_once(n):
    with conn.cursor() as c:
        c.execute('delete from blocks where (blocker_id=%s and blocked_id=%s) or (blocker_id=%s and blocked_id=%s)',(a,b,b,a))
        c.execute('delete from holup_follows where (follower_id=%s and followed_id=%s) or (follower_id=%s and followed_id=%s)',(a,b,b,a))
        c.execute('delete from holup_follow_attempts where follower_id=%s',(a,))
    gate=threading.Barrier(2)
    def follow():
        with psycopg2.connect(DSN) as db, db.cursor() as cur:
            cur.execute("select set_config('request.jwt.claim.sub',%s,true)",(str(au),))
            cur.execute('set local role authenticated'); gate.wait(timeout=10)
            try: cur.execute('select public.holup_follow(%s)',(b,))
            except psycopg2.Error as e:
                if 'Space not available' not in str(e): raise
    def block():
        with psycopg2.connect(DSN) as db, db.cursor() as cur:
            gate.wait(timeout=10)
            cur.execute('insert into public.blocks(blocker_id,blocked_id) values(%s,%s)',(b,a))
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        fs=[pool.submit(follow),pool.submit(block)]
        for f in fs: f.result(timeout=15)
    with conn.cursor() as c:
        c.execute('select count(*) from holup_follows where (follower_id=%s and followed_id=%s) or (follower_id=%s and followed_id=%s)',(a,b,b,a))
        assert c.fetchone()[0]==0, f'follow survived block on iteration {n}'
for i in range(25): race_once(i)
with conn.cursor() as c:
    c.execute('delete from blocks where blocker_id=%s and blocked_id=%s',(b,a))
print('25 block/follow races passed on disposable database')
conn.close()
