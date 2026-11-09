-- Disposable database only; begins after 03_test.sql.
do $test$
declare a uuid; b uuid; c uuid; r jsonb; denied boolean; conv bigint; msg bigint;
begin
  select auth_user_id into a from profiles where id=1;
  select auth_user_id into b from profiles where id=2;
  select auth_user_id into c from profiles where id=3;
  -- Two follows are never approval. Even old permissive message settings can't
  -- grant permission. Repeated Add Up is idempotent and sends only one alert.
  perform set_config('request.jwt.claim.sub',a::text,false); set local role authenticated;
  perform public.uncrush_member(3); r:=public.crush_member(3,false,null);
  assert not (r->>'mutual')::boolean and (r->>'isNew')::boolean and r->>'request'='following';
  r:=public.crush_member(3,false,null); assert not (r->>'isNew')::boolean;
  assert (r->'profile'->'crush'->>'sent')::boolean and not (r->'profile'->'crush'->>'mutual')::boolean, 'follow profile state is incorrect';
  denied:=false; begin perform public.open_conversation(3); exception when others then denied:=true; end;
  assert denied, 'non-approved follow started a Whisper';
  reset role;
  update privacy set who_can_message='everyone' where user_id in (1,3);
  perform set_config('request.jwt.claim.sub',c::text,false); set local role authenticated;
  r:=public.crush_member(1,false,null); assert not (r->>'mutual')::boolean;
  denied:=false; begin perform public.open_conversation(1); exception when others then denied:=true; end;
  assert denied, 'mutual follows incorrectly enabled Whisper';
  reset role;
  assert not public.is_connected_pair(1,3);
  assert (select count(*)=1 from notifications where user_id=3 and actor_id=1 and kind='crush'), 'duplicate follow notification';
  -- An existing approved pair can Whisper; unfollow does not end approval.
  perform set_config('request.jwt.claim.sub',a::text,false); set local role authenticated;
  perform public.uncrush_member(2);
  r:=public.open_conversation(2); conv:=(r->>'id')::bigint;
  r:=public.send_message(conv,'text','approved message',null,'{}'); msg:=(r->>'id')::bigint;
  perform public.toggle_message_reaction(msg,'laugh');
  assert public.can_join_whisper('whisper:'||conv), 'approved realtime join denied';
  perform public.let_go(2);
  denied:=false; begin perform public.send_message(conv,'text','after removal',null,'{}'); exception when others then denied:=true; end;
  assert denied and not public.can_join_whisper('whisper:'||conv), 'Whisper stayed active after removal';
  denied:=false; begin perform public.toggle_message_reaction(msg,'laugh'); exception when others then denied:=true; end; assert denied, 'reaction possible after Keep Close removal';
  denied:=false; begin perform public.open_conversation(2); exception when others then denied:=true; end; assert denied, 'reopened without approval';
  reset role;
  assert not public.is_connected_pair(1,2);
  raise notice 'follow and Whisper authorization checks passed';
end $test$;
