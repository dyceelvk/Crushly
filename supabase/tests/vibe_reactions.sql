-- A bounded, transaction-rolled-back test against local seed users only.
begin;
do $$
declare daniel uuid; marcus uuid; daniel_id bigint; marcus_id bigint; v bigint; r jsonb; feed jsonb;
begin
  select id into daniel from auth.users where email = 'daniel@crushly.app';
  select id into marcus from auth.users where email = 'marcus@crushly.app';
  select id into daniel_id from public.profiles where auth_user_id = daniel;
  select id into marcus_id from public.profiles where auth_user_id = marcus;
  assert daniel_id is not null and marcus_id is not null, 'fixture users must exist';
  insert into public.vibes(author_id,body,media_url,audience,expires_at)
    values(marcus_id,'reaction fixture','test.mp4','everyone',public.now_ms()+600000) returning id into v;
  perform set_config('request.jwt.claim.sub',daniel::text,true);
  set local role authenticated;
  r := public.react_to_vibe(v,true);
  assert (r->>'liked')::boolean and (r->>'likeCount')::int=1, 'first like persists';
  r := public.react_to_vibe(v,true);
  assert (r->>'likeCount')::int=1, 'repeated like is idempotent';
  feed := public.vibes_feed(60,null);
  select item into r from jsonb_array_elements(feed->'items') item where (item->>'id')::bigint=v;
  assert (r->>'liked')::boolean and (r->>'likeCount')::int=1, 'feed returns liked state';
  r := public.react_to_vibe(v,false);
  assert not (r->>'liked')::boolean and (r->>'likeCount')::int=0, 'unlike persists';
  r := public.react_to_vibe(v,false);
  assert (r->>'likeCount')::int=0, 'repeated unlike is idempotent';
  begin
    insert into public.vibe_reactions(vibe_id,user_id) values(v,daniel_id);
    raise exception 'direct insert unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  -- Blocking the author prevents reactions even if the caller knows the id.
  insert into public.blocks(blocker_id,blocked_id) values(daniel_id,marcus_id);
  begin
    perform public.react_to_vibe(v,true);
    raise exception 'blocked like unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%Vibe isn%available%' then raise; end if;
  end;
  delete from public.blocks where blocker_id=daniel_id and blocked_id=marcus_id;
  perform set_config('request.jwt.claim.sub',marcus::text,true);
  begin
    perform public.react_to_vibe(v,true);
    raise exception 'self like unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%can%like your own Vibe%' then raise; end if;
  end;
  reset role;
  update public.vibes set expires_at=public.now_ms()-1 where id=v;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',daniel::text,true);
  begin
    perform public.react_to_vibe(v,true);
    raise exception 'expired like unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%Vibe isn%available%' then raise; end if;
  end;
end $$;
rollback;
