-- Disposable test database only. 01_core is applied twice before this file.
do $test$
declare a uuid; b uuid; c uuid; d uuid; e uuid; f uuid; r jsonb; denied boolean;
begin
  select auth_user_id into a from profiles where id=1;
  select auth_user_id into b from profiles where id=2;
  select auth_user_id into c from profiles where id=3;
  select auth_user_id into d from profiles where id=4;
  select auth_user_id into e from profiles where id=5;
  select auth_user_id into f from profiles where id=6;
  assert public.is_connected_pair(1,2), 'existing approved connection was lost';
  assert not (select closed from conversations where user_a=1 and user_b=2), 'approved conversation closed';
  assert (select closed from conversations where user_a=1 and user_b=3), 'non-approved legacy conversation left open';
  assert exists(select 1 from keeps where keeper_id=1 and kept_id=2) and exists(select 1 from keeps where keeper_id=2 and kept_id=1), 'approved compatibility rows missing';
  assert exists(select 1 from keep_close_requests where requester_id=1 and recipient_id=3 and state='pending'), 'legacy one-way keep lost';
  assert not public.is_connected_pair(1,3), 'one-way keep silently approved';
  assert not public.is_connected_pair(4,5), 'reciprocal legacy keeps silently approved';
  assert (select count(*)=2 from keep_close_requests where requester_id in (4,5) and recipient_id in (4,5) and state='pending'), 'both requests should remain pending';
  assert (select count(*)=3 from crushes where status in ('pending','accepted')), 'active Add Ups were lost';

  perform set_config('request.jwt.claim.sub',a::text,false); set local role authenticated;
  r:=public.crushes_feed(); assert jsonb_array_length(r->'outgoing')=1 and jsonb_array_length(r->'mutual')=1, 'hub does not show Keep Close requests and approved connections';
  r:=public.keep_state(3); assert (r->>'outgoing')::boolean and not (r->>'keeps')::boolean, 'outgoing state incorrect';
  r:=public.keep_close_request_list('outgoing',0,1); assert jsonb_array_length(r->'items')=1 and (r->'items'->0->'profile'->>'id')::bigint=3, 'outgoing request list incorrect';
  assert jsonb_array_length(public.keep_close_request_list('incoming')->'items')=0, 'someone else’s incoming requests leaked';
  denied:=false; begin perform public.keep_close_request_list('all'); exception when others then denied:=true; end; assert denied, 'invalid list direction accepted';
  denied:=false; begin perform public.accept_keep_close(3); exception when others then denied:=true; end; assert denied, 'requester approved their own request';
  denied:=false; begin perform public.accept_connection_request(3); exception when others then denied:=true; end; assert denied, 'legacy request API can approve a follow';
  denied:=false; begin insert into public.keep_close_requests(requester_id,recipient_id,state) values(1,6,'accepted'); exception when others then denied:=true; end; assert denied, 'direct writes allowed';
  reset role;

  perform set_config('request.jwt.claim.sub',c::text,false); set local role authenticated;
  r:=public.keep_state(1); assert (r->>'incoming')::boolean and not (r->>'keeps')::boolean, 'incoming state incorrect';
  r:=public.keep_close_request_list('incoming'); assert jsonb_array_length(r->'items')=1 and (r->'items'->0->'profile'->>'id')::bigint=1, 'incoming request list incorrect';
  r:=public.accept_keep_close(1); assert (r->>'keeps')::boolean, 'explicit approval failed';
  reset role;
  assert public.is_connected_pair(1,3), 'approval failed to connect';
  assert exists(select 1 from notifications where user_id=1 and actor_id=3 and kind='keep' and body='accepted'), 'requester not notified of acceptance';
  assert (select count(*)=2 from public.keeps where (keeper_id=1 and kept_id=3) or (keeper_id=3 and kept_id=1)), 'approval did not synchronize compatibility rows';
  perform set_config('request.jwt.claim.sub',a::text,false); set local role authenticated;
  perform public.let_go(3);
  reset role;
  assert not public.is_connected_pair(1,3), 'let go did not remove connection';
  assert exists(select 1 from crushes where from_id=1 and to_id=3) and exists(select 1 from crushes where from_id=3 and to_id=1), 'let go deleted follows';

  -- Recipient alone can decline; an immediate repeat request is rate limited.
  perform set_config('request.jwt.claim.sub',d::text,false); set local role authenticated;
  perform public.keep_close(6);
  denied:=false; begin perform public.decline_keep_close(6); exception when others then denied:=true; end; assert denied, 'requester declined own request';
  reset role;
  perform set_config('request.jwt.claim.sub',f::text,false); set local role authenticated;
  perform public.decline_keep_close(4);
  reset role;
  perform set_config('request.jwt.claim.sub',d::text,false); set local role authenticated;
  denied:=false; begin perform public.keep_close(6); exception when others then denied:=true; end; assert denied, 'decline cooldown bypassed';
  reset role;

  -- An opposite request does not count as an explicit acceptance.
  perform set_config('request.jwt.claim.sub',e::text,false); set local role authenticated;
  r:=public.keep_close(6); assert (r->>'outgoing')::boolean and not (r->>'keeps')::boolean;
  reset role;
  perform set_config('request.jwt.claim.sub',f::text,false); set local role authenticated;
  r:=public.keep_close(5); assert (r->>'incoming')::boolean and (r->>'outgoing')::boolean and not (r->>'keeps')::boolean;
  r:=public.accept_keep_close(5); assert (r->>'keeps')::boolean;
  reset role;
  assert public.is_connected_pair(5,6), 'reciprocal request was not explicitly approved';

  -- Direct RLS block insertion still triggers full cleanup and closes chat.
  insert into public.conversations(user_a,user_b,closed) values(5,6,false) on conflict(user_a,user_b) do update set closed=false;
  insert into public.crushes(from_id,to_id,status) values(5,6,'pending') on conflict do nothing;
  perform set_config('request.jwt.claim.sub',e::text,false); set local role authenticated;
  insert into public.blocks(blocker_id,blocked_id) values(5,6);
  reset role;
  assert not public.is_connected_pair(5,6) and not exists(select 1 from keeps where keeper_id=5 and kept_id=6), 'block did not sever';
  assert not exists(select 1 from crushes where from_id=5 and to_id=6), 'block left a follow';
  assert (select closed from conversations where user_a=5 and user_b=6), 'block did not close conversation';
  raise notice 'relationship transition core checks passed';
end $test$;
