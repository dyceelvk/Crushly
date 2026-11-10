-- Disposable database only: synthetic seed accounts, no production data.
begin;
do $$
declare
  a_uuid uuid; b_uuid uuid; a_id bigint; b_id bigint; v_circle_id bigint;
  v_post_id bigint; post_row public.posts; n integer; denied boolean;
begin
  select id into a_uuid from auth.users where email='daniel@crushly.app';
  select id into b_uuid from auth.users where email='marcus@crushly.app';
  select id into a_id from public.profiles where auth_user_id=a_uuid;
  select id into b_id from public.profiles where auth_user_id=b_uuid;
  assert a_id is not null and b_id is not null, 'synthetic members required';
  insert into public.circles(owner_id,name,about,discoverable,join_policy)
    values (a_id,'Private RLS test','synthetic',false,'invite') returning id into v_circle_id;
  insert into public.circle_members(circle_id,member_id,role) values(v_circle_id,a_id,'owner');
  insert into public.posts(author_id,body,audience) values(a_id,'private fixture','private') returning id into v_post_id;
  select * into post_row from public.posts p where p.id=v_post_id;
  insert into public.post_comments(post_id,author_id,body) values(v_post_id,a_id,'visible to owner');
  assert not has_function_privilege('anon','public.can_view_post(public.posts,bigint)','execute');
  assert not has_function_privilege('authenticated','public.can_view_post(public.posts,bigint)','execute');
  assert not has_function_privilege('authenticated','public.is_circle_member(bigint,bigint)','execute');
  assert not has_function_privilege('anon','public.holup_circle_member_as_me(bigint)','execute');
  perform set_config('request.jwt.claim.sub',a_uuid::text,true);
  set local role authenticated;
  assert public.holup_circle_member_as_me(v_circle_id), 'member must be recognized';
  assert public.holup_can_view_post_as_me(post_row), 'owner must see own private post';
  select count(*) into n from public.circle_members cm where cm.circle_id=v_circle_id;
  assert n=1, 'owner must retain RLS access to members';
  select count(*) into n from public.post_comments c where c.post_id=v_post_id;
  assert n=1, 'owner must retain RLS access to comments';
  denied:=false;
  begin perform public.is_circle_member(v_circle_id,b_id); exception when insufficient_privilege then denied:=true; end;
  assert denied, 'direct membership impersonation must be denied';
  denied:=false;
  begin perform public.can_view_post(post_row,b_id); exception when insufficient_privilege then denied:=true; end;
  assert denied, 'direct viewer impersonation must be denied';
  perform set_config('request.jwt.claim.sub',b_uuid::text,true);
  assert not public.holup_circle_member_as_me(v_circle_id), 'nonmember must not gain access';
  assert not public.holup_can_view_post_as_me(post_row), 'nonowner must not see a private post';
  select count(*) into n from public.circle_members cm where cm.circle_id=v_circle_id;
  assert n=0, 'nonmember cannot read member rows';
  select count(*) into n from public.post_comments c where c.post_id=v_post_id;
  assert n=0, 'nonowner cannot read private post comments';
end $$;
rollback;
