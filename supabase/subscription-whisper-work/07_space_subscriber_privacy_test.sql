-- HISTORICAL intermediate test: run after 01 and 04 but BEFORE 08.
-- Latest mutual-Close policy supersedes its subscriber-only list permission.
-- Destructive disposable database only.
begin;
do $test$
declare own bigint:=4; subscriber bigint:=5; reverse_only bigint:=6; stranger bigint:=7; own_uuid uuid; sub_uuid uuid; reverse_uuid uuid; stranger_uuid uuid; r jsonb; denied boolean;
begin
 select auth_user_id into own_uuid from public.profiles where id=own;
 select auth_user_id into sub_uuid from public.profiles where id=subscriber;
 select auth_user_id into reverse_uuid from public.profiles where id=reverse_only;
 select auth_user_id into stranger_uuid from public.profiles where id=stranger;
 delete from public.blocks where blocker_id in (own,subscriber,reverse_only,stranger) and blocked_id in (own,subscriber,reverse_only,stranger);
 delete from public.keeps where keeper_id in (own,subscriber,reverse_only,stranger) and kept_id in (own,subscriber,reverse_only,stranger);
 delete from public.connections where user_a in (own,subscriber,reverse_only,stranger) and user_b in (own,subscriber,reverse_only,stranger);
 delete from public.crushes where from_id in (own,subscriber,reverse_only,stranger) and to_id=own;
 update public.privacy set profile_visibility='everyone',incognito=false,add_up_list_visibility='close' where user_id in (own,subscriber,reverse_only,stranger);
 insert into public.keeps(keeper_id,kept_id) values(subscriber,own),(own,reverse_only);
 insert into public.crushes(from_id,to_id,status) values(subscriber,own,'pending'),(stranger,own,'accepted');
 -- The subscriber is NOT a mutual Keep or legacy connection, but is entitled.
 perform set_config('request.jwt.claim.sub',sub_uuid::text,true); set local role authenticated;
 r:=public.space_relationship_stats(own);
 assert (r->>'canViewAddUps')::boolean and (r->>'canViewKeptClose')::boolean and (r->>'keptClose')::int=1;
 assert jsonb_array_length(public.space_relationship_people(own,'addUps')->'items')=2;
 assert jsonb_array_length(public.space_relationship_people(own,'keptClose')->'items')=1;
 assert (public.load_profile(own)#>>'{crush,sent}')::boolean, 'active pending Add Up missing';
 reset role;
 update public.crushes set status='accepted' where from_id=subscriber and to_id=own;
 perform set_config('request.jwt.claim.sub',sub_uuid::text,true); set local role authenticated;
 assert (public.load_profile(own)#>>'{crush,sent}')::boolean, 'active migrated Add Up missing';
 reset role;
 update public.crushes set status='declined' where from_id=subscriber and to_id=own;
 perform set_config('request.jwt.claim.sub',sub_uuid::text,true); set local role authenticated;
 assert not (public.load_profile(own)#>>'{crush,sent}')::boolean, 'inactive Add Up shown active';
 reset role;
 update public.crushes set status='accepted' where from_id=subscriber and to_id=own;
 -- A person who the owner Keeps is NOT a subscriber unless they Keep back.
 perform set_config('request.jwt.claim.sub',reverse_uuid::text,true); set local role authenticated;
 r:=public.space_relationship_stats(own);
 assert not (r->>'canViewAddUps')::boolean and not (r->>'canViewKeptClose')::boolean;
 denied:=false; begin perform public.space_relationship_people(own,'addUps'); exception when sqlstate 'P0001' then denied:=true; end; assert denied, 'reverse-only Keep gained Add Up list';
 denied:=false; begin perform public.space_relationship_people(own,'keptClose'); exception when sqlstate 'P0001' then denied:=true; end; assert denied, 'reverse-only Keep gained Kept Close list';
 reset role;
 perform set_config('request.jwt.claim.sub',stranger_uuid::text,true); set local role authenticated;
 assert not (public.space_relationship_stats(own)->>'canViewAddUps')::boolean;
 denied:=false; begin perform public.space_relationship_people(own,'addUps'); exception when sqlstate 'P0001' then denied:=true; end; assert denied;
 reset role;
 -- Unsubscribe removes access immediately without touching Add Ups or Whispers.
 perform set_config('request.jwt.claim.sub',sub_uuid::text,true); set local role authenticated;
 perform public.v3_keep_unsubscribe(own);
 assert not (public.space_relationship_stats(own)->>'canViewAddUps')::boolean;
 denied:=false; begin perform public.space_relationship_people(own,'addUps'); exception when sqlstate 'P0001' then denied:=true; end; assert denied;
 reset role;
 assert exists(select 1 from public.crushes where from_id=subscriber and to_id=own), 'unsubscribe removed Add Up';
 -- Owner can choose public or private regardless of subscription.
 perform set_config('request.jwt.claim.sub',own_uuid::text,true); set local role authenticated;
 perform public.set_add_up_list_visibility('everyone');
 assert jsonb_array_length(public.space_relationship_people(own,'addUps',0,1)->'items')=1;
 assert (public.space_relationship_people(own,'addUps',0,1)->>'hasMore')::boolean;
 reset role;
 perform set_config('request.jwt.claim.sub',stranger_uuid::text,true); set local role authenticated;
 assert (public.space_relationship_stats(own)->>'canViewAddUps')::boolean;
 reset role;
 update public.privacy set incognito=true where user_id=subscriber;
 perform set_config('request.jwt.claim.sub',stranger_uuid::text,true); set local role authenticated;
 assert jsonb_array_length(public.space_relationship_people(own,'addUps')->'items')=1, 'hidden identity leaked in public list';
 reset role;
 perform set_config('request.jwt.claim.sub',own_uuid::text,true); set local role authenticated;
 perform public.set_add_up_list_visibility('private');
 reset role;
 perform set_config('request.jwt.claim.sub',stranger_uuid::text,true); set local role authenticated;
 denied:=false; begin perform public.space_relationship_people(own,'addUps'); exception when sqlstate 'P0001' then denied:=true; end; assert denied;
 reset role;
 -- Outgoing Close Ones must filter unavailable profiles rather than expose raw profiles.
 update public.privacy set incognito=true where user_id=reverse_only;
 perform set_config('request.jwt.claim.sub',own_uuid::text,true); set local role authenticated;
 assert jsonb_array_length(public.close_ones()->'items')=0, 'hidden Space exposed via Close Ones';
 reset role;
 -- Block overrides subscriber permissions and Space availability.
 update public.privacy set incognito=false where user_id=reverse_only;
 insert into public.keeps(keeper_id,kept_id) values(subscriber,own) on conflict do nothing;
 insert into public.blocks(blocker_id,blocked_id) values(own,subscriber);
 perform set_config('request.jwt.claim.sub',sub_uuid::text,true); set local role authenticated;
 denied:=false; begin perform public.space_relationship_stats(own); exception when sqlstate 'P0001' then denied:=true; end; assert denied, 'blocked subscriber accessed Space counts';
 reset role;
 raise notice 'subscriber-defined Space list privacy passed';
end $test$;
rollback;
