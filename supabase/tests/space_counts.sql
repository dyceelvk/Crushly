-- Identity visibility is enforced in SQL, not merely by hiding a button.
begin;
do $test$
declare owner_uuid uuid; close_uuid uuid; other_uuid uuid; owner_id bigint; close_id bigint; other_id bigint; r jsonb; denied boolean; public_post bigint; private_post bigint; public_before bigint; owner_before bigint;
begin
  select id into owner_uuid from auth.users where email='marcus@crushly.app';
  select id into close_uuid from auth.users where email='daniel@crushly.app';
  select id into other_uuid from auth.users where email='tobi@crushly.app';
  select id into owner_id from profiles where auth_user_id=owner_uuid;
  select id into close_id from profiles where auth_user_id=close_uuid;
  select id into other_id from profiles where auth_user_id=other_uuid;
  assert owner_id is not null and close_id is not null and other_id is not null;
  update profiles set onboarded=true,status='active' where id in (owner_id,close_id,other_id);
  update privacy set profile_visibility='everyone',incognito=false,add_up_list_visibility='private' where user_id in (owner_id,close_id,other_id);
  delete from blocks where blocker_id in (owner_id,close_id,other_id) and blocked_id in (owner_id,close_id,other_id);
  delete from holup_existing_close_pairs where user_a=owner_id or user_b=owner_id;
  delete from connections where user_a=owner_id or user_b=owner_id or (user_a in (close_id,other_id) and user_b in (close_id,other_id));
  delete from crushes where to_id=owner_id or (from_id in (owner_id,close_id,other_id) and to_id in (owner_id,close_id,other_id));
  delete from keeps where kept_id=owner_id or keeper_id=owner_id;
  -- One mutual and one incoming-only Keep; connections do not count.
  insert into keeps(keeper_id,kept_id) values(close_id,owner_id),(owner_id,close_id),(other_id,owner_id);
  insert into connections(user_a,user_b) values(least(owner_id,close_id),greatest(owner_id,close_id));
  insert into holup_existing_close_pairs(user_a,user_b) values(least(owner_id,close_id),greatest(owner_id,close_id)) on conflict do nothing;
  insert into crushes(from_id,to_id,status) values(close_id,owner_id,'accepted'),(other_id,owner_id,'pending');

  perform set_config('request.jwt.claim.sub',other_uuid::text,true); set local role authenticated;
  public_before := (space_relationship_stats(owner_id)->>'postLikes')::bigint;
  reset role;
  perform set_config('request.jwt.claim.sub',owner_uuid::text,true); set local role authenticated;
  owner_before := (space_relationship_stats(owner_id)->>'postLikes')::bigint;
  reset role;
  insert into public.posts(author_id,body,audience) values(owner_id,'public fixture','everyone') returning id into public_post;
  insert into public.posts(author_id,body,audience) values(owner_id,'private fixture','private') returning id into private_post;
  insert into public.post_reactions(post_id,user_id) values(public_post,other_id),(private_post,other_id);
  perform set_config('request.jwt.claim.sub',owner_uuid::text,true); set local role authenticated;
  assert (space_relationship_stats(owner_id)->>'postLikes')::bigint=owner_before+2, 'owner likes count wrong';
  reset role;
  perform set_config('request.jwt.claim.sub',other_uuid::text,true); set local role authenticated;
  r:=space_relationship_stats(owner_id);
  assert (r->>'postLikes')::bigint=public_before+1, 'private post reaction leaked';
  assert (r->>'addUps')::int=2 and (r->>'keptClose')::int=1, 'counts incorrect';
  assert not (r->>'canViewAddUps')::boolean and not (r->>'canViewKeptClose')::boolean, 'private list exposed';
  assert r->>'addUpVisibility' is null, 'owner setting exposed';
  denied:=false; begin perform space_relationship_people(owner_id,'addUps'); exception when others then denied:=true; end; assert denied, 'stranger accessed private add ups';
  denied:=false; begin perform space_relationship_people(owner_id,'keptClose'); exception when others then denied:=true; end; assert denied, 'stranger accessed kept close';
  reset role;

  perform set_config('request.jwt.claim.sub',owner_uuid::text,true); set local role authenticated;
  r:=space_relationship_people(owner_id,'addUps',0,1);
  assert jsonb_array_length(r->'items')=1 and (r->>'hasMore')::boolean, 'paging missing';
  r:=space_relationship_people(owner_id,'addUps',1,1);
  assert jsonb_array_length(r->'items')=1 and not (r->>'hasMore')::boolean, 'paging ending wrong';
  perform set_add_up_list_visibility('close');
  reset role;

  perform set_config('request.jwt.claim.sub',close_uuid::text,true); set local role authenticated;
  r:=space_relationship_stats(owner_id); assert (r->>'canViewAddUps')::boolean and (r->>'canViewKeptClose')::boolean, 'existing approved connection should be allowed';
  assert jsonb_array_length(space_relationship_people(owner_id,'keptClose')->'items')=1, 'approved Close One absent';
  reset role;
  perform set_config('request.jwt.claim.sub',other_uuid::text,true); set local role authenticated;
  denied:=false; begin perform space_relationship_people(owner_id,'addUps'); exception when others then denied:=true; end; assert denied, 'close-only exposed to stranger';
  reset role;

  perform set_config('request.jwt.claim.sub',owner_uuid::text,true); set local role authenticated;
  perform set_add_up_list_visibility('everyone');
  denied:=false; begin perform set_add_up_list_visibility('other'); exception when others then denied:=true; end; assert denied, 'invalid visibility accepted';
  reset role;
  -- A legacy connection without reciprocal Keeps is not a Close One.
  insert into connections(user_a,user_b) values(least(owner_id,other_id),greatest(owner_id,other_id)) on conflict do nothing;
  perform set_config('request.jwt.claim.sub',other_uuid::text,true); set local role authenticated;
  denied:=false; begin perform space_relationship_people(owner_id,'keptClose'); exception when others then denied:=true; end; assert denied, 'legacy connection exposed Kept Close identities';
  reset role;
  -- Private individual profiles stay hidden, even in an otherwise visible list.
  update privacy set profile_visibility='connections' where user_id=close_id;
  -- Legacy load_visible_profile has a broad historical-crush exception. A
  -- cancelled follow must not reveal this private identity in a directory.
  insert into crushes(from_id,to_id,status) values(close_id,other_id,'cancelled');
  perform set_config('request.jwt.claim.sub',other_uuid::text,true); set local role authenticated;
  r:=space_relationship_people(owner_id,'addUps');
  assert jsonb_array_length(r->'items')=1 and (r->'items'->0->>'id')::bigint=other_id, 'hidden profile leaked';
  reset role;
  -- If the Space itself cannot be viewed, neither totals nor identities leak.
  update privacy set profile_visibility='connections' where user_id=owner_id;
  perform set_config('request.jwt.claim.sub',other_uuid::text,true); set local role authenticated;
  denied:=false; begin perform space_relationship_stats(owner_id); exception when others then denied:=true; end; assert denied, 'private Space statistics leaked';
  reset role;
  raise notice 'space relationship visibility tests passed';
end $test$;
rollback;
