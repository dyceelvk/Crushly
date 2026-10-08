-- Smoke tests for the Crushly Supabase RPCs, run as the `authenticated` role
-- with a simulated JWT (auth.uid() reads request.jwt.claim.sub).
do $$
declare
  daniel uuid;
  marcus uuid;
  me bigint;
  marcus_id bigint;
  jayden_id bigint;
  tobi_id bigint;
  moment_id bigint;
  j jsonb;
  n int;
  conv_id bigint;
  msg_id bigint;
  verif_id bigint;
begin
  -- IDs resolved as the migration owner (RLS hides others' rows from members).
  select id into daniel from auth.users where email = 'daniel@crushly.app';
  select id into marcus from auth.users where email = 'marcus@crushly.app';
  select id into marcus_id from profiles where name = 'Marcus';
  select id into jayden_id from profiles where name = 'Jayden';
  select id into tobi_id from profiles where name = 'Tobi';
  select id into moment_id from moments where user_id <> (select id from profiles where name = 'Daniel')
    and expires_at > public.now_ms() limit 1;

  perform set_config('request.jwt.claim.sub', daniel::text, false);
  set role authenticated;

  -- ---------------------------------------------------------------- identity
  me := public.me_id();
  assert me is not null, 'me_id() should resolve for the signed-in user';

  -- ------------------------------------------------------- profile privacy
  assert (select count(*) from profiles where id <> me) = 0,
    'RLS must hide other members'' profile rows';
  assert (select count(*) from profiles where id = me) = 1,
    'RLS must expose my own profile row';

  j := public.load_profile(marcus_id);
  assert j is not null, 'Marcus should be visible';
  assert j ? 'age' and not (j ? 'birthdate'), 'public profile must not include birthdate';
  assert not (j ? 'lat') and not (j ? 'lng'), 'public profile must not include coordinates';
  assert j ->> 'name' = 'Marcus', 'name should come through';
  assert (j -> 'crush' ->> 'received')::boolean, 'Marcus is crushing on daniel';
  assert (j ->> 'distance') is not null, 'distance label should be present';

  -- ------------------------------------------------------------- discovery
  j := public.discover_feed(30, 0);
  assert j ? 'items' and j ? 'total' and j ? 'viewerHasLocation', 'discover shape';
  assert (j ->> 'total')::int > 0, 'discover should have candidates';
  assert not exists (
    select 1 from jsonb_array_elements(j -> 'items') it where it ->> 'name' = 'Luca'
  ), 'Luca must not appear (daniel already crushed him)';
  assert not exists (
    select 1 from jsonb_array_elements(j -> 'items') it where it ->> 'name' = 'Ryan'
  ), 'Ryan must not appear (connected)';
  -- Kelechi is crushing daniel but not yet decided on: he appears, gently boosted.
  assert exists (
    select 1 from jsonb_array_elements(j -> 'items') it where it ->> 'name' = 'Kelechi'
  ), 'Kelechi should appear (crushing me, unresolved)';

  -- ----------------------------------------------------------- crush → mutual
  j := public.crush_member(marcus_id, false, null);
  assert (j ->> 'mutual')::boolean, 'crushing Marcus back should create a Mutual Crush';
  assert (j ->> 'isNew')::boolean, 'and it is new';
  assert (public.load_profile(marcus_id) -> 'crush' ->> 'mutual')::boolean,
    'connection row should exist';

  -- ----------------------------------------------------------- conversations
  j := public.open_conversation(marcus_id);
  conv_id := (j ->> 'id')::bigint;

  j := public.list_conversations();
  assert jsonb_array_length(j -> 'items') >= 1, 'Marcus conversation should be listed';
  assert (j -> 'items' -> 0 ->> 'id') = conv_id::text,
    'freshly opened conversation sorts first';

  j := public.load_conversation(conv_id);
  assert j ->> 'peer' is not null, 'conversation detail needs a peer';
  assert (j ->> 'canSend')::boolean, 'connected members can message';

  j := public.send_message(conv_id, 'text'::text, 'Hey Marcus — great taste in vinyl.'::text, null::text, '{}'::jsonb);
  assert (j ->> 'mine')::boolean, 'sent message is mine';
  msg_id := (j ->> 'id')::bigint;

  j := public.send_message(conv_id, 'sticker'::text, ''::text, null::text, '{"sticker":"wave"}'::jsonb);
  assert j ->> 'kind' = 'sticker', 'sticker message';

  j := public.send_message(conv_id, 'profile'::text, ''::text, null::text, format('{"profileId":%s}', jayden_id)::jsonb);
  assert j ->> 'kind' = 'profile' and (j -> 'meta' ->> 'profileId') = jayden_id::text,
    'profile share message';

  -- Video notes and call requests are first-class message kinds.
  j := public.send_message(conv_id, 'video'::text, ''::text, 'media/messages/demo/note.mp4'::text, '{"duration":12}'::jsonb);
  assert j ->> 'kind' = 'video' and (j -> 'meta' ->> 'duration') = '12', 'video note message';

  begin
    perform public.send_message(conv_id, 'video'::text, ''::text, null::text, '{}'::jsonb);
    raise exception 'video note without media should fail';
  exception when others then
    if sqlerrm like '%without media should fail%' then raise; end if;
  end;

  j := public.send_message(conv_id, 'call'::text, ''::text, null::text, '{"channel":"call-test-123"}'::jsonb);
  assert j ->> 'kind' = 'call' and j ->> 'body' = 'Voice call' and (j -> 'meta' ->> 'channel') = 'call-test-123',
    'call request message carries its channel';

  begin
    perform public.send_message(conv_id, 'call'::text, ''::text, null::text, '{}'::jsonb);
    raise exception 'call request without channel should fail';
  exception when others then
    if sqlerrm like '%without channel should fail%' then raise; end if;
  end;

  j := public.toggle_message_reaction(msg_id, 'crush');
  assert jsonb_array_length(j -> 'reactions') = 1, 'crush reaction recorded';

  -- Reading as the other side marks messages read.
  perform set_config('request.jwt.claim.sub', marcus::text, false);
  set role authenticated;
  perform public.mark_conversation_read(conv_id);
  j := public.get_messages(conv_id, 0, 0, 40);
  assert jsonb_array_length(j -> 'items') = 5, 'Marcus sees the five messages (text, sticker, profile, video, call)';
  perform set_config('request.jwt.claim.sub', daniel::text, false);
  j := public.get_messages(conv_id, 0, 0, 40);
  assert (j ->> 'lastReadMine') is not null and (j ->> 'lastReadMine')::bigint >= msg_id,
    'read receipts should flow back to daniel';

  -- ------------------------------------------------------------------ badges
  j := public.badges();
  assert j ? 'notifications' and j ? 'messages' and j ? 'crushes' and j ? 'latestNotification', 'badges shape';

  -- ------------------------------------------------------------- crushes hub
  j := public.crushes_feed();
  assert jsonb_array_length(j -> 'incoming') >= 1, 'Kelechi/Tobi/Jayden are crushing on daniel';
  assert jsonb_array_length(j -> 'mutual') >= 3, 'Ryan, Ade, Marcus are mutual';
  assert j -> 'incoming' -> 0 ? 'at', 'incoming entries carry the crush time';

  -- ----------------------------------------------------------------- moments
  n := 0;
  for j in select * from public.visible_moments() loop
    assert j ? 'author', 'moments include author cards';
    n := n + 1;
  end loop;
  assert n > 0, 'demo moments should be visible';

  j := public.react_to_moment(moment_id, 'fire');
  assert (j ->> 'myReaction') = 'fire', 'moment reaction recorded';

  -- photo moments carry a caption (shown on the card and in the viewer)
  j := public.create_moment('photo', 'Golden hour with Marcus', 'media/moments/demo/1.jpg', 'champagne', 'everyone');
  assert j ->> 'kind' = 'photo', 'photo moment created';
  assert j ->> 'body' = 'Golden hour with Marcus', 'photo moment keeps its caption';
  assert j ->> 'mediaUrl' = 'media/moments/demo/1.jpg', 'photo moment keeps its media path';

  j := public.create_moment('photo', repeat('a', 300), 'media/moments/demo/2.jpg', 'noir', 'everyone');
  assert length(j ->> 'body') = 200, 'photo captions are capped at 200 characters';

  begin
    perform public.create_moment('text', '   ', null, 'noir', 'everyone');
    raise exception 'text moment without words should fail';
  exception when others then
    if sqlerrm like '%without words should fail%' then raise; end if;
  end;

  assert exists (
    select 1 from public.visible_moments() vm
    where vm ->> 'body' = 'Golden hour with Marcus' and vm ->> 'kind' = 'photo'
  ), 'photo moment with caption shows up in the feed';

  -- ----------------------------------------------------------- notifications
  select count(*) into n from public.list_notifications();
  assert n > 0, 'demo notifications should exist';

  -- -------------------------------------------------------- messaging rules
  assert public.load_profile(jayden_id) ->> 'messageBlockReason' is not null,
    'messaging strangers is blocked by default';
  begin
    perform public.open_conversation(jayden_id);
    raise exception 'open_conversation should have been refused';
  exception when others then
    if sqlerrm like '%should have been refused%' then raise; end if;
  end;

  -- --------------------------------------------------------------- block flow
  perform public.block_member(tobi_id);
  assert public.load_profile(tobi_id) is null, 'blocked members disappear';
  perform public.unblock_member(tobi_id);
  assert public.load_profile(tobi_id) is not null, 'unblock brings them back';

  -- ------------------------------------------------- verification request flow
  insert into public.verification_requests (user_id, selfie_path, pose, selfies)
  values (me, 'verification/selfies/demo/1.jpg', 'Peace sign & smile + Wink & wave', '["verification/selfies/demo/2.jpg"]'::jsonb)
  returning id into verif_id;
  assert (select selfies from public.verification_requests where id = verif_id) = '["verification/selfies/demo/2.jpg"]'::jsonb,
    'extra pose selfies are stored';
  assert (select count(*) from public.verification_requests where user_id <> me) = 0,
    'RLS hides other members'' verification requests';

  begin
    insert into public.verification_requests (user_id, selfie_path, pose, status)
    values (me, 'verification/selfies/demo/x.jpg', 'Thumbs up', 'bogus');
    raise exception 'bogus verification status should fail';
  exception when others then
    if sqlerrm like '%bogus verification status should fail%' then raise; end if;
  end;

  update public.verification_requests set status = 'superseded' where user_id = me and status = 'pending';
  assert (select count(*) from public.verification_requests where user_id = me and status = 'pending') = 0,
    'old pending requests can be superseded before a new submission';

  update public.profiles set verification = 'pending' where id = me;
  assert (select verification from public.profiles where id = me) = 'pending',
    'profile verification flag moves to pending';

  -- AI verdict columns (verification_ai migration) round-trip for the owner
  update public.verification_requests
    set ai_verdict = '{"real_person": true, "pose_ok": true, "same_person": true, "confidence": 0.9, "reason": "ok"}'::jsonb,
        ai_reviewed_at = public.now_ms()
    where id = verif_id;
  assert (select ai_verdict ->> 'confidence' from public.verification_requests where id = verif_id) = '0.9',
    'AI verdict is stored and readable by its owner';

  -- ---------------------------------------------------------- didit surface
  -- Didit requests reuse verification_requests and carry no selfies.
  insert into public.verification_requests (user_id, didit_session_id, didit_status)
  values (me, 'ses_smoke_1', 'In Review')
  returning id into verif_id;
  assert (select selfie_path from public.verification_requests where id = verif_id) is null,
    'Didit requests carry no selfie';
  assert (select didit_status from public.verification_requests where id = verif_id) = 'In Review',
    'raw Didit status is stored';

  -- Webhook idempotency table is service-role only (RLS hides it from members).
  assert (select count(*) from public.didit_events) = 0,
    'didit_events is hidden from members by RLS';
  begin
    insert into public.didit_events (event_id) values ('evt_smoke_1');
    raise exception 'members must not write didit_events';
  exception when others then
    if sqlerrm like '%must not write didit_events%' then raise; end if;
  end;

  update public.verification_requests
    set status = 'approved', didit_status = 'Approved', decision = '{"id_verifications": []}'::jsonb
    where id = verif_id;
  assert (select status from public.verification_requests where id = verif_id) = 'approved',
    'Didit approval maps to the approved request status';
  assert (select decision ->> 'id_verifications' from public.verification_requests where id = verif_id) = '[]',
    'Didit decision payload round-trips';

  -- ------------------------------------------------------------ account ops
  begin
    perform public.delete_account('wrong-password');
    raise exception 'delete_account accepted a wrong password';
  exception when others then
    if sqlerrm like '%accepted a wrong password%' then raise; end if;
  end;

  reset role;
  raise notice 'smoke tests passed';
end $$;
