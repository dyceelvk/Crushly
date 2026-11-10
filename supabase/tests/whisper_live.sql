-- Whisper, live (1.0.68): delivery, the private channel, and what presence is
-- allowed to say.
--
-- What this proves:
--   1. A message can be marked delivered by the recipient, exactly once.
--   2. Delivery is the sender's information; reading implies having.
--   3. Read receipts still obey both members' switches, and delivery does not
--      depend on them — arrival is transport, not consent.
--   4. The whisper topic is authorisable: members in, outsiders out, closed
--      threads out, junk topics out, and the RLS policy says the same.
--   5. `show_activity` gates the timestamp without hiding the dot.
do $$
declare
  daniel uuid := (select auth_user_id from public.profiles where name = 'Daniel');
  marcus uuid := (select auth_user_id from public.profiles where name = 'Ryan');
  jayden uuid := (select auth_user_id from public.profiles where name = 'Jayden');
  daniel_id bigint := (select id from public.profiles where name = 'Daniel');
  marcus_id bigint := (select id from public.profiles where name = 'Ryan');
  jayden_id bigint := (select id from public.profiles where name = 'Jayden');
  conv_id bigint;
  sent jsonb;
  msg_id bigint;
  res jsonb;
  mine jsonb;
  theirs jsonb;
  stamp bigint;
  presence jsonb;
  added_connection boolean := false;
begin
  /*
   * Earlier suites in the same run disconnect and reconnect various pairs, so
   * this test does not assume the seed still holds the one thing a Whisper
   * needs: a connection. It makes the pair, and puts the tree back afterwards.
   */
  if not public.is_connected_pair(daniel_id, marcus_id) then
    insert into public.connections (user_a, user_b)
      values (least(daniel_id, marcus_id), greatest(daniel_id, marcus_id))
      on conflict do nothing;
    added_connection := true;
  end if;
  -- Daniel and Ryan are connected in the seed (a Whisper needs a connection to
  -- exist at all), so they are the pair with a thread.
  perform set_config('request.jwt.claim.sub', daniel::text, false);
  conv_id := (public.open_conversation(marcus_id) ->> 'id')::bigint;
  -- A Whisper needs an answer, not just a connection. This suite is about
  -- delivery stamps and receipts, so the answer is stated here instead of being assumed
  -- from the old "connections may always message" rule.
  if to_regclass('public.holup_whisper_permissions') is not null then
    insert into public.holup_whisper_permissions(conversation_id, requester_id, recipient_id, state, decided_at)
      values (conv_id, least(daniel_id, marcus_id), greatest(daniel_id, marcus_id), 'accepted', public.now_ms())
      on conflict (conversation_id) do update set state = 'accepted', decided_at = public.now_ms();
  end if;
    sent := public.send_message(conv_id, 'text', 'delivery, please', null, '{}'::jsonb);
  msg_id := (sent ->> 'id')::bigint;

  -- ------------------------------------------------ 1 · delivered, once
  perform set_config('request.jwt.claim.sub', marcus::text, false);
  res := public.mark_messages_delivered(conv_id, null);
  assert (res ->> 'count')::int >= 1, 'the recipient marks what it did not have';
  assert (res ->> 'upTo')::bigint = msg_id, 'and reports the highest id it stamped';

  select delivered_at into stamp from public.messages where id = msg_id;
  assert stamp is not null, 'delivered_at must be written';

  -- A second acknowledgement is a no-op, not a rewrite: the first arrival is
  -- the only arrival anybody can honestly report.
  perform pg_sleep(0.01);
  res := public.mark_messages_delivered(conv_id, msg_id);
  assert (res ->> 'count')::int = 0, 'a repeat delivery stamps nothing';
  assert (select delivered_at from public.messages where id = msg_id) = stamp,
    'and must not move the time it actually arrived';

  -- The sender sees it; the recipient is not told about their own phone.
  perform set_config('request.jwt.claim.sub', daniel::text, false);
  mine := public.get_messages(conv_id, 0, 0, 40);
  assert (select count(*) from jsonb_array_elements(mine -> 'items') it
           where (it ->> 'id')::bigint = msg_id and (it ->> 'deliveredAt')::bigint = stamp) = 1,
    'the sender sees when their message landed';
  perform set_config('request.jwt.claim.sub', marcus::text, false);
  theirs := public.get_messages(conv_id, 0, 0, 100);
  assert (select count(*) from jsonb_array_elements(theirs -> 'items') it
           where (it ->> 'id')::bigint = msg_id and it -> 'deliveredAt' = 'null'::jsonb) = 1,
    'delivery is the sender''s information, not the recipient''s';

  -- --------------------------------------------- 2 · reading implies having
  perform set_config('request.jwt.claim.sub', daniel::text, false);
  perform public.send_message(conv_id, 'text', 'and this one', null, '{}'::jsonb);
  perform set_config('request.jwt.claim.sub', marcus::text, false);
  assert (select delivered_at from public.messages where conversation_id = conv_id
           order by id desc limit 1) is null, 'a new message starts undelivered';
  perform public.mark_conversation_read(conv_id);
  assert (select delivered_at from public.messages where conversation_id = conv_id
           order by id desc limit 1) is not null,
    'marking read fills the delivery stamp in the same pass';

  -- --------------------------------------------- 3 · receipts, not delivery
  update public.privacy set read_receipts = false where user_id = marcus_id;
  perform set_config('request.jwt.claim.sub', daniel::text, false);
  mine := public.get_messages(conv_id, 0, 0, 100);
  assert (select count(*) from jsonb_array_elements(mine -> 'items') it
           where it ->> 'mine' = 'true' and it -> 'readAt' <> 'null'::jsonb) = 0,
    'with their receipts off, the sender is told nothing about reading';
  assert (mine -> 'lastReadMine') = 'null'::jsonb, 'and no read watermark either';
  assert (select count(*) from jsonb_array_elements(mine -> 'items') it
           where it ->> 'mine' = 'true' and it -> 'deliveredAt' <> 'null'::jsonb) > 0,
    'but arrival is still arrival — delivery is not a receipt';
  assert (public.peer_presence(conv_id) ->> 'receipts')::boolean = false,
    'presence says receipts are off, so the channel must not broadcast reads';
  update public.privacy set read_receipts = true where user_id = marcus_id;
  assert (public.peer_presence(conv_id) ->> 'receipts')::boolean = true,
    'and says so again when they are back on';

  -- ------------------------------------------------- 4 · the whisper topic
  assert public.whisper_topic_conversation('whisper:' || conv_id) = conv_id, 'the topic names its conversation';
  assert public.whisper_topic_conversation('call-abc') is null, 'a call topic is not a whisper topic';
  assert public.whisper_topic_conversation('whisper:') is null, 'a bare prefix names nothing';
  assert public.whisper_topic_conversation('whisper:12; drop table messages') is null, 'junk is not a conversation';

  assert public.can_join_whisper('whisper:' || conv_id), 'a member may listen';
  perform set_config('request.jwt.claim.sub', marcus::text, false);
  assert public.can_join_whisper('whisper:' || conv_id), 'both members may listen';
  perform set_config('request.jwt.claim.sub', jayden::text, false);
  assert not public.can_join_whisper('whisper:' || conv_id), 'an outsider may not';
  assert not public.can_join_whisper('whisper:999999'), 'nor can anybody join a conversation that does not exist';

  -- The policy itself, not just the function: the channel is private because
  -- RLS says so, even for a client that builds its own subscription.
  perform set_config('realtime.topic', 'whisper:' || conv_id, false);
  set local role authenticated;
  assert (select count(*) from realtime.messages) = 0, 'nothing is readable in an outsider''s thread';
  reset role;

  -- Membership is not permanent: a closed thread is a closed channel.
  perform set_config('request.jwt.claim.sub', daniel::text, false);
  update public.conversations set closed = true where id = conv_id;
  assert not public.can_join_whisper('whisper:' || conv_id), 'a closed conversation has no live channel';
  update public.conversations set closed = false where id = conv_id;

  -- And a cut-off pair has none either.
  insert into public.blocks (blocker_id, blocked_id) values (marcus_id, daniel_id) on conflict do nothing;
  assert not public.can_join_whisper('whisper:' || conv_id), 'a cut-off pair has no channel';
  delete from public.blocks where blocker_id = marcus_id and blocked_id = daniel_id;
  -- Unblocking does not resurrect the Whisper: a block ends a connection for
  -- good, so the pair has to ask again. The suite needs a working thread, so it
  -- states the new answer instead of assuming the old one came back.
  if to_regclass('public.holup_whisper_permissions') is not null then
    update public.holup_whisper_permissions
       set state = 'accepted', decided_at = public.now_ms()
     where conversation_id = conv_id;
  end if;
  update public.conversations set closed = false where id = conv_id;

  -- ------------------------------------------------ 5 · activity vs online
  presence := public.peer_presence(conv_id);
  assert (presence ->> 'online') is not null, 'presence reports the dot when it may';
  assert (presence ->> 'activity') is not null, 'and the timestamp when it may';
  assert (presence ->> 'announce')::boolean = true, 'and this member may announce themselves';

  -- Their switch, their timestamp: the dot stays, the log does not.
  update public.privacy set show_activity = false where user_id = marcus_id;
  presence := public.peer_presence(conv_id);
  assert (presence ->> 'online') is not null, 'online visibility is a separate switch and stays on';
  assert (presence ->> 'activity') is null, 'with activity off, no time is offered';
  -- The Space agrees with the header: one rule, not two.
  assert (public.public_profile(daniel_id, marcus_id, false) ->> 'online') is not null,
    'the Space still shows the dot';
  assert (public.public_profile(daniel_id, marcus_id, false) -> 'activity') = 'null'::jsonb,
    'and hides the timestamp';
  update public.privacy set show_activity = true where user_id = marcus_id;

  -- Switching off online hides both, because a timestamp is a stronger claim
  -- than a dot.
  update public.privacy set show_online = false where user_id = marcus_id;
  presence := public.peer_presence(conv_id);
  assert (presence ->> 'online') is null, 'with online off there is no dot';
  assert (presence ->> 'activity') is null, 'and no timestamp either';
  update public.privacy set show_online = true where user_id = marcus_id;

  -- ------------------------------------------------------- 6 · no crossing
  begin
    perform set_config('request.jwt.claim.sub', jayden::text, false);
    perform public.mark_messages_delivered(conv_id, null);
    raise exception 'an outsider must not acknowledge somebody else''s thread';
  exception
    when others then
      if position('Conversation not found' in sqlerrm) = 0 then raise; end if;
  end;

  -- A member may only acknowledge the *other* side's messages: my own message
  -- is not something I deliver to myself.
  perform set_config('request.jwt.claim.sub', marcus::text, false);
  perform public.send_message(conv_id, 'text', 'mine, not delivered to me', null, '{}'::jsonb);
  res := public.mark_messages_delivered(conv_id, null);
  assert (select delivered_at from public.messages
           where conversation_id = conv_id and sender_id = marcus_id
           order by id desc limit 1) is null,
    'my own message carries no delivery stamp from me';

  if added_connection then
    delete from public.connections
      where user_a = least(daniel_id, marcus_id) and user_b = greatest(daniel_id, marcus_id);
  end if;

  -- Tidy: remove the thread's test traffic so later suites see what they expect.
  delete from public.messages where conversation_id = conv_id and body in
    ('delivery, please', 'and this one', 'mine, not delivered to me');

  raise notice 'Whisper live: delivery stamped once, read implies delivered, receipts gated, channel authorised per conversation, activity separate from online.';
end $$;
