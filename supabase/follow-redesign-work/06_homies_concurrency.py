"""Disposable holup_disposable DB ONLY. Accept/request vs block serialization."""
import concurrent.futures
import threading
import psycopg2

DSN = 'dbname=holup_disposable host=/var/run/postgresql'
conn = psycopg2.connect(DSN); conn.autocommit = True
with conn.cursor() as cur:
    cur.execute("select p.id,u.id from profiles p join auth.users u on u.id=p.auth_user_id where u.email in ('marcus@crushly.app','tobi@crushly.app') order by u.email")
    (a, au), (b, bu) = cur.fetchall()
    cur.execute("update profiles set onboarded=true,status='active' where id in (%s,%s)", (a,b))
    cur.execute("update privacy set profile_visibility='everyone',incognito=false where user_id in (%s,%s)",(a,b))

def reset(accept):
    with conn.cursor() as c:
        c.execute('delete from blocks where (blocker_id=%s and blocked_id=%s) or (blocker_id=%s and blocked_id=%s)',(a,b,b,a))
        c.execute('delete from holup_homies where user_a=least(%s,%s) and user_b=greatest(%s,%s)',(a,b,a,b))
        c.execute('delete from holup_homie_requests where (sender_id=%s and recipient_id=%s) or (sender_id=%s and recipient_id=%s)',(a,b,b,a))
        c.execute('delete from holup_homie_attempts where sender_id in (%s,%s)',(a,b))
        if accept: c.execute("insert into holup_homie_requests(sender_id,recipient_id,status) values(%s,%s,'pending')",(a,b))

def race(accept,n):
    reset(accept); gate = threading.Barrier(2)
    def action():
        with psycopg2.connect(DSN) as db, db.cursor() as cur:
            cur.execute("select set_config('request.jwt.claim.sub',%s,true)",(str(bu if accept else au),))
            cur.execute('set local role authenticated'); gate.wait(timeout=10)
            try:
                if accept: cur.execute('select public.holup_respond_homie(%s,true)',(a,))
                else: cur.execute('select public.holup_request_homie(%s)',(b,))
            except psycopg2.Error as err:
                if 'unavailable' not in str(err).lower() and 'not available' not in str(err).lower(): raise
    def block():
        with psycopg2.connect(DSN) as db, db.cursor() as cur:
            gate.wait(timeout=10)
            cur.execute('insert into public.blocks(blocker_id,blocked_id) values(%s,%s)',(b,a))
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        fs=[pool.submit(action),pool.submit(block)]
        for f in fs: f.result(timeout=15)
    with conn.cursor() as c:
        c.execute('select count(*) from holup_homies where user_a=least(%s,%s) and user_b=greatest(%s,%s)',(a,b,a,b))
        assert c.fetchone()[0]==0, f'friendship survived block in race {n}'
        c.execute('select count(*) from holup_homie_requests where (sender_id=%s and recipient_id=%s) or (sender_id=%s and recipient_id=%s)',(a,b,b,a))
        assert c.fetchone()[0]==0, f'request survived block in race {n}'
for kind in (False, True):
    for i in range(25): race(kind,i)
reset(False)
conn.close()
print('25 request/block and 25 accept/block races passed on disposable DB')
