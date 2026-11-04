-- Asking to join a Circle, and an owner answering.
--
-- The rule the brief asked to be enforced in the backend is this: a member asks,
-- the owner decides, and no client can do either on somebody else's behalf. So
-- the assertions are mostly about the refusals — asking yourself in, answering a
-- request for a room you do not own, and being waved into a room that is already
-- full.
--
-- Fixtures are written before the role is switched, as the schema owner, because
-- circle_members and circles are protected by RLS that members are not meant to
-- write through directly.
do $$
declare
  owner_uuid uuid;
  asker_uuid uuid;
  other_uuid uuid;
  owner_id bigint;
  asker_id bigint;
  other_id bigint;
  cid bigint;
  rid bigint;
  j jsonb;
  liked_post bigint;
begin
  select id into owner_uuid from auth.users where email = 'daniel@crushly.app';
  select id into asker_uuid from auth.users where email = 'marcus@crushly.app';
  select id into other_uuid from auth.users where email = 'jayden@crushly.app';
  select id into owner_id from profiles where name = 'Daniel';
  select id into asker_id from profiles where name = 'Marcus';
  select id into other_id from profiles where name = 'Jayden';

  insert into public.circles (owner_id, name, about, visibility)
    values (owner_id, 'Request Room', 'a room you have to ask to enter', 'public')
    returning id into cid;

  -- One member is already inside, so the room is not empty.
  insert into public.circle_members (circle_id, member_id, role) values (cid, owner_id, 'owner');

  -- Engagement that a highlight is allowed to be about: a post with reactions.
  insert into public.posts (author_id, body, circle_id) values (owner_id, 'first light', cid) returning id into liked_post;
  insert into public.post_reactions (post_id, user_id) values (liked_post, owner_id);
  insert into public.post_reactions (post_id, user_id) values (liked_post, asker_id);

  /* --------------------------------------------------------------- asking */
  perform set_config('request.jwt.claim.sub', asker_uuid::text, false);
  set role authenticated;

  j := public.request_join_circle(cid);
  assert j->>'status' = 'pending', 'asking should leave a pending request';
  rid := (j->>'requestId')::bigint;

  -- Asking twice is the same request, not a second one.
  j := public.request_join_circle(cid);
  assert (j->>'requestId')::bigint = rid, 'a second ask must not create a second request';

  -- And asking does not let you in.
  assert not exists (
    select 1 from public.circle_messages where circle_id = cid
  ), 'a pending request must not grant the room';

  -- A member cannot approve their own request.
  begin
    perform public.decide_circle_request(rid, true);
    assert false, 'a member must not be able to approve their own request';
  exception when others then
    null;
  end;

  assert exists (
    select 1 from public.circle_join_requests where id = rid and status = 'pending'
  ), 'the refused approval must not have changed the request';

  /* -------------------------------------------------------------- owning */
  perform set_config('request.jwt.claim.sub', owner_uuid::text, false);

  j := public.my_circle_requests();
  assert jsonb_array_length(j) = 1, 'the owner should see exactly one request';
  assert j->0->>'circleId' = cid::text, 'the request should name the room';
  assert j->0->'member'->>'name' = 'Marcus', 'the request should carry the asker';

  -- Somebody who does not own the room cannot answer for it.
  perform set_config('request.jwt.claim.sub', other_uuid::text, false);
  begin
    perform public.decide_circle_request(rid, true);
    assert false, 'a stranger must not answer a request';
  exception when others then
    null;
  end;

  /* ------------------------------------------------------------ approving */
  perform set_config('request.jwt.claim.sub', owner_uuid::text, false);
  j := public.decide_circle_request(rid, true);
  assert (j->>'approved')::boolean, 'the owner''s approval should be recorded';

  assert exists (
    select 1 from public.circle_members where circle_id = cid and member_id = asker_id
  ), 'approving must create the membership';

  assert exists (
    select 1 from public.circle_join_requests where id = rid and status = 'approved'
  ), 'the request should be marked approved, not deleted';

  -- Answering the same request twice is refused, so an approve cannot be replayed.
  begin
    perform public.decide_circle_request(rid, true);
    assert false, 'an answered request must not be answerable again';
  exception when others then
    null;
  end;

  /* ---------------------------------------------------------- the capacity */
  -- Fill the room, then check that an approval cannot take it past twelve.
  insert into public.circle_members (circle_id, member_id, role)
    select cid, p.id, 'member'
      from profiles p
     where p.id not in (select member_id from public.circle_members where circle_id = cid)
     limit 10;

  perform set_config('request.jwt.claim.sub', other_uuid::text, false);
  j := public.request_join_circle(cid);

  perform set_config('request.jwt.claim.sub', owner_uuid::text, false);
  begin
    perform public.decide_circle_request((j->>'requestId')::bigint, true);
    assert false, 'a full Circle must not accept another member';
  exception when others then
    null;
  end;

  assert (select count(*) from public.circle_members where circle_id = cid) <= 12,
    'a Circle must never hold more than twelve';

  /* ------------------------------------------------------------ highlights */
  perform set_config('request.jwt.claim.sub', asker_uuid::text, false);
  j := public.circle_highlights(8);
  assert jsonb_array_length(j) >= 1, 'a member in a busy room should see a highlight';

  assert exists (
    select 1 from jsonb_array_elements(j) e
     where (e->>'circleId')::bigint = cid
       and (e->>'likes')::int = 2
       and (e->>'postId')::bigint = liked_post
  ), 'the highlight should be the real post, with its real reactions';

  -- A member who is in no Circles has nothing to be shown, not an empty card.
  perform set_config('request.jwt.claim.sub', other_uuid::text, false);
  j := public.circle_highlights(8);
  assert not exists (
    select 1 from jsonb_array_elements(j) e where (e->>'circleId')::bigint = cid
  ), 'a room you are not in must never appear in your highlights';
end $$;
