-- The notification centre is social activity, and each row says what it is about.
--
-- Four things this pins, each of them a fault somebody could see on a phone:
--
--   1. A Whisper appears as a content-free, actionable conversation notification.
--   2. Keeping somebody close is announced — once, not on every re-follow — and
--      can be switched off without silencing anything else.
--   3. `@handle` in a post reaches the person named, with the post id on the row
--      so the tap can go to the exact post. Naming yourself is not news, and a
--      handle in a post the reader cannot see is not news either.
--   4. A Crush on a post still notifies the author, still carries the post id,
--      and still says nothing when you Crush your own.
do $$
declare
  follow_new boolean;
  author_uuid uuid;
  actor_uuid  uuid;
  viewer_uuid uuid;
  author_pid   bigint;
  actor_pid    bigint;
  viewer_pid   bigint;
  actor_handle text;
  post_new     bigint;
  gated_new    bigint;
  conv        bigint;
  n           integer;
  row_ref     bigint;
  row_kind    text;
begin
  -- Add Ups replaced Keep Close; the new routine exists once the relationship
  -- candidate is applied. This suite is about notifications, not about which
  -- verb the client calls, so it follows through whichever one the schema has.
  follow_new := to_regprocedure('public.holup_follow(bigint)') is not null;
  select id into author_uuid from auth.users where email = 'daniel@crushly.app';
  select id into actor_uuid  from auth.users where email = 'marcus@crushly.app';
  select id into viewer_uuid from auth.users where email = 'tobi@crushly.app';
  select id, username into author_pid, actor_handle from profiles where name = 'Daniel';
  select id into actor_pid  from profiles where name = 'Marcus';
  select id into viewer_pid from profiles where name = 'Tobi';

  -- A handle long enough to satisfy the username rule, seeded here so the
  -- mention below names a real person by the means a person would use.
  update public.profiles set username = 'marcus_test' where id = actor_pid;

  -- ------------------------------------------------- 1. a message is its own category

  delete from public.notifications where user_id = author_pid;

  -- Whisper is for connections by default (privacy.who_can_message = 'mutual'),
  -- so the pair is connected first: this test is about where a message appears,
  -- not about who may start one.
  perform public.connect_pair(author_pid, actor_pid);

  insert into public.conversations (user_a, user_b)
    values (least(author_pid, actor_pid), greatest(author_pid, actor_pid))
    on conflict (user_a, user_b) do update set closed = false
    returning id into conv;

  -- A Whisper needs an answer, not just a connection. This suite is about
  -- where a Whisper shows up, so the answer is stated here instead of being assumed
  -- from the old "connections may always message" rule.
  if to_regclass('public.holup_whisper_permissions') is not null then
    insert into public.holup_whisper_permissions(conversation_id, requester_id, recipient_id, state, decided_at)
      values (conv, least(author_pid, actor_pid), greatest(author_pid, actor_pid), 'accepted', public.now_ms())
      on conflict (conversation_id) do update set state = 'accepted', decided_at = public.now_ms();
  end if;
    perform set_config('request.jwt.claim.sub', actor_uuid::text, false);
  set local role authenticated;
  perform public.send_message(conv, 'text', 'hey, what is up?', null, '{}'::jsonb);
  reset role;

  select count(*) into n from public.notifications where user_id = author_pid and kind = 'message';
  if n <> 1 then
    raise exception 'a Whisper should create one notification, got %', n;
  end if;
  assert (select body='' and ref_id=conv from public.notifications where user_id=author_pid and kind='message' limit 1), 'message notification has no private text and opens the thread';

  -- ------------------------------------------------------------ 2. Add Ups

  -- Historic one-way Keeps arrive converted into Add Ups, so this pair may
  -- already be followed. Clear it: the notification asserted below has to be a
  -- genuinely new Add Up, not one that was already sitting there.
  if to_regclass('public.holup_follows') is not null then
    delete from public.holup_follows
     where follower_id in (author_pid, actor_pid)
       and followed_id in (author_pid, actor_pid);
  end if;

  delete from public.notifications where user_id = author_pid;

  perform set_config('request.jwt.claim.sub', actor_uuid::text, false);
  set local role authenticated;
  if follow_new then perform public.holup_follow(author_pid); else perform public.keep_close(author_pid); end if;
  reset role;

  select kind into row_kind from public.notifications
   where user_id = author_pid order by id desc limit 1;
  if row_kind is distinct from 'keep' then
    raise exception 'following did not announce itself (last kind: %)', row_kind;
  end if;

  -- Re-following after letting go is allowed, and is not a second event.
  perform set_config('request.jwt.claim.sub', actor_uuid::text, false);
  set local role authenticated;
  if follow_new then perform public.holup_unfollow(author_pid); else perform public.let_go(author_pid); end if;
  if follow_new then perform public.holup_follow(author_pid); else perform public.keep_close(author_pid); end if;
  reset role;
  select count(*) into n from public.notifications where user_id = author_pid and kind = 'keep';
  if n <> 1 then
    raise exception 're-following produced % notifications instead of one', n;
  end if;

  -- …and the switch works, without silencing add ups.
  update public.notification_settings set keeps = false where user_id = author_pid;
  delete from public.notifications where user_id = author_pid;
  perform set_config('request.jwt.claim.sub', actor_uuid::text, false);
  set local role authenticated;
  if follow_new then perform public.holup_unfollow(author_pid); else perform public.let_go(author_pid); end if;
  if follow_new then perform public.holup_follow(author_pid); else perform public.keep_close(author_pid); end if;
  reset role;
  select count(*) into n from public.notifications where user_id = author_pid and kind = 'keep';
  if n <> 0 then
    raise exception 'keeps were switched off and still produced a notification';
  end if;
  update public.notification_settings set keeps = true where user_id = author_pid;

  -- -------------------------------------------------------------- 3. mentions

  delete from public.notifications where user_id = actor_pid;

  perform set_config('request.jwt.claim.sub', author_uuid::text, false);
  set local role authenticated;
  post_new := (public.create_post('shooting with @marcus_test today, come through', null, 'everyone', null, null)->>'id')::bigint;
  reset role;

  select kind, ref_id into row_kind, row_ref from public.notifications
   where user_id = actor_pid order by id desc limit 1;
  if row_kind is distinct from 'post_mention' then
    raise exception 'a mention did not notify the person named (last kind: %)', row_kind;
  end if;
  if row_ref is distinct from post_new then
    raise exception 'the mention named post % but the row says %', post_new, row_ref;
  end if;

  -- Editing the post twice does not shout twice: one unread mention of one post.
  perform set_config('request.jwt.claim.sub', author_uuid::text, false);
  set local role authenticated;
  perform public.edit_post(post_new, 'shooting with @marcus_test today, come through!', null);
  reset role;
  select count(*) into n from public.notifications
   where user_id = actor_pid and kind = 'post_mention' and ref_id = post_new;
  if n <> 1 then
    raise exception 'editing a post produced % mention rows', n;
  end if;

  -- A handle in a post the reader cannot see says nothing.
  update public.profiles set username = 'tobi_test' where id = viewer_pid;
  delete from public.notifications where user_id = viewer_pid;
  perform set_config('request.jwt.claim.sub', author_uuid::text, false);
  set local role authenticated;
  gated_new := (public.create_post('just for my people, @tobi_test', null, 'connections', null, null)->>'id')::bigint;
  reset role;
  select count(*) into n from public.notifications where user_id = viewer_pid and kind = 'post_mention';
  if n <> 0 then
    raise exception 'a mention in a connections-only post reached a stranger';
  end if;

  -- Naming yourself is not news.
  delete from public.notifications where user_id = author_pid;
  perform set_config('request.jwt.claim.sub', author_uuid::text, false);
  set local role authenticated;
  perform public.create_post('note to self @daniel_test', null, 'everyone', null, null);
  reset role;
  select count(*) into n from public.notifications where user_id = author_pid and kind = 'post_mention';
  if n <> 0 then
    raise exception 'mentioning yourself produced a notification';
  end if;

  -- ------------------------------------------------ 4. Crush still notifies

  delete from public.notifications where user_id = author_pid;
  perform set_config('request.jwt.claim.sub', actor_uuid::text, false);
  set local role authenticated;
  perform public.react_to_post(post_new, true, 'crush');
  reset role;

  select kind, ref_id into row_kind, row_ref from public.notifications
   where user_id = author_pid order by id desc limit 1;
  if row_kind is distinct from 'post_reaction' or row_ref is distinct from post_new then
    raise exception 'a Crush on a post did not notify its author about that post (%, %)', row_kind, row_ref;
  end if;

  -- Crushing your own post is allowed and tells nobody.
  delete from public.notifications where user_id = author_pid;
  perform set_config('request.jwt.claim.sub', author_uuid::text, false);
  set local role authenticated;
  perform public.react_to_post(post_new, true, 'crush');
  reset role;
  select count(*) into n from public.notifications where user_id = author_pid;
  if n <> 0 then
    raise exception 'crushing your own post notified % people', n;
  end if;

  raise notice 'Notifications: Whispers are content-free, follows announced once and switchable, mentions land on the post, Crush still notifies.';
end $$;

update public.profiles set username = 'daniel_test' where name = 'Daniel' and username = '';
