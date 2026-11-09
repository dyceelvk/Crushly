-- Disposable DB only, after legacy fixture and 01_experiment.sql twice.
begin;
-- Only test plumbing: simulate a security-definer send insertion. The real
-- legacy send RPC still has incompatible gates and must be redesigned.
create function public.v3_test_send(cv bigint,body text) returns bigint language plpgsql security definer set search_path=public as $$
declare mid bigint;
begin insert into public.messages(conversation_id,sender_id,kind,body) values(cv,public.me_id(),'text',body) returning id into mid; return mid; end $$;
grant execute on function public.v3_test_send(bigint,text) to authenticated;
do $test$
declare a bigint:=7; b bigint:=8; outsider bigint:=6; au uuid; bu uuid; xu uuid; cv bigint; mid bigint; r jsonb; denied boolean;
begin
 select auth_user_id into au from profiles where id=a; select auth_user_id into bu from profiles where id=b; select auth_user_id into xu from profiles where id=outsider;
 assert exists(select 1 from keeps where keeper_id=1 and kept_id=3), 'legacy one-way subscription lost';
 assert exists(select 1 from keeps where keeper_id=2 and kept_id=1), 'legacy connection not converted into mutual subscription';
 assert exists(select 1 from v3_whisper_permissions p join conversations c on c.id=p.conversation_id where c.user_a=1 and c.user_b=3 and p.state='accepted'), 'legacy conversation not preserved';
 delete from public.blocks where (blocker_id in (a,b) and blocked_id in (a,b));
 delete from public.keeps where keeper_id in (a,b) and kept_id in (a,b);
 delete from public.crushes where from_id in (a,b) and to_id in (a,b);
 delete from public.conversations where user_a=least(a,b) and user_b=greatest(a,b);
 update privacy set v3_whisper_open=false,profile_visibility='everyone',incognito=false where user_id in (a,b,outsider);
 perform set_config('request.jwt.claim.sub',au::text,true); set local role authenticated;
 r:=public.v3_keep_subscribe(b); assert (r->>'keeps')::boolean and not (r->>'mutual')::boolean, 'subscription not immediate and one-way';
 assert public.v3_can_view_kept_list(a), 'owner should see own list';
 reset role;
 perform set_config('request.jwt.claim.sub',bu::text,true); set local role authenticated;
 assert not public.v3_can_view_kept_list(a), 'non-subscriber gained list access';
 denied:=false; begin perform public.v3_kept_close_people(a); exception when sqlstate 'P0001' then denied:=true; end; assert denied, 'non-subscriber read identities';
 r:=public.v3_keep_subscribe(a); assert (r->>'mutual')::boolean, 'mutual subscriptions not recognized';
 assert public.v3_can_view_kept_list(a), 'subscriber cannot see owner list';
 r:=public.v3_keep_stats(a); assert (r->>'keptClose')::int=1 and (r->>'canViewKeptClose')::boolean, 'subscriber count/permission incorrect';
 assert jsonb_array_length(public.v3_kept_close_people(a)->'items')=1, 'subscriber list incorrect';
 reset role;
 perform set_config('request.jwt.claim.sub',au::text,true); set local role authenticated;
 assert public.v3_can_view_kept_list(b), 'first subscriber cannot see owner list';
 assert public.v3_keep_unsubscribe(b), 'unsubscribe failed';
 reset role;
 assert not exists(select 1 from keeps where keeper_id=a and kept_id=b) and exists(select 1 from keeps where keeper_id=b and kept_id=a), 'unsubscribing removed the other subscription';
 perform set_config('request.jwt.claim.sub',au::text,true); set local role authenticated;
 assert not public.v3_can_view_kept_list(b), 'former subscriber retained list access';
 r:=public.v3_begin_whisper_request(b); cv:=(r->>'id')::bigint;
 reset role;
 perform set_config('request.jwt.claim.sub',bu::text,true); set local role authenticated;
 denied:=false; begin perform public.v3_accept_whisper(cv); exception when sqlstate 'P0001' then denied:=true; end; assert denied, 'empty composer is not a request';
 perform public.v3_test_send(cv,'First actual sender is the requester');
 reset role;
 assert (select requester_id=b and recipient_id=a and state='pending' and request_messages=1 from v3_whisper_permissions where conversation_id=cv), 'opening an empty composer reserved the wrong direction or implied consent';
 delete from public.conversations where id=cv;
 perform set_config('request.jwt.claim.sub',au::text,true); set local role authenticated;
 cv:=(public.v3_begin_whisper_request(b)->>'id')::bigint;
 mid:=public.v3_test_send(cv,'First request');
 perform public.v3_test_send(cv,'Second request');
 assert public.delete_whisper(mid,true), 'sender cannot delete';
 denied:=false; begin perform public.v3_test_send(cv,'Third request'); exception when sqlstate 'P0001' then denied:=sqlerrm like '__CRUSHLY__403__request_limit%'; end; assert denied, 'third request allowed or deletion reset limit';
 denied:=false; begin perform public.v3_accept_whisper(cv); exception when sqlstate 'P0001' then denied:=true; end; assert denied, 'sender approved own request';
 reset role;
 perform set_config('request.jwt.claim.sub',xu::text,true); set local role authenticated;
 denied:=false; begin perform public.v3_accept_whisper(cv); exception when sqlstate 'P0001' then denied:=true; end; assert denied, 'outsider approved';
 denied:=false; begin perform public.v3_test_send(cv,'intrusion'); exception when sqlstate 'P0001' then denied:=true; end; assert denied, 'outsider sent message';
 reset role;
 perform set_config('request.jwt.claim.sub',bu::text,true); set local role authenticated;
 perform public.v3_test_send(cv,'Reply accepts the request');
 reset role;
 perform set_config('request.jwt.claim.sub',au::text,true); set local role authenticated;
 perform public.v3_test_send(cv,'Third after approval');
 perform public.v3_keep_subscribe(b); perform public.v3_keep_unsubscribe(b);
 perform public.v3_test_send(cv,'Still accepted after unsubscribe');
 reset role;
 assert (select state='accepted' and request_messages=2 from v3_whisper_permissions where conversation_id=cv), 'approval or durable count lost';

 -- Open messaging starts a lasting conversation on the first send.
 perform set_config('request.jwt.claim.sub',xu::text,true); set local role authenticated; perform public.v3_set_whisper_open(true); reset role;
 perform set_config('request.jwt.claim.sub',au::text,true); set local role authenticated;
 cv:=(public.v3_begin_whisper_request(outsider)->>'id')::bigint;
 perform public.v3_test_send(cv,'Open 1'); perform public.v3_test_send(cv,'Open 2'); perform public.v3_test_send(cv,'Open 3');
 reset role;
 perform set_config('request.jwt.claim.sub',xu::text,true); set local role authenticated;
 perform public.v3_test_send(cv,'Open reply'); perform public.v3_set_whisper_open(false);
 reset role;
 perform set_config('request.jwt.claim.sub',au::text,true); set local role authenticated;
 perform public.v3_test_send(cv,'Existing conversation survives setting off');
 insert into public.blocks(blocker_id,blocked_id) values(a,outsider);
 denied:=false; begin perform public.v3_test_send(cv,'Blocked'); exception when sqlstate 'P0001' then denied:=true; end; assert denied, 'blocked message allowed';
 reset role;
 assert (select state='blocked' from v3_whisper_permissions where conversation_id=cv), 'block did not revoke permission';
 assert (select closed from conversations where id=cv), 'block did not close conversation';

 -- A different recipient can explicitly accept instead of replying.
 delete from public.conversations where user_a=least(b,outsider) and user_b=greatest(b,outsider);
 perform set_config('request.jwt.claim.sub',bu::text,true); set local role authenticated;
 cv:=(public.v3_begin_whisper_request(outsider)->>'id')::bigint;
 perform public.v3_test_send(cv,'Please accept'); reset role;
 perform set_config('request.jwt.claim.sub',xu::text,true); set local role authenticated;
 assert public.v3_accept_whisper(cv), 'explicit accept did not work'; reset role;
 perform set_config('request.jwt.claim.sub',bu::text,true); set local role authenticated;
 perform public.v3_test_send(cv,'After explicit acceptance'); reset role;

 -- Decline cannot be bypassed by opening the same pair again.
 delete from public.conversations where user_a=least(b,outsider) and user_b=greatest(b,outsider);
 perform set_config('request.jwt.claim.sub',bu::text,true); set local role authenticated;
 cv:=(public.v3_begin_whisper_request(outsider)->>'id')::bigint;
 perform public.v3_test_send(cv,'Please decline'); reset role;
 perform set_config('request.jwt.claim.sub',xu::text,true); set local role authenticated;
 assert public.v3_decline_whisper(cv), 'recipient could not decline'; reset role;
 perform set_config('request.jwt.claim.sub',bu::text,true); set local role authenticated;
 denied:=false; begin perform public.v3_begin_whisper_request(outsider); exception when sqlstate 'P0001' then denied:=true; end; assert denied, 'declined request can be re-created';
 reset role;
 raise notice 'subscription and Whisper request prototype tests passed';
end $test$;
rollback;
