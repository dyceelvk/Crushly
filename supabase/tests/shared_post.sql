-- A post reference remains a text Whisper, contains no media, and is still
-- subject to load_post's audience rules for the receiving member.
begin;
do $$
declare daniel uuid; marcus uuid; did bigint; mid bigint; post_id bigint; conv bigint; sent jsonb; readback jsonb;
begin
  select id into daniel from auth.users where email='daniel@crushly.app';
  select id into marcus from auth.users where email='marcus@crushly.app';
  select id into did from profiles where auth_user_id=daniel;
  select id into mid from profiles where auth_user_id=marcus;
  insert into connections(user_a,user_b) values (least(did,mid),greatest(did,mid)) on conflict do nothing;
  -- A conversation left closed by an earlier fixture is not a place to send, and
  -- this test is about the shared post itself.
  update conversations set closed = false where user_a=least(did,mid) and user_b=greatest(did,mid);
  perform set_config('request.jwt.claim.sub',marcus::text,true);
  set local role authenticated;
  post_id := (public.create_post('shared post fixture',null,'everyone',null,null)->>'id')::bigint;
  conv := (select id from conversations where user_a=least(did,mid) and user_b=greatest(did,mid));
  -- The pair agreed to talk, so the fixture records that answer: since migration
  -- 20261110080000 an unanswered conversation carries a pending Whisper request
  -- and sharing into it is refused until the recipient answers. Written as the
  -- owner because the permission table is deliberately not writable by members.
  -- This test is about what a shared post contains.
  reset role;
  update public.holup_whisper_permissions set state = 'accepted' where conversation_id = conv;
  set local role authenticated;
  sent := public.send_message(conv,'text','Shared a Flow post — tap to open',null,jsonb_build_object('postId',post_id));
  assert (sent->'meta'->>'postId')::bigint=post_id, 'message retains reference';
  assert sent->>'mediaUrl' is null, 'message contains no copied media';
  perform set_config('request.jwt.claim.sub',daniel::text,true);
  readback := public.get_messages(conv,0,0,40);
  assert exists (select 1 from jsonb_array_elements(readback->'items') m where (m->>'id')::bigint=(sent->>'id')::bigint and (m->'meta'->>'postId')::bigint=post_id), 'recipient gets post reference';
  assert (public.load_post(post_id)->>'id')::bigint=post_id, 'recipient can open visible post';
  insert into blocks(blocker_id,blocked_id) values (did,mid) on conflict do nothing;
  begin
    perform public.load_post(post_id);
    raise exception 'blocked post unexpectedly visible';
  exception when others then
    if sqlerrm not like '%post isn%available%' then raise; end if;
  end;
end $$;
rollback;
