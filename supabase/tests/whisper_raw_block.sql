-- Disposable synthetic fixture only; do not run on production.
begin;
do $$
declare a bigint; b bigint; z bigint; au uuid; bu uuid; zu uuid; cv bigint; msg bigint; n int;
begin
 select id,auth_user_id into a,au from public.profiles where name='Daniel';
 select id,auth_user_id into b,bu from public.profiles where name='Ryan';
 select id,auth_user_id into z,zu from public.profiles where name='Jayden';
 assert a is not null and b is not null and z is not null;
 delete from public.blocks where (blocker_id=a and blocked_id=b) or (blocker_id=b and blocked_id=a);
 insert into public.conversations(user_a,user_b,closed) values(least(a,b),greatest(a,b),false)
 on conflict(user_a,user_b) do update set closed=false returning id into cv;
 insert into public.messages(conversation_id,sender_id,body) values(cv,a,'private synthetic') returning id into msg;
 insert into public.message_reactions(message_id,user_id,kind) values(msg,b,'crush');
 perform set_config('request.jwt.claim.sub',au::text,true); set local role authenticated;
 select count(*) into n from public.messages where id=msg; assert n=1,'participant lost message access';
 select count(*) into n from public.message_reactions where message_id=msg; assert n=1,'participant lost reaction access';
 perform set_config('request.jwt.claim.sub',zu::text,true);
 select count(*) into n from public.messages where id=msg; assert n=0,'outsider can read message';
 assert not public.session_can_select_whisper(cv),'helper exposed outsider conversation';
 reset role; insert into public.blocks(blocker_id,blocked_id) values(b,a); set local role authenticated;
 perform set_config('request.jwt.claim.sub',au::text,true);
 select count(*) into n from public.messages where id=msg; assert n=0,'blocked member can read messages';
 select count(*) into n from public.message_reactions where message_id=msg; assert n=0,'blocked member can read reactions';
 perform set_config('request.jwt.claim.sub',bu::text,true);
 select count(*) into n from public.messages where id=msg; assert n=0,'blocker can read messages';
 select count(*) into n from public.message_reactions where message_id=msg; assert n=0,'blocker can read reactions';
 assert not has_function_privilege('anon','public.session_can_select_whisper(bigint)','execute'), 'anonymous helper access';
 raise notice 'raw blocked Whisper reads guarded';
end $$;
rollback;
