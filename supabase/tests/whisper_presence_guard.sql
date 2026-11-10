-- Disposable synthetic fixtures only: never run this test in production.
begin;
do $test$
declare
 a bigint; b bigint; outsider bigint; au uuid; bu uuid; ou uuid; cid bigint; v jsonb; failed boolean;
begin
 select id,auth_user_id into a,au from public.profiles where name='Daniel';
 select id,auth_user_id into b,bu from public.profiles where name='Ryan';
 select id,auth_user_id into outsider,ou from public.profiles where name='Jayden';
 assert a is not null and b is not null and outsider is not null;
 delete from public.blocks where (blocker_id=a and blocked_id=b) or (blocker_id=b and blocked_id=a);
 insert into public.conversations(user_a,user_b,closed) values(least(a,b),greatest(a,b),false)
 on conflict(user_a,user_b) do update set closed=false returning id into cid;
 update public.privacy set show_online=true,show_activity=true,read_receipts=true where user_id in (a,b);
 perform set_config('request.jwt.claim.sub',au::text,true); set local role authenticated;
 v:=public.peer_presence(cid);
 assert v->>'online' is not null and (v->>'announce')::boolean, 'open presence still works';
 reset role;
 update public.conversations set closed=true where id=cid;
 set local role authenticated;
 v:=public.peer_presence(cid);
 assert v->'online'='null'::jsonb and v->'activity'='null'::jsonb and not (v->>'announce')::boolean and not (v->>'receipts')::boolean and (v->>'closed')::boolean, 'closed hides presence';
 reset role;
 update public.conversations set closed=false where id=cid;
 insert into public.blocks(blocker_id,blocked_id) values(b,a);
 set local role authenticated;
 v:=public.peer_presence(cid);
 assert v->'online'='null'::jsonb and v->'activity'='null'::jsonb and not (v->>'announce')::boolean and not (v->>'receipts')::boolean and (v->>'closed')::boolean, 'blocked viewer gets no presence';
 perform set_config('request.jwt.claim.sub',bu::text,true);
 v:=public.peer_presence(cid);
 assert v->'online'='null'::jsonb and v->'activity'='null'::jsonb and not (v->>'announce')::boolean and not (v->>'receipts')::boolean, 'blocker also gets no presence';
 perform set_config('request.jwt.claim.sub',ou::text,true);
 failed:=false; begin perform public.peer_presence(cid); exception when others then failed:=true; end;
 assert failed, 'outsiders must not access presence';
 raise notice 'closed and blocked presence protections passed';
end $test$;
rollback;
