-- Disposable-only fixture: run after 01,04,12,13,19,21. This checks database
-- authorizers, not hosted sockets or already-cached authorizations.
begin;
do $$
declare a bigint; b bigint; au uuid; bu uuid; c bigint; rejected boolean;
begin
 select id,auth_user_id into a,au from public.profiles where name='Daniel';
 select id,auth_user_id into b,bu from public.profiles where name='Ryan';
 update public.profiles set onboarded=true,status='active' where id in(a,b);
 update public.privacy set profile_visibility='everyone',incognito=false,holup_whisper_open=false where user_id in(a,b);
 delete from public.blocks where (blocker_id=a and blocked_id=b) or (blocker_id=b and blocked_id=a);
 perform set_config('request.jwt.claim.sub',au::text,true); set local role authenticated;
 c:=(public.open_conversation(b)->>'id')::bigint;
 perform public.send_message(c,'text','hi');
 perform set_config('request.jwt.claim.sub',bu::text,true);
 perform public.holup_accept_whisper(c);
 assert not public.can_join_whisper('whisper:'||c),'Whisper channel must fail closed';
 assert not public.can_join_call('call-123'),'call channel must fail closed';
 rejected:=false; begin perform public.register_call_room(c); exception when others then rejected:=true; end;
 assert rejected,'call registration must fail closed';
 assert jsonb_array_length(public.get_messages(c)->'items')=1,'guarded polling must work';
 raise notice 'new Whisper live channels fail closed; polling works';
end $$;
rollback;
