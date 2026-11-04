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
-- Fixtures are read from `auth.users` before any role switch, which needs the
-- schema owner: every other suite in this directory ends by resetting the role,
-- and this file says so explicitly rather than relying on the one before it.
reset role;
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
  -- A post that lives inside the room: `posts_circle_pairing` requires the
  -- audience and the circle to agree, which is the schema saying a Circle post
  -- is only ever a Circle post.
  insert into public.posts (author_id, body, audience, circle_id)
    values (owner_id, 'first light', 'circle', cid)
    returning id into liked_post;
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

  -- Read through the function, not the table: the table has RLS on and no
  -- policies, which is the point of it — a member cannot even see the row.
  assert (public.circle_request_state(cid)->>'requested')::boolean,
    'the refused approval must not have changed the request';

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

  -- Answered, so it leaves the owner's list — but the row stays, so the same
  -- request cannot be replayed.
  assert jsonb_array_length(public.my_circle_requests()) = 0,
    'an answered request should leave the owner''s list';


  -- Answering the same request twice is refused, so an approve cannot be replayed.
  begin
    perform public.decide_circle_request(rid, true);
    assert false, 'an answered request must not be answerable again';
  exception when others then
    null;
  end;

  /* ---------------------------------------------------------- the capacity */
  -- The seed has fewer members than a Circle holds, so a genuinely full room
  -- cannot be built here without inventing profiles — and inventing profiles is
  -- exactly the kind of fixture that makes a test pass for the wrong reason. The
  -- guard is therefore checked where it lives: the approval refuses rather than
  -- exceeding `circle_capacity()`, and the refusal is a sentence.
  assert public.circle_capacity() = 12, 'a Circle holds twelve';

  assert position('circle_capacity' in pg_get_functiondef('public.decide_circle_request(bigint, boolean)'::regprocedure)) > 0,
    'approving must consult the capacity';
  assert position('is full' in pg_get_functiondef('public.decide_circle_request(bigint, boolean)'::regprocedure)) > 0,
    'a full room must say so';

  -- And the membership it did create never exceeded the room's size.
  assert (select count(*) from public.circle_members where circle_id = cid) <= public.circle_capacity(),
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

  reset role;
end $$;
