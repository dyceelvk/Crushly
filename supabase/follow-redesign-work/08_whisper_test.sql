-- Disposable DB only: synthetic inserts exercise the guarded state machine,
-- not production message RPCs, live Realtime, media or app UI.
begin;
do $test$
declare au uuid; bu uuid; cu uuid; a bigint; b bigint; c bigint; cv bigint; cv2 bigint; r jsonb; denied boolean; m bigint;
begin
 select id into au from auth.users where email='marcus@crushly.app';
 select id into bu from auth.users where email='daniel@crushly.app';
 select id into cu from auth.users where email='tobi@crushly.app';
 select id into a from profiles where auth_user_id=au;
 select id into b from profiles where auth_user_id=bu;
 select id into c from profiles where auth_user_id=cu;
 update profiles set onboarded=true,status='active' where id in(a,b,c);
 update privacy set profile_visibility='everyone',incognito=false,holup_whisper_open=false where user_id in(a,b,c);
 delete from blocks where blocker_id in(a,b,c) and blocked_id in(a,b,c);
 -- Already-open conversations were grandfathered as accepted.
 assert not exists(select 1 from conversations v where not v.closed and not is_blocked_pair(v.user_a,v.user_b)
   and not exists(select 1 from holup_whisper_permissions p where p.conversation_id=v.id and p.state='accepted'));
 delete from conversations where user_a=least(a,c) and user_b=greatest(a,c);
 delete from conversations where user_a=least(b,c) and user_b=greatest(b,c);
 delete from holup_homies where user_a=least(a,c) and user_b=greatest(a,c);
 delete from holup_follows where (follower_id=a and followed_id=c) or (follower_id=c and followed_id=a);
 perform set_config('request.jwt.claim.sub',au::text,true); set local role authenticated;
 r:=holup_begin_whisper_request(c); cv:=(r->>'id')::bigint; assert r->>'state'='pending';
 denied:=false; begin perform holup_accept_whisper(cv); exception when others then denied:=true; end; assert denied;
 reset role;
 -- Test fixture inserts as the database owner while retaining the synthetic JWT;
 -- applications must use an audited real send RPC, never direct inserts.
 insert into messages(conversation_id,sender_id,kind,body) values(cv,a,'text','hello') returning id into m;
 delete from messages where id=m;
 insert into messages(conversation_id,sender_id,kind,body) values(cv,a,'text','second');
 denied:=false; begin insert into messages(conversation_id,sender_id,kind,body) values(cv,a,'text','third'); exception when others then denied:=true; end; assert denied, 'deletion reset two-message allowance';
 -- Reply auto-accepts atomically; unlimited subsequent sends are possible.
 perform set_config('request.jwt.claim.sub',cu::text,true);
 insert into messages(conversation_id,sender_id,kind,body) values(cv,c,'text','reply');
 assert (select state='accepted' from holup_whisper_permissions where conversation_id=cv);
 perform set_config('request.jwt.claim.sub',au::text,true);
 insert into messages(conversation_id,sender_id,kind,body) values(cv,a,'text','third after acceptance');
 -- Opening an empty composer is not acceptance. If the other person sends
 -- first, that participant is the requester; only the recipient can accept.
 delete from conversations where user_a=least(b,c) and user_b=greatest(b,c);
 perform set_config('request.jwt.claim.sub',bu::text,true); set local role authenticated;
 r:=holup_begin_whisper_request(c); cv2:=(r->>'id')::bigint;
 reset role;
 perform set_config('request.jwt.claim.sub',cu::text,true);
 insert into messages(conversation_id,sender_id,kind,body) values(cv2,c,'text','first sender switched');
 assert (select state='pending' and requester_id=c and recipient_id=b and request_messages=1 from holup_whisper_permissions where conversation_id=cv2);
 perform set_config('request.jwt.claim.sub',bu::text,true); set local role authenticated;
 perform holup_accept_whisper(cv2);
 reset role;
 assert (select state='accepted' from holup_whisper_permissions where conversation_id=cv2);
 delete from conversations where id=cv2;
 -- Starting while open produces an accepted conversation that survives toggle off.
 perform set_config('request.jwt.claim.sub',cu::text,true); set local role authenticated;
 perform holup_set_whisper_open(true);
 reset role;
 perform set_config('request.jwt.claim.sub',bu::text,true); set local role authenticated;
 r:=holup_begin_whisper_request(c); cv2:=(r->>'id')::bigint;
 reset role;
 insert into messages(conversation_id,sender_id,kind,body) values(cv2,b,'text','open start');
 assert (select state='accepted' from holup_whisper_permissions where conversation_id=cv2);
 perform set_config('request.jwt.claim.sub',cu::text,true); set local role authenticated;
 perform holup_set_whisper_open(false);
 reset role;
 perform set_config('request.jwt.claim.sub',bu::text,true);
 insert into messages(conversation_id,sender_id,kind,body) values(cv2,b,'text','still open');
 insert into messages(conversation_id,sender_id,kind,body) values(cv2,b,'text','still open again');
 -- Block immediately invalidates the state and prevents a further insert.
 perform set_config('request.jwt.claim.sub',cu::text,true); set local role authenticated;
 perform block_member(b);
 reset role;
 perform set_config('request.jwt.claim.sub',bu::text,true);
 denied:=false; begin insert into messages(conversation_id,sender_id,kind,body) values(cv2,b,'text','blocked'); exception when others then denied:=true; end; assert denied;
 assert (select state='blocked' from holup_whisper_permissions where conversation_id=cv2);
 assert not has_table_privilege('authenticated','public.holup_whisper_permissions','select');
 assert not has_function_privilege('anon','public.holup_begin_whisper_request(bigint)','execute');
 raise notice 'isolated independent Whisper state-machine tests passed';
end $test$;
rollback;
