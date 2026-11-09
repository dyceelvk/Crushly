-- Disposable DB only: stale historical connections cannot expose private
-- profiles or be used as Circle/share Close candidates after an un-Keep.
begin;
do $test$
declare u uuid; r jsonb; denied boolean;
begin
 delete from public.blocks where blocker_id in (4,5,6) and blocked_id in (4,5,6);
 delete from public.keeps where keeper_id in (4,5,6) and kept_id in (4,5,6);
 insert into public.connections(user_a,user_b) values(4,5) on conflict do nothing;
 update public.privacy set profile_visibility='connections',incognito=true where user_id=5;
 insert into public.keeps(keeper_id,kept_id) values(5,4),(4,6),(6,4);
 select auth_user_id into u from public.profiles where id=4;
 perform set_config('request.jwt.claim.sub',u::text,true); set local role authenticated;
 denied:=false; begin perform count(*) from public.connections; exception when insufficient_privilege then denied:=true; end;
 assert denied,'historical connections table remains directly readable';
 r:=public.crushes_feed();
 assert not exists(select 1 from jsonb_array_elements(r->'mutual') x where (x->>'id')::int=5),'stale connection exposed private profile';
 assert exists(select 1 from jsonb_array_elements(r->'mutual') x where (x->>'id')::int=6),'mutual Keep missing from Close candidates';
 assert r->'incoming'='[]'::jsonb and r->'outgoing'='[]'::jsonb,'obsolete crush request queues visible';
 reset role;
 raise notice 'legacy Close-candidate privacy passed';
end $test$;
rollback;
