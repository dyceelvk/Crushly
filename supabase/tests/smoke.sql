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
  call_channel text;
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

  call_channel := public.register_call_room(conv_id);
  assert call_channel ~ '^call-[a-f0-9]{32}$', 'server-generated call token';
  assert public.can_join_call(call_channel), 'caller can join';
  perform set_config('realtime.topic', call_channel, false);
  insert into realtime.messages(extension, payload) values ('broadcast', '{}');
  assert (select count(*) from realtime.messages) = 1, 'caller broadcast RLS';
  perform set_config('request.jwt.claim.sub', marcus::text, false);
  assert public.can_join_call(call_channel), 'callee can join';
  assert (select count(*) from realtime.messages) = 1, 'callee broadcast RLS';
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', false);
  assert not public.can_join_call(call_channel), 'outsider cannot join even knowing token';
  assert (select count(*) from realtime.messages) = 0, 'outsider broadcast read denied';
  begin
    insert into realtime.messages(extension, payload) values ('broadcast', '{}');
    raise exception 'outsider broadcast should fail';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub', daniel::text, false);
  j := public.send_message(conv_id, 'call'::text, ''::text, null::text, jsonb_build_object('channel', call_channel));
  assert j ->> 'kind' = 'call' and j ->> 'body' = 'Voice call' and (j -> 'meta' ->> 'channel') = call_channel,
    'call request message carries its channel';
  perform public.end_call_room(call_channel);
  assert not public.can_join_call(call_channel), 'ended calls cannot be joined again';

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

  -- ------------------------------------------------- verification transitions
  reset role;
  update public.profiles set verification = 'none' where id = me;
  set role authenticated;
  begin
    insert into public.verification_requests (user_id, didit_session_id) values (me, 'forged');
    raise exception 'members must not create verification requests';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set verification = 'pending' where id = me;
    raise exception 'a member click must not set pending';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set verification = 'verified' where id = me;
    raise exception 'members must not forge badges';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.record_didit_session(me, 'forged', 'https://example.com');
    raise exception 'members must not invoke service-only session creation';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.apply_didit_status('forged', 'Approved');
    raise exception 'members must not invoke service-only settlement';
  exception when insufficient_privilege then null;
  end;

  reset role;
  update public.profiles set verification = 'none' where id = me;
  perform public.record_didit_session(me, 'ses_old', 'https://example.com/old');
  perform public.record_didit_session(me, 'ses_current', 'https://example.com/current');
  assert (select verification from public.profiles where id = me) = 'none',
    'creating a session must NOT mean in review';
  assert (select status from public.verification_requests where didit_session_id = 'ses_old') = 'superseded';
  perform public.apply_didit_status('ses_old', 'Approved', null, 'evt_old');
  assert (select verification from public.profiles where id = me) = 'none', 'old session must not settle the badge';
  perform public.apply_didit_status('ses_current', 'Not Started', null, 'evt_not_started');
  assert (select verification from public.profiles where id = me) = 'none', 'Not Started must stay unsubmitted';
  perform public.apply_didit_status('ses_current', 'In Progress', null, 'evt_progress');
  assert (select verification from public.profiles where id = me) = 'pending';
  perform public.apply_didit_status('ses_current', 'In Review', null, 'evt_review');
  perform public.apply_didit_status('ses_current', 'Not Started', null, 'evt_late');
  assert (select didit_status from public.verification_requests where didit_session_id = 'ses_current') = 'In Review',
    'late Not Started cannot undo submitted checks';
  perform public.apply_didit_status('ses_current', 'Approved', '{"id_verifications": []}', 'evt_approved');
  perform public.apply_didit_status('ses_current', 'Approved', null, 'evt_approved');
  perform public.apply_didit_status('ses_current', 'In Progress', null, 'evt_late_progress');
  assert (select verification from public.profiles where id = me) = 'verified', 'late progress cannot revoke a badge';
  assert (select count(*) from public.didit_events where event_id = 'evt_approved') = 1, 'webhooks dedupe';
  begin
    perform public.apply_didit_status('missing_session', 'In Review', null, 'evt_retry');
    raise exception 'unknown session must retry';
  exception when no_data_found then null;
  end;
  assert not exists (select 1 from public.didit_events where event_id = 'evt_retry'), 'failed writes leave events retryable';
  update public.profiles set verification = 'none' where id = me;
  perform public.record_didit_session(me, 'ses_expired', 'https://example.com/expired');
  perform public.apply_didit_status('ses_expired', 'In Progress');
  perform public.apply_didit_status('ses_expired', 'Expired');
  assert (select verification from public.profiles where id = me) = 'none', 'expiry is not review';

  perform public.record_didit_session(me, 'ses_retry', 'https://example.com/retry');
  assert (select verification from public.profiles where id = me) = 'none';

  set role authenticated;
  begin
    insert into public.profiles (auth_user_id, email, verification) values (daniel, 'forged@example.com', 'verified');
    raise exception 'members must not insert profiles with a forged badge';
  exception when insufficient_privilege then null;
  end;
  assert (select count(*) from public.verification_requests where user_id <> me) = 0, 'other members cannot read session links';
  assert (select didit_session_url from public.verification_requests where didit_session_id = 'ses_current') = 'https://example.com/current', 'own session link is saved';
  begin
    update public.verification_requests set status = 'approved' where user_id = me;
    raise exception 'members must not approve verification';
  exception when insufficient_privilege then null;
  end;
  assert (select count(*) from public.didit_events) = 0, 'dedupe events hidden from members';

  -- ------------------------------------------------------------ account ops
  begin
    perform public.delete_account('wrong-password');
    raise exception 'delete_account accepted a wrong password';
  exception when others then
    if sqlerrm like '%accepted a wrong password%' then raise; end if;
  end;

  -- ---------------------------------------------------------- moment expiry
  -- "Gone after 24 hours" has to mean the row AND the photo, not just a filter.
  reset role;

  insert into storage.objects (bucket_id, name) values ('media', 'moments/999/old.jpg');
  insert into public.moments (user_id, kind, body, media_url, style, audience, created_at, expires_at)
    values (me, 'photo', 'yesterday', 'moments/999/old.jpg', 'noir', 'everyone',
            public.now_ms() - 48 * 3600 * 1000, public.now_ms() - 24 * 3600 * 1000)
    returning id into moment_id;
  -- A Moment that has not expired must survive the sweep untouched.
  insert into public.moments (user_id, kind, body, style, audience, created_at, expires_at)
    values (me, 'text', 'still here', 'noir', 'everyone', public.now_ms(), public.now_ms() + 3600 * 1000);

  assert public.cleanup_expired_moments(500) >= 1, 'expired moments are swept';
  assert not exists (select 1 from public.moments where id = moment_id), 'expired moment row is deleted';
  assert not exists (
    select 1 from storage.objects where bucket_id = 'media' and name = 'moments/999/old.jpg'
  ), 'the photo behind an expired moment is deleted too';
  assert exists (
    select 1 from public.media_cleanup_log where media_path = 'moments/999/old.jpg' and ok
  ), 'file deletions are logged';
  assert exists (select 1 from public.moments where body = 'still here'), 'live moments are never swept';

  -- Files in the external object store are deleted by the bucket's own
  -- lifecycle rule — the sweep removes the row and leaves the file to it.
  insert into public.moments (user_id, kind, body, media_url, style, audience, created_at, expires_at)
    values (me, 'photo', 'external', 'https://media.example.com/moments/999/x.jpg', 'noir', 'everyone',
            public.now_ms() - 48 * 3600 * 1000, public.now_ms() - 24 * 3600 * 1000);
  perform public.cleanup_expired_moments(500);
  assert not exists (select 1 from public.moments where body = 'external'), 'external media rows still expire';
  assert not exists (
    select 1 from public.media_cleanup_log where media_path like 'https://%'
  ), 'external files are left to the bucket lifecycle rule';

  -- ------------------------------------------------------------ media access
  -- Files live in a private bucket now; the Worker asks the database who may
  -- see what, so these functions are the only place that decides.
  j := public.media_upload_ticket('moments', 'image/jpeg', 100000);
  assert j ->> 'path' like 'moments/' || me || '/%', 'upload path is server-chosen, inside the caller’s own folder';
  assert (j ->> 'maxBytes')::int = 8 * 1024 * 1024, 'photos are capped at 8MB';
  begin
    perform public.media_upload_ticket('secrets', 'image/jpeg', 100);
    raise exception 'unknown kinds must be refused';
  exception when others then
    if sqlerrm like '%unknown kinds must be refused%' then raise; end if;
  end;
  begin
    perform public.media_upload_ticket('moments', 'application/pdf', 100);
    raise exception 'unsupported file types must be refused';
  exception when others then
    if sqlerrm like '%unsupported file types must be refused%' then raise; end if;
  end;
  begin
    perform public.media_upload_ticket('moments', 'image/jpeg', 9 * 1024 * 1024);
    raise exception 'oversized files must be refused';
  exception when others then
    if sqlerrm like '%oversized files must be refused%' then raise; end if;
  end;

  j := public.can_view_media('photos/1/a.jpg');
  assert (j ->> 'allowed')::bool and (j ->> 'cacheable')::bool, 'profile photos are readable by members and cacheable';

  insert into public.messages (conversation_id, sender_id, kind, media_url)
    values (conv_id, me, 'photo', 'messages/999/note.jpg');
  j := public.can_view_media('messages/999/note.jpg');
  assert (j ->> 'allowed')::bool, 'you can read your own chat media';
  assert not (j ->> 'cacheable')::bool, 'chat media is never cached under a shared key';
  perform set_config('request.jwt.claim.sub', marcus::text, false);
  assert (public.can_view_media('messages/999/note.jpg') ->> 'allowed')::bool, 'the other person in the chat can read it too';
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', false);
  assert not (public.can_view_media('messages/999/note.jpg') ->> 'allowed')::bool, 'outsiders get nothing from chat media';
  assert not (public.can_view_media('photos/1/a.jpg') ->> 'allowed')::bool, 'signed-out callers get nothing at all';
  perform set_config('request.jwt.claim.sub', daniel::text, false);

  insert into public.moments (user_id, kind, body, media_url, style, audience, created_at, expires_at)
    values (me, 'photo', 'connections only', 'moments/' || me || '/live.jpg', 'noir', 'connections',
            public.now_ms(), public.now_ms() + 3600 * 1000),
           (me, 'photo', 'gone', 'moments/' || me || '/expired.jpg', 'noir', 'everyone',
            public.now_ms() - 48 * 3600 * 1000, public.now_ms() - 24 * 3600 * 1000);
  assert (public.can_view_media('moments/' || me || '/live.jpg') ->> 'allowed')::bool, 'a live moment is readable';
  assert not (public.can_view_media('moments/' || me || '/live.jpg') ->> 'cacheable')::bool,
    'connections-only moments are not cacheable';
  assert not (public.can_view_media('moments/' || me || '/expired.jpg') ->> 'allowed')::bool,
    'an expired moment is not readable, not even by its author';
  assert not (public.can_view_media('moments/' || me || '/nothing.jpg') ->> 'allowed')::bool, 'unknown files are not readable';

  assert public.can_manage_media('moments/' || me || '/live.jpg'), 'authors can delete their own media';
  assert not public.can_manage_media('moments/777/live.jpg'), 'nobody else can delete it';
  assert public.can_manage_media('moments/' || me || '/orphan.jpg'), 'orphans in your own folder can be cleared';
  -- Your own folder plus somebody else's file URL must not open their file.
  perform set_config('request.jwt.claim.sub', marcus::text, false);
  assert not public.can_manage_media(
    'moments/' || marcus_id || '/x.jpg', 'https://media.example.com/moments/' || me || '/live.jpg'
  ), 'your own folder plus someone else’s file URL grants nothing';
  perform set_config('request.jwt.claim.sub', daniel::text, false);

  -- Runaway-upload guard: storage beyond the free allowance is billed, so the
  -- ceiling is enforced here rather than in the app.
  select (select count(*) from photos where user_id = me and created_at > public.now_ms() - 3600 * 1000)
       + (select count(*) from moments where user_id = me and created_at > public.now_ms() - 3600 * 1000)
       + (select count(*) from messages where sender_id = me and created_at > public.now_ms() - 3600 * 1000)
    into n;
  insert into public.moments (user_id, kind, body, style, audience, created_at, expires_at)
    select me, 'text', 'flood', 'noir', 'everyone', public.now_ms(), public.now_ms() + 3600 * 1000
      from generate_series(1, greatest(40 - n, 1));
  begin
    perform public.media_upload_ticket('moments', 'image/jpeg', 1000);
    raise exception 'the hourly upload ceiling must hold';
  exception when others then
    if sqlerrm like '%hourly upload ceiling must hold%' then raise; end if;
  end;

  delete from public.moments where body in ('connections only', 'gone', 'flood');
  delete from public.messages where media_url = 'messages/999/note.jpg';

  reset role;
  raise notice 'smoke tests passed';
end $$;
