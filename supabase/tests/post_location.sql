do $$
declare
  a bigint := (select id from public.profiles where name='Daniel');
  b bigint := (select id from public.profiles where name='Ryan');
  au uuid := (select auth_user_id from public.profiles where id=a);
  bu uuid := (select auth_user_id from public.profiles where id=b);
  p jsonb; pid bigint;
begin
  perform set_config('request.jwt.claim.sub',au::text,false);
  p := public.create_post_with_location('Location test',null,'everyone',null,null,true,' Port Harcourt ');
  pid := (p->>'id')::bigint;
  assert p->>'location'='Port Harcourt', 'trimmed place returned on creation';
  assert public.load_post(pid)->>'location'='Port Harcourt', 'place is returned with the post';
  perform set_config('request.jwt.claim.sub',bu::text,false);
  assert public.load_post(pid)->>'location'='Port Harcourt', 'authorized viewer gets place';
  perform set_config('request.jwt.claim.sub',au::text,false);
  perform public.edit_post(pid,'Location test','private',null);
  perform set_config('request.jwt.claim.sub',bu::text,false);
  begin
    perform public.load_post(pid);
    raise exception 'private post visible to other user' using errcode='XX000';
  exception when sqlstate 'P0001' then null;
  end;
  set local role authenticated;
  begin
    perform public.post_engagement(pid,a);
    raise exception 'internal post engagement exposed' using errcode='XX000';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub',au::text,false);
  begin
    perform public.create_post_with_location('test',null,'everyone',null,null,true,repeat('a',81));
    raise exception 'long location accepted' using errcode='XX000';
  exception when sqlstate 'P0001' then null;
  end;
end $$;
