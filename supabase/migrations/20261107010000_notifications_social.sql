-- Notifications are social activity. Private conversation belongs in Whisper.
--
-- Four faults, each one visible on a phone:
--
--   1. Whisper messages arrive in the Notification centre. `notify_to` writes a
--      'message' row per conversation, so the centre is a second, worse inbox —
--      one that cannot show the message, cannot reply, and marks the same event
--      twice whenever the chat is open in front of you. The inbox already holds
--      the sender, the preview and the unread count; the centre does not need a
--      copy of it.
--
--   2. Keeping somebody close told nobody. `keep_close` says so in a comment —
--      "it is not announced" — but a follower is exactly the kind of social
--      event this centre exists for, so it is announced now, with its own kind
--      and its own switch.
--
--   3. Mentions did not exist. `@username` is typeable (mention_suggest offers
--      it) and nothing was ever sent when somebody used it.
--
--   4. Post Crushes and comments had no wording, so they rendered as a picture,
--      a timestamp and an empty line — and tapping one went nowhere. The wording
--      and the destination are the client's job (Notifications.tsx), but the row
--      has to say which post it is about: `post_comment` already carried the
--      post id in `ref_id`, and now so does the mention.
--
-- The vocabulary this file assumes is the one the product settled on:
--   profile  →  Add Up       (a connection request, answered by a person)
--   following →  Keep Close  (no approval, nobody's permission)
--   a post   →  Crush        (engagement, unchanged)

-- ---------------------------------------------------------------- 1. the kinds

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('crush', 'deep_crush', 'mutual', 'message', 'moment_reply',
                  'moment_reaction', 'verified', 'verification_rejected',
                  'post_reaction', 'post_comment', 'post_mention', 'keep',
                  'circle_request', 'circle_approved', 'circle_declined',
                  'circle_invite', 'circle_joined'));

-- ------------------------------------------------- 2. keeping close is news

alter table public.notification_settings
  add column if not exists keeps boolean not null default true;

create or replace function public.notification_allowed(p_uid bigint, p_kind text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when not exists (select 1 from notification_settings where user_id = p_uid) then true
    when p_kind = 'message' then (select messages from notification_settings where user_id = p_uid)
    when p_kind in ('crush', 'deep_crush', 'mutual') then (select crushes from notification_settings where user_id = p_uid)
    when p_kind in ('moment_reply', 'moment_reaction') then (select moments from notification_settings where user_id = p_uid)
    when p_kind = 'keep' then coalesce((select keeps from notification_settings where user_id = p_uid), true)
    else true
  end
$$;

create or replace function public.keep_close(p_member_id bigint)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  n  int;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  if p_member_id is null or me = p_member_id then
    perform public.crushly_fail(400, '', 'You can’t keep yourself close.');
  end if;
  if not exists (select 1 from profiles p where p.id = p_member_id and p.status = 'active') then
    perform public.crushly_fail(404, '', 'Member not found.');
  end if;
  if public.is_blocked_pair(me, p_member_id) then
    perform public.crushly_fail(403, '', 'You can’t keep this member close.');
  end if;

  -- A hundred a day is far past what a person does by hand and far short of
  -- what it takes to farm a follower list.
  select count(*) into n from keeps k
   where k.keeper_id = me and k.created_at > public.now_ms() - 86400 * 1000;
  if n >= 100 then
    perform public.crushly_fail(429, '', 'That’s a lot for one day — try again tomorrow.');
  end if;

  -- Announced only when it is new. Keeping somebody close twice is not an event,
  -- and a member who follows, lets go and follows again should not ring the bell
  -- each time they change their mind.
  if not exists (select 1 from keeps k where k.keeper_id = me and k.kept_id = p_member_id) then
    perform public.notify_to(p_member_id, 'keep', me, null, '');
  end if;

  insert into keeps (keeper_id, kept_id) values (me, p_member_id) on conflict do nothing;
  return public.keep_state(p_member_id);
end $$;

-- ------------------------------------------------------ 3. mentions are sent

/*
 * `@handle` in a post, resolved to the person it names.
 *
 * The handle is the username, which is lowercase letters, digits and underscore
 * — the same rule `mention_suggest` offers and the same one the composer
 * inserts, so what is typeable is what is announced. A mention notifies only
 * somebody who can see the post: a handle written into a connections-only post
 * says nothing to a member who is not a connection, and a handle in a Circle
 * post says nothing to a member of the wrong room. Naming yourself is not news.
 */
create or replace function public.notify_post_mentions() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  handle   text;
  target   bigint;
begin
  for handle in
    select distinct lower(m[1])
      from regexp_matches(coalesce(new.body, ''), '@([a-zA-Z0-9_]{3,30})', 'g') as m
  loop
    select p.id into target from profiles p
     where lower(p.username) = handle and p.id <> new.author_id
       and p.status = 'active'
     limit 1;
    continue when target is null;
    continue when not public.can_view_post(new, target);
    perform public.notify_to(target, 'post_mention', new.author_id, new.id, left(coalesce(new.body, ''), 80));
  end loop;
  return null;
end $$;

drop trigger if exists posts_notify_mentions on public.posts;
create trigger posts_notify_mentions after insert or update of body on public.posts
  for each row execute function public.notify_post_mentions();

-- An edit that adds somebody sends one; an edit that changes nothing sends
-- nothing, because the trigger only fires when the words change and the row it
-- would write already exists (see below).

/*
 * One unread row per (kind, actor, ref).
 *
 * A post edited twice must not shout twice, and a member who follows, lets go
 * and follows again has not done two things: an unread row of the same kind,
 * from the same person, about the same thing is the same news, so it is
 * refreshed rather than stacked. Once it has been read, a fresh event is fresh
 * news again and gets its own row.
 */
create or replace function public.notify_to(
  p_uid bigint, p_kind text, p_actor_id bigint default null, p_ref_id bigint default null, p_body text default ''
) returns void
language plpgsql security definer set search_path = public as $$
declare
  existing_id bigint;
begin
  /*
   * A private message is not social activity in the centre's sense. The Whisper
   * inbox shows the sender, the preview and the count, in real time, in the one
   * place a reply can be typed — a second copy here is a notification that
   * cannot be answered and marks the same message twice.
   *
   * Kept as a silent return rather than deleted from the callers: `send_message`
   * is one of the oldest and most load-bearing functions in the database, and a
   * policy about where a message appears belongs here, at the one door every
   * notification walks through.
   */
  if p_kind = 'message' then
    return;
  end if;

  if not public.notification_allowed(p_uid, p_kind) then
    return;
  end if;

  if p_kind in ('post_mention', 'keep') and p_actor_id is not null then
    select nt.id into existing_id from notifications nt
     where nt.user_id = p_uid and nt.kind = p_kind
       and nt.actor_id = p_actor_id
       and nt.ref_id is not distinct from p_ref_id
       and nt.read_at is null
     limit 1;
    if existing_id is not null then
      update notifications nt
         set created_at = public.now_ms(), body = p_body
       where nt.id = existing_id;
      return;
    end if;
  end if;

  insert into notifications (user_id, kind, actor_id, ref_id, body)
  values (p_uid, p_kind, p_actor_id, p_ref_id, p_body);
end $$;

-- ------------------------------------------- 4. the centre is not a second inbox

/*
 * Messages already in the centre are removed. They were written before the rule
 * above existed, and leaving them would mean the rule only applies to new
 * messages — the centre would keep a frozen copy of old conversations forever.
 * Nothing is lost: every one of them is a row in `messages`, where it can still
 * be read and answered.
 */
delete from public.notifications where kind = 'message';
