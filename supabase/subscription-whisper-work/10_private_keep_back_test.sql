-- Disposable DB only. Requires 01 + 04 + 08. Validate the consent-limited
-- invitation card and private-Space reciprocal Keep path.
begin;
do $test$
declare owner_id bigint:=4; private_id bigint:=5; stranger_id bigint:=6; owner_uuid uuid; stranger_uuid uuid; r jsonb; item jsonb; denied boolean;
begin
 select auth_user_id into owner_uuid from profiles where id=owner_id;
 select auth_user_id into stranger_uuid from profiles where id=stranger_id;
 delete from blocks where blocker_id in (owner_id,private_id,stranger_id) and blocked_id in (owner_id,private_id,stranger_id);
 delete from keeps where keeper_id in (owner_id,private_id,stranger_id) and kept_id in (owner_id,private_id,stranger_id);
 update privacy set profile_visibility='everyone',incognito=false where user_id in (owner_id,stranger_id);
 update privacy set profile_visibility='connections',incognito=true where user_id=private_id;
 insert into keeps(keeper_id,kept_id) values(private_id,owner_id);
 perform set_config('request.jwt.claim.sub',stranger_uuid::text,true); set local role authenticated;
 denied:=false; begin perform public.v3_keep_subscribe(private_id); exception when sqlstate 'P0001' then denied:=true; end; assert denied,'stranger added a hidden Space';
 assert jsonb_array_length(public.v3_keep_people('incoming')->'items')=0, 'non-recipient saw incoming card';
 reset role;
 perform set_config('request.jwt.claim.sub',owner_uuid::text,true); set local role authenticated;
 assert public.load_profile(private_id) is null,'private Space details accessible before reciprocity';
 r:=public.v3_keep_people('incoming'); assert jsonb_array_length(r->'items')=1;
 item:=r->'items'->0;
 assert (item->>'limited')::boolean and (item->>'canKeepBack')::boolean,'private Keep card not actionable';
 assert (item->'profile'->>'id')::bigint=private_id and jsonb_array_length(item->'profile'->'photos')=0;
 assert not (item->'profile' ?| array['bio','age','city','username','online','activity','interests','intentions','crush']), 'private details leaked';
 assert (public.v3_keep_subscribe(private_id)->>'mutual')::boolean,'recipient cannot Keep private sender back';
 assert public.load_profile(private_id) is not null,'reciprocal Close Ones cannot open Space';
 r:=public.v3_keep_people('incoming'); assert not (r->'items'->0->>'limited')::boolean and not (r->'items'->0->>'canKeepBack')::boolean;
 assert public.v3_keep_unsubscribe(private_id);
 insert into blocks(blocker_id,blocked_id) values(owner_id,private_id);
 assert jsonb_array_length(public.v3_keep_people('incoming')->'items')=0, 'blocked sender in Keep inbox';
 denied:=false; begin perform public.v3_keep_subscribe(private_id); exception when sqlstate 'P0001' then denied:=true; end; assert denied,'blocked sender can be Kept Close';
 reset role;
 raise notice 'private Keep-back and privacy tests passed';
end $test$;
rollback;
