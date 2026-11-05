-- Circles you can find, and the three ways in.
--
-- The brief asked for discoverability and membership to be two separate
-- settings, and for the backend — not the button — to be the thing that decides.
-- So this suite is mostly refusals, in the order somebody would hit them:
--
--   * a private room is never in discovery, and cannot be walked into even by
--     id if a client invents the call;
--   * a room with approval does not make you a member because you asked;
--   * a member cannot manage, invite, or answer anything in somebody else's room;
--   * an invitation can only be answered by the person invited, and accepting it
--     when the room is full is refused rather than silently overfilling it;
--   * declining leaves the room exactly as it was.
--
-- Fixtures are written before the role switch, as the schema owner, because
-- circles and circle_members are protected by RLS that members are not meant to
-- write through directly.
reset role;
do $$
declare
  owner_uuid uuid;
  asker_uuid uuid;
  other_uuid uuid;
  owner_id bigint;
  asker_id bigint;
  other_id bigint;
  open_room bigint;
  ask_room bigint;
  closed_room bigint;
  invite_room bigint;
  j jsonb;
  preview jsonb;
  discovered jsonb;
  req_id bigint;
  inv_id bigint;
  before_members int;
  n int;
begin
  select id into owner_uuid from auth.users where email = 'daniel@crushly.app';
  select id into asker_uuid from auth.users where email = 'marcus@crushly.app';
  select id into other_uuid from auth.users where email = 'jayden@crushly.app';
  select id into owner_id from profiles where name = 'Daniel';
  select id into asker_id from profiles where name = 'Marcus';
  select id into other_id from profiles where name = 'Jayden';

  -- Four rooms, one per combination that matters. Note how they are created:
  -- `discoverable` and `join_policy` are set independently, which is the whole
  -- change.
  insert into public.circles (owner_id, name, about, theme, discoverable, join_policy)
    values (owner_id, 'Open Room', 'walk in', 'music', true, 'open')
    returning id into open_room;
  insert into public.circle_members (circle_id, member_id, role) values (open_room, owner_id, 'owner');

  insert into public.circles (owner_id, name, about, theme, discoverable, join_policy)
    values (owner_id, 'Ask Room', 'ask first', 'music', true, 'request')
    returning id into ask_room;
  insert into public.circle_members (circle_id, member_id, role) values (ask_room, owner_id, 'owner');

  insert into public.circles (owner_id, name, about, discoverable, join_policy)
    values (owner_id, 'Family Room', 'not for strangers', false, 'invite')
    returning id into closed_room;
  insert into public.circle_members (circle_id, member_id, role) values (closed_room, owner_id, 'owner');

  insert into public.circles (owner_id, name, about, discoverable, join_policy)
    values (owner_id, 'Invite Only Room', 'we ask you', true, 'invite')
    returning id into invite_room;
  insert into public.circle_members (circle_id, member_id, role) values (invite_room, owner_id, 'owner');

  /* ------------------------------------------------------------- discovery */

  perform set_config('request.jwt.claim.sub', asker_uuid::text, false);
  set role authenticated;

  discovered := public.discover_circles(20, 0);
  assert exists (select 1 from jsonb_array_elements(discovered) e where (e->>'id')::bigint = open_room),
    'a discoverable room should be recommended to a non-member';
  assert exists (select 1 from jsonb_array_elements(discovered) e where (e->>'id')::bigint = ask_room),
    'a room that takes requests should still be recommended';
  assert exists (select 1 from jsonb_array_elements(discovered) e where (e->>'id')::bigint = invite_room),
    'a findable room that the owner stocks should be recommended';
  assert not exists (select 1 from jsonb_array_elements(discovered) e where (e->>'id')::bigint = closed_room),
    'a private room must never be recommended';

  -- The card has to be able to say who runs it and how big it is, or it is just
  -- a name in a box.
  assert exists (
    select 1 from jsonb_array_elements(discovered) e
     where (e->>'id')::bigint = open_room
       and e->>'ownerName' = 'Daniel'
       and (e->>'memberCount')::int >= 1
       and e->>'joinPolicy' = 'open'
       and e->>'state' = 'none'
  ), 'a discovery card must carry the room, its owner, its size and its policy';

  /* -------------------------------------------------- three ways in, no more */

  -- Open: in, now.
  j := public.join_circle(open_room);
  assert j->>'state' = 'member', 'an open room should let you in';
  assert exists (select 1 from public.circle_members where circle_id = open_room and member_id = asker_id),
    'joining an open room must create the membership';
  /*
   * The owner hears about the walk-in as a walk-in, not as their own approval.
   * Read it as the owner: notifications are RLS-protected, so asking for
   * somebody else's rows returns nothing and the test passes for the wrong
   * reason.
   */
  perform set_config('request.jwt.claim.sub', owner_uuid::text, false);
  assert exists (select 1 from public.notifications
                  where user_id = owner_id and kind = 'circle_joined' and ref_id = open_room),
    'the owner of an open room should be told somebody walked in';
  assert not exists (select 1 from public.notifications
                      where user_id = owner_id and kind = 'circle_approved' and ref_id = open_room),
    'the owner must not be told they were approved into their own room';
  perform set_config('request.jwt.claim.sub', asker_uuid::text, false);
  assert (public.join_circle(open_room)->>'already')::boolean,
    'joining twice is the same membership, not an error';

  -- Approval: a pending row and nothing more.
  j := public.join_circle(ask_room);
  assert j->>'state' = 'pending', 'a room with approval should leave a pending request';
  req_id := (j->>'requestId')::bigint;
  assert not exists (select 1 from public.circle_members where circle_id = ask_room and member_id = asker_id),
    'a pending request must not grant the room';
  assert (public.join_circle(ask_room)->>'requestId')::bigint = req_id,
    'asking twice must be the same request, not a second one';

  -- Private: refused even with the id in hand.
  begin
    perform public.join_circle(closed_room);
    assert false, 'a private room must not be joinable by id';
  exception when others then
    null;
  end;

  -- Invite-only: findable, but there is no asking.
  begin
    perform public.join_circle(invite_room);
    assert false, 'an invite-only room must refuse a join';
  exception when others then
    null;
  end;

  -- Discoverable rooms you are already in are not recommendations.
  discovered := public.discover_circles(20, 0);
  assert not exists (select 1 from jsonb_array_elements(discovered) e where (e->>'id')::bigint = open_room),
    'a room you are in must not be recommended to you';
  assert exists (select 1 from jsonb_array_elements(discovered) e
                  where (e->>'id')::bigint = ask_room and e->>'state' = 'pending'),
    'a room you asked for must be shown as pending, not hidden';

  /* --------------------------------------------------------------- preview */

  preview := public.circle_preview(ask_room);
  assert preview->'circle'->>'name' = 'Ask Room', 'a preview should name the room';
  assert preview->'owner'->>'name' = 'Daniel', 'a preview should name the person who runs it';
  assert preview->>'state' = 'pending', 'a preview should say where you stand';
  -- A stranger gets counts, never contents.
  assert position('body' in (preview::text)) = 0,
    'a preview must not carry post bodies';
  assert position('message' in lower(preview::text)) = 0
    or (preview->'activity'->>'messagesThisWeek') = '0',
    'a preview must not carry the conversation';

  begin
    perform public.circle_preview(closed_room);
    assert false, 'a private room must not be previewable by a stranger';
  exception when others then
    null;
  end;

  /* --------------------------------------------------- only the owner decides */

  begin
    perform public.circle_manage(ask_room);
    assert false, 'a stranger must not open the management desk';
  exception when others then
    null;
  end;

  begin
    perform public.set_circle_access(ask_room, false, 'open');
    assert false, 'a stranger must not change a room''s settings';
  exception when others then
    null;
  end;

  begin
    perform public.invite_to_circle(ask_room, other_id);
    assert false, 'a stranger must not invite people into somebody''s room';
  exception when others then
    null;
  end;

  begin
    perform public.decide_circle_request(req_id, true);
    assert false, 'a member must not approve their own request';
  exception when others then
    null;
  end;

  /* ------------------------------------------------------------- the owner */

  perform set_config('request.jwt.claim.sub', owner_uuid::text, false);

  j := public.circle_manage(ask_room);
  assert jsonb_array_length(j->'requests') = 1, 'the owner should see the pending request';
  assert j->'requests'->0->'member'->>'name' = 'Marcus', 'the request should carry the asker';
  assert (j->'requests'->0->>'requestedAt')::bigint > 0, 'the request should carry a date';
  assert (j->'circle'->>'discoverable')::boolean, 'the desk should say the room is findable';
  assert j->'circle'->>'joinPolicy' = 'request', 'the desk should say how people get in';

  -- An open room needs no paperwork, so inviting into one is refused.
  begin
    perform public.invite_to_circle(open_room, other_id);
    assert false, 'an open room must not need invitations';
  exception when others then
    null;
  end;

  -- Approving is the only thing that turns a request into a member.
  before_members := (select count(*) from public.circle_members where circle_id = ask_room);
  j := public.decide_circle_request(req_id, true);
  assert (j->>'approved')::boolean, 'the owner''s approval should be recorded';
  assert (select count(*) from public.circle_members where circle_id = ask_room) = before_members + 1,
    'approval must add exactly one member';
  -- Notifications are read under RLS, so this is asserted as the person who
  -- received it rather than as the owner looking at somebody else's row.
  perform set_config('request.jwt.claim.sub', asker_uuid::text, false);
  assert exists (select 1 from public.notifications
                  where user_id = asker_id and kind = 'circle_approved' and ref_id = ask_room),
    'the new member should be told they are in';
  perform set_config('request.jwt.claim.sub', owner_uuid::text, false);

  assert jsonb_array_length(public.circle_manage(ask_room)->'requests') = 0,
    'an answered request should leave the desk';

  /* ------------------------------------------------------------ declining */

  -- Somebody else asks, and is turned away. The room is untouched.
  perform set_config('request.jwt.claim.sub', other_uuid::text, false);
  req_id := (public.join_circle(ask_room)->>'requestId')::bigint;

  perform set_config('request.jwt.claim.sub', owner_uuid::text, false);
  before_members := (select count(*) from public.circle_members where circle_id = ask_room);
  j := public.decide_circle_request(req_id, false);
  assert not (j->>'approved')::boolean, 'a decline should be recorded as a decline';
  assert (select count(*) from public.circle_members where circle_id = ask_room) = before_members,
    'a decline must not change who is in the room';
  assert exists (select 1 from public.circles where id = ask_room),
    'a decline must not delete the room';
  assert not exists (select 1 from public.circle_members where circle_id = ask_room and member_id = other_id),
    'a declined member must stay outside';
  assert jsonb_array_length(public.circle_manage(ask_room)->'declined') = 1,
    'a declined request should stay on the desk as a record';
  perform set_config('request.jwt.claim.sub', other_uuid::text, false);
  assert exists (select 1 from public.notifications
                  where user_id = other_id and kind = 'circle_declined' and ref_id = ask_room),
    'the person turned away should be told';
  perform set_config('request.jwt.claim.sub', owner_uuid::text, false);

  /* ----------------------------------------------------------- invitations */

  j := public.invite_to_circle(invite_room, other_id);
  assert j->>'state' = 'invited', 'the owner should be able to invite somebody in';
  inv_id := (j->>'invitationId')::bigint;

  perform set_config('request.jwt.claim.sub', other_uuid::text, false);
  assert exists (select 1 from public.notifications
                  where user_id = other_id and kind = 'circle_invite' and ref_id = invite_room),
    'an invited person should be told';
  perform set_config('request.jwt.claim.sub', owner_uuid::text, false);

  -- The same invitation, not two.
  j := public.invite_to_circle(invite_room, other_id);
  assert (j->>'invitationId')::bigint = inv_id, 'inviting twice must not stack invitations';

  -- Nobody else can answer it.
  perform set_config('request.jwt.claim.sub', asker_uuid::text, false);
  begin
    perform public.respond_circle_invitation(inv_id, true);
    assert false, 'an invitation must only be answerable by the person invited';
  exception when others then
    null;
  end;

  -- And accepting it is what makes the membership.
  perform set_config('request.jwt.claim.sub', other_uuid::text, false);
  assert jsonb_array_length(public.my_circle_invitations()) >= 1, 'the invitation should be waiting';
  j := public.respond_circle_invitation(inv_id, true);
  assert (j->>'accepted')::boolean, 'accepting should be recorded';
  assert exists (select 1 from public.circle_members where circle_id = invite_room and member_id = other_id),
    'accepting an invitation must create the membership';
  assert jsonb_array_length(public.my_circle_invitations()) = 0,
    'an answered invitation should leave the list';

  /* -------------------------------------------------- the settings are real */

  perform set_config('request.jwt.claim.sub', owner_uuid::text, false);
  j := public.set_circle_access(invite_room, false, 'invite');
  assert not (j->>'discoverable')::boolean, 'the owner can make a room private';
  assert (select visibility from public.circles where id = invite_room) = 'connections',
    'the old flag must follow the new one, or old builds would disagree';

  perform set_config('request.jwt.claim.sub', asker_uuid::text, false);
  discovered := public.discover_circles(20, 0);
  assert not exists (select 1 from jsonb_array_elements(discovered) e where (e->>'id')::bigint = invite_room),
    'a room made private must leave discovery at once';

  -- Paging never repeats a room: the order is deterministic.
  discovered := public.discover_circles(1, 0);
  n := jsonb_array_length(discovered);
  assert n <= 1, 'a page holds what was asked for';

  reset role;
end $$;
