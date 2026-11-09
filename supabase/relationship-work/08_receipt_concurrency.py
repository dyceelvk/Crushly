"""Disposable DB only: receipt-vs-separation pair-lock ordering regression."""
import os, threading
import psycopg2
DSN = os.environ['TEST_DATABASE_URL']
def connect():
    return psycopg2.connect(DSN)
def run(c, q, args=()):
    with c.cursor() as cur:
        cur.execute(q,args)
        return cur.fetchone() if cur.description else None
def auth(c, uid):
    run(c,"select set_config('request.jwt.claim.sub',(select auth_user_id::text from profiles where id=%s),false)",(uid,))
    run(c,'set local role authenticated')
def setup():
    c=connect()
    run(c,'delete from blocks where blocker_id in (7,8) and blocked_id in (7,8)')
    run(c,'delete from connections where user_a=7 and user_b=8')
    run(c,'insert into connections(user_a,user_b) values(7,8)')
    conv=run(c,'insert into conversations(user_a,user_b,closed) values(7,8,false) on conflict(user_a,user_b) do update set closed=false returning id')[0]
    msg=run(c,"insert into messages(conversation_id,sender_id,kind,body) values(%s,7,'text','receipt race') returning id",(conv,))[0]
    c.commit(); c.close(); return conv,msg
def competing(fn):
    started=threading.Event(); done=threading.Event(); results=[]
    def work():
        c=connect()
        try: started.set(); fn(c); c.commit(); results.append('ok')
        except Exception as e: c.rollback(); results.append(str(e))
        finally: c.close(); done.set()
    t=threading.Thread(target=work,daemon=True); t.start(); assert started.wait(5)
    return t,done,results
def receipt(c,conv,kind):
    auth(c,8)
    run(c,'select '+('mark_messages_delivered(%s,null)' if kind=='delivery' else 'mark_conversation_read(%s)'),(conv,))
def separate(c,kind):
    auth(c,7)
    run(c,'select let_go(8)' if kind=='remove' else 'insert into blocks(blocker_id,blocked_id) values(7,8)')
for kind in ('delivery','read'):
    for separation in ('remove','block'):
        # Ending wins: receipt starts while removal is uncommitted; must wait,
        # recheck against the committed state and leave the timestamps untouched.
        cv,mid=setup(); first=connect(); separate(first,separation)
        t,done,result=competing(lambda c: receipt(c,cv,kind))
        assert not done.wait(.3), 'receipt bypassed pair lock'
        first.commit(); first.close(); assert done.wait(10); t.join()
        assert result and 'Conversation not found' in result[0], result
        c=connect(); assert run(c,'select delivered_at is null and read_at is null from messages where id=%s',(mid,))[0]; c.close()
        # Receipt wins: separation must wait for that receipt to commit.
        cv,mid=setup(); first=connect(); receipt(first,cv,kind)
        t,done,result=competing(lambda c: separate(c,separation))
        assert not done.wait(.3), 'separation bypassed receipt lock'
        first.commit(); first.close(); assert done.wait(10); t.join(); assert result==['ok'],result
        c=connect(); assert not run(c,'select is_connected_pair(7,8)')[0]; c.close()
# Call creation is serialized with both forms of separation too. Calls are only
# enabled in this disposable DB; real-time calls still need transport revocation.
for separation in ('remove','block'):
    cv,mid=setup(); c=connect(); run(c,"update holup_features set enabled=true where key='calls'"); c.commit(); c.close()
    first=connect(); separate(first,separation)
    def register(c):
        auth(c,8); run(c,'select register_call_room(%s)',(cv,))
    t,done,result=competing(register)
    assert not done.wait(.3), 'call creation bypassed pair lock'
    first.commit(); first.close(); assert done.wait(10); t.join()
    assert result and 'Calling is not available' in result[0], result
    c=connect(); assert not run(c,'select exists(select 1 from call_rooms where conversation_id=%s and caller_id=8 and closed_at is null)',(cv,))[0]; c.close()
print('receipt/removal and receipt/block races passed in both orders; call creation after separation rejected')
