-- Add Up is a request, and every state has a door that leads out of it.
--
-- What this pins, in the order a person meets it:
--
--   1. Asking writes a request, not a connection. The pair is not connected
--      until somebody answers, and the person asked is told once.
--   2. Asking twice is one request and one notification — not two, and not a
--      second chance to spam somebody's centre.
--   3. Accept connects both members, immediately and in one direction of truth:
--      `connections` says so, and both rows are recorded as answered.
--   4. Decline refuses, sends nothing, and takes the request out of the
--      recipient's centre. Asking again is refused until the cooldown passes.
--   5. Cancel withdraws it: the asker can stop waiting, and the person who was
--      asked stops seeing it.
--   6. Two people asking each other at the same time is an answer, not two
--      pending rows: whoever asks second completes the pair.
--   7. Only the person a request was sent to can answer it, and only the person
--      who sent it can withdraw it.
--   8. Keep Close is untouched by all of this: following needs nobody's
--      permission, and neither act performs the other.
do $$
declare
  a_uuid uuid; b_uuid uuid; c_uuid uuid;
  a_id bigint; b_id bigint; c_id bigint;
  state jsonb;
  prof jsonb;
  n integer;
  connected boolean;
begin
  select id into a_uuid from auth.users where email = 'daniel@crushly.app';
  select id into b_uuid from auth.users where email = 'marcus@crushly.app';
  select id into c_uuid from auth.users where email = 'tobi@crushly.app';
  select id into a_id from profiles where name = 'Daniel';
  select id into b_id from profiles where name = 'Marcus';
  select id into c_id from profiles where name = 'Tobi';

  -- Start from nothing between these three, so every assertion below is about
  -- what this test did rather than what the fixture left behind.
  delete from public.connections where user_a in (a_id, b_id, c_id) and user_b in (a_id, b_id, c_id);
  delete from public.crushes where from_id in (a_id, b_id, c_id) and to_id in (a_id, b_id, c_id);
  delete from public.keeps where keeper_id in (a_id, b_id, c_id) and kept_id in (a_id, b_id, c_id);
  delete from public.notifications where user_id in (a_id, b_id, c_id);

  -- ------------------------------------------------------------ 1. asking

  perform set_config('request.jwt.claim.sub', a_uuid::text, false);
  set local role authenticated;
  state := public.crush_member(b_id, false, null);
  reset role;

  if (state->>'request') is distinct from 'pending' then
    raise exception 'asking produced state % instead of pending', state->>'request';
  end if;
  if public.is_connected_pair(a_id, b_id) then
    raise exception 'asking connected the pair; a request is not a connection';
  end if;
  select count(*) into n from public.notifications where user_id = b_id and kind = 'crush' and actor_id = a_id;
  if n <> 1 then
    raise exception 'a request produced % notifications instead of one', n;
  end if;

  -- ------------------------------------------- 2. asking twice is one ask

  perform set_config('request.jwt.claim.sub', a_uuid::text, false);
  set local role authenticated;
  perform public.crush_member(b_id, false, null);
  reset role;
  select count(*) into n from public.crushes where from_id = a_id and to_id = b_id;
  if n <> 1 then
    raise exception 'asking twice made % rows', n;
  end if;
  select count(*) into n from public.notifications where user_id = b_id and kind = 'crush' and actor_id = a_id;
  if n <> 1 then
    raise exception 'asking twice made % notifications', n;
  end if;

  -- Both sides read the truth about each other, from their own side.
  prof := public.public_profile(b_id, a_id, false);
  if (prof->'crush'->>'received')::boolean is not true then
    raise exception 'the person asked cannot see the request waiting for them';
  end if;
  if (prof->'crush'->>'mutual')::boolean is true then
    raise exception 'the person asked is told they are already connected';
  end if;

  -- ---------------------------------------------------------- 3. accepting

  perform set_config('request.jwt.claim.sub', b_uuid::text, false);
  set local role authenticated;
  state := public.accept_connection_request(a_id);
  reset role;

  if (state->>'connected')::boolean is not true then
    raise exception 'accepting did not return a connection';
  end if;
  if not public.is_connected_pair(a_id, b_id) then
    raise exception 'accepting did not connect the pair';
  end if;
  select count(*) into n from public.crushes
   where from_id = a_id and to_id = b_id and status = 'accepted' and responded_at is not null;
  if n <> 1 then
    raise exception 'the accepted request was not recorded as answered';
  end if;
  select count(*) into n from public.notifications where user_id = a_id and kind = 'mutual' and actor_id = b_id;
  if n <> 1 then
    raise exception 'the asker was not told the request was accepted (% rows)', n;
  end if;
  -- Accepting is not following.
  select count(*) into n from public.keeps
   where (keeper_id = a_id and kept_id = b_id) or (keeper_id = b_id and kept_id = a_id);
  if n <> 0 then
    raise exception 'accepting a request started following somebody';
  end if;

  -- ---------------------------------------------------------- 4. declining

  delete from public.connections where user_a = least(a_id, c_id) and user_b = greatest(a_id, c_id);
  delete from public.crushes where from_id = a_id and to_id = c_id;
  perform set_config('request.jwt.claim.sub', a_uuid::text, false);
  set local role authenticated;
  perform public.crush_member(c_id, false, null);
  reset role;
  select count(*) into n from public.notifications where user_id = c_id and actor_id = a_id;
  if n <> 1 then
    raise exception 'the second request was not announced';
  end if;

  perform set_config('request.jwt.claim.sub', c_uuid::text, false);
  set local role authenticated;
  perform public.decline_connection_request(a_id);
  reset role;

  if public.is_connected_pair(a_id, c_id) then
    raise exception 'declining connected the pair';
  end if;
  select count(*) into n from public.crushes where from_id = a_id and to_id = c_id and status = 'declined';
  if n <> 1 then
    raise exception 'the declined request was not recorded';
  end if;
  select count(*) into n from public.notifications where user_id = c_id and kind = 'crush' and actor_id = a_id;
  if n <> 0 then
    raise exception 'a declined request is still sitting in the centre';
  end if;

  -- Asking again straight away is refused, and the refusal says why.
  begin
    perform set_config('request.jwt.claim.sub', a_uuid::text, false);
    set local role authenticated;
    perform public.crush_member(c_id, false, null);
    reset role;
    raise exception 'a declined request could be re-sent immediately';
  exception
    when others then
      if position('request_cooldown' in sqlerrm) = 0 and position('few days' in sqlerrm) = 0 then
        raise;
      end if;
      reset role;
  end;

  -- ---------------------------------------------------------- 5. cancelling

  delete from public.crushes where from_id = b_id and to_id = c_id;
  perform set_config('request.jwt.claim.sub', b_uuid::text, false);
  set local role authenticated;
  perform public.crush_member(c_id, false, null);
  reset role;
  perform set_config('request.jwt.claim.sub', b_uuid::text, false);
  set local role authenticated;
  perform public.cancel_connection_request(c_id);
  reset role;

  select count(*) into n from public.crushes where from_id = b_id and to_id = c_id and status = 'cancelled';
  if n <> 1 then
    raise exception 'cancelling did not record the withdrawal';
  end if;
  select count(*) into n from public.notifications where user_id = c_id and kind = 'crush' and actor_id = b_id;
  if n <> 0 then
    raise exception 'a withdrawn request is still in the centre';
  end if;

  -- ---------------------------------------- 6. two asks are an answer

  delete from public.connections where user_a = least(b_id, c_id) and user_b = greatest(b_id, c_id);
  delete from public.crushes where from_id in (b_id, c_id) and to_id in (b_id, c_id);

  perform set_config('request.jwt.claim.sub', b_uuid::text, false);
  set local role authenticated;
  perform public.crush_member(c_id, false, null);
  reset role;

  perform set_config('request.jwt.claim.sub', c_uuid::text, false);
  set local role authenticated;
  state := public.crush_member(b_id, false, null);
  reset role;

  if (state->>'request') is distinct from 'accepted' or not public.is_connected_pair(b_id, c_id) then
    raise exception 'two people asking each other did not become a connection';
  end if;
  select count(*) into n from public.crushes
   where status = 'pending' and ((from_id = b_id and to_id = c_id) or (from_id = c_id and to_id = b_id));
  if n <> 0 then
    raise exception 'a completed pair still has % pending requests', n;
  end if;

  -- --------------------------------- 7. only the right person can answer

  delete from public.connections where user_a = least(a_id, b_id) and user_b = greatest(a_id, b_id);
  delete from public.crushes where from_id in (a_id, b_id) and to_id in (a_id, b_id);
  perform set_config('request.jwt.claim.sub', a_uuid::text, false);
  set local role authenticated;
  perform public.crush_member(b_id, false, null);
  reset role;

  begin
    perform set_config('request.jwt.claim.sub', c_uuid::text, false);
    set local role authenticated;
    perform public.accept_connection_request(a_id);
    reset role;
    raise exception 'somebody else answered a request that was not theirs';
  exception
    when others then
      -- Matched on a fragment with no apostrophe in it: the message uses a
      -- typographic one, and a test that trips over punctuation tests the
      -- punctuation.
      if position('waiting for an answer' in sqlerrm) = 0 then raise; end if;
      reset role;
  end;

  begin
    perform set_config('request.jwt.claim.sub', b_uuid::text, false);
    set local role authenticated;
    perform public.cancel_connection_request(a_id);   -- b was asked; b cannot withdraw a's ask
    reset role;
    raise exception 'the recipient withdrew a request they did not send';
  exception
    when others then
      if position('have a request waiting' in sqlerrm) = 0 then raise; end if;
      reset role;
  end;

  -- --------------------------------- 8. Keep Close is a different relationship

  perform set_config('request.jwt.claim.sub', c_uuid::text, false);
  set local role authenticated;
  perform public.keep_close(a_id);
  reset role;

  select count(*) into n from public.keeps where keeper_id = c_id and kept_id = a_id;
  if n <> 1 then
    raise exception 'following did not record a follow';
  end if;
  if public.is_connected_pair(a_id, c_id) then
    raise exception 'following connected the pair';
  end if;
  select count(*) into n from public.crushes
   where from_id = c_id and to_id = a_id and status = 'pending';
  if n <> 0 then
    raise exception 'following sent an Add up request';
  end if;

  raise notice 'Add Up: request → accept / decline / cancel, duplicates impossible, cooldown enforced, Keep Close separate.';
end $$;
