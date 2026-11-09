"""Destructive disposable DB only: request-limit and approval/block races."""
import os,threading
import psycopg2
DSN=os.environ['TEST_DATABASE_URL']
def connect(): return psycopg2.connect(DSN)
def run(c,q,args=()):
    with c.cursor() as cur:
        cur.execute(q,args)
        return cur.fetchone() if cur.description else None
def auth(c,who):
    run(c,"select set_config('request.jwt.claim.sub',(select auth_user_id::text from profiles where id=%s),false)",(who,))
    run(c,'set local role authenticated')
def setup():
    c=connect(); run(c,'delete from blocks where blocker_id in (7,8) and blocked_id in (7,8)')
    run(c,'delete from conversations where user_a=7 and user_b=8')
    run(c,"update privacy set v3_whisper_open=false, profile_visibility='everyone',incognito=false where user_id in (7,8)")
    run(c,"""create or replace function public.v3_test_send(cv bigint,body text) returns bigint language plpgsql security definer set search_path=public as $$
    declare mid bigint; begin insert into messages(conversation_id,sender_id,kind,body) values(cv,public.me_id(),'text',body) returning id into mid; return mid; end $$""")
    run(c,'grant execute on function public.v3_test_send(bigint,text) to authenticated')
    c.commit(); auth(c,7); cv=run(c,'select (v3_begin_whisper_request(8)->>\'id\')::bigint')[0]; c.commit(); c.close(); return cv
def competing(fn):
    started=threading.Event(); done=threading.Event(); result=[]
    def work():
        c=connect()
        try: started.set(); fn(c); c.commit(); result.append('ok')
        except Exception as e: c.rollback(); result.append(str(e))
        finally: c.close(); done.set()
    t=threading.Thread(target=work,daemon=True); t.start(); assert started.wait(5); return t,done,result
def waiting(done): assert not done.wait(.3),'pair lock was bypassed'
def send(c,cv): auth(c,7); run(c,'select v3_test_send(%s,%s)',(cv,'racing message'))
# With one sent, two competing sends cannot both occupy the last slot.
cv=setup(); first=connect(); send(first,cv); first.commit(); first.close()
first=connect(); send(first,cv); t,done,result=competing(lambda c:send(c,cv)); waiting(done); first.commit(); first.close(); assert done.wait(10); t.join(); assert result and 'request_limit' in result[0],result
c=connect(); assert run(c,'select request_messages from v3_whisper_permissions where conversation_id=%s',(cv,))[0]==2; c.close()
# Acceptance wins the race and then the third send is permitted.
cv=setup(); c=connect(); send(c,cv); send(c,cv); c.commit(); c.close()
first=connect(); auth(first,8); run(first,'select v3_accept_whisper(%s)',(cv,)); t,done,result=competing(lambda c:send(c,cv)); waiting(done); first.commit(); first.close(); assert done.wait(10); t.join(); assert result==['ok'],result
# Block wins, and a sender waiting at the pair lock must be refused.
cv=setup(); first=connect(); auth(first,8); run(first,'insert into blocks(blocker_id,blocked_id) values(8,7)'); t,done,result=competing(lambda c:send(c,cv)); waiting(done); first.commit(); first.close(); assert done.wait(10); t.join(); assert result and 'Whisper unavailable' in result[0],result
c=connect(); assert run(c,'select count(*) from messages where conversation_id=%s',(cv,))[0]==0; c.close()
# Two people open an empty composer. The first send is a request; a concurrent
# reply waits for that commit, then atomically accepts the request.
cv=setup(); first=connect(); send(first,cv)
def reply(c): auth(c,8); run(c,'select v3_test_send(%s,%s)',(cv,'reply'))
t,done,result=competing(reply); waiting(done); first.commit(); first.close(); assert done.wait(10); t.join(); assert result==['ok'],result
c=connect(); assert run(c,"select state='accepted' and request_messages=1 from v3_whisper_permissions where conversation_id=%s",(cv,))[0]; c.close()
# A recipient turning open messaging off wins against a send that already took
# the pair lock but is waiting on the privacy row.
cv=setup(); c=connect(); send(c,cv); send(c,cv); c.commit(); c.close()
c=connect(); auth(c,8); run(c,'select v3_set_whisper_open(true)'); c.commit(); c.close()
first=connect(); auth(first,8); run(first,'select v3_set_whisper_open(false)')
t,done,result=competing(lambda c:send(c,cv)); waiting(done); first.commit(); first.close(); assert done.wait(10); t.join(); assert result and 'request_limit' in result[0],result
# Subscribing and direct blocking serialize in both orders. A block must
# remove a just-committed subscription and a pending subscribe must fail.
cv=setup(); c=connect(); run(c,'delete from keeps where keeper_id in (7,8) and kept_id in (7,8)'); c.commit(); c.close()
first=connect(); auth(first,7); run(first,'select v3_keep_subscribe(8)')
def block(c): auth(c,8); run(c,'insert into blocks(blocker_id,blocked_id) values(8,7)')
t,done,result=competing(block); waiting(done); first.commit(); first.close(); assert done.wait(10); t.join(); assert result==['ok'],result
c=connect(); assert not run(c,'select exists(select 1 from keeps where keeper_id in (7,8) and kept_id in (7,8))')[0]; c.close()
cv=setup(); first=connect(); block(first)
def subscribe(c): auth(c,7); run(c,'select v3_keep_subscribe(8)')
t,done,result=competing(subscribe); waiting(done); first.commit(); first.close(); assert done.wait(10); t.join(); assert result and 'Space not available' in result[0],result
c=connect(); assert not run(c,'select exists(select 1 from keeps where keeper_id in (7,8) and kept_id in (7,8))')[0]; run(c,'drop function public.v3_test_send(bigint,text)'); c.commit(); c.close()
print('two-message cap, accept/send, block/send, reply/send, setting-off/send and subscribe/block in both orders passed')
