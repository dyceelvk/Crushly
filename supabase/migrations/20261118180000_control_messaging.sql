-- 20261118180000_control_messaging
--
-- Something the Control Centre could not do at all: start a conversation.
--
-- The centre could warn a member, restrict them, suspend them, ban them, restore
-- them — a wall of consequences, and no way to say a sentence first. Support that
-- only exists as a punishment is not support. This adds the missing verb.
--
-- Identity is the hard part, not delivery
-- ---------------------------------------
-- A staff account writing into a member's Whispers as itself would put a named
-- person, with a staff profile and an opinion, inside somebody's private
-- messages. That is a different product and a worse one. So every message sent
-- from here is sent by **holUpp Support** — one fixed, unclaimable identity that
-- the member sees, and staff never appear as themselves.
--
-- The conversation is a real thread on the member's side: it lands in their
-- Whispers inbox, it appends to any thread they already have with Support, and
-- their reply comes back here. Nothing is simulated, and nothing is delivered
-- to the wrong person: `open_conversation` is bypassed on purpose, because that
-- function asks the *member's* rules about who may message whom. Support is not
-- a stranger asking; it is the platform answering.
--
-- Authorisation: every entry point calls `holup_cc_require('notifications')`.
-- Reading requires 'read'; sending requires 'manage'. That is the same module
-- the Inbox already uses, so an account that can read support mail can read these
-- threads, and only an account that can act can answer.

-- --------------------------------------------------------------- who we are
-- Looked up rather than hardcoded: the Support profile is a real profile row, and
-- if somebody renames it the centre follows.
create or replace function public.holup_cc_support_profile()
returns bigint
language sql stable security definer set search_path to 'public'
as $function$
  select p.id
    from public.profiles p
   where p.username = 'holup'
   order by p.id
   limit 1;
$function$;

revoke all on function public.holup_cc_support_profile() from public, anon;
grant execute on function public.holup_cc_support_profile() to authenticated, service_role;

/**
 * The list: every thread Support has with a member, newest activity first.
 *
 * Built from `conversations` where one side is the Support profile, so it can
 * only ever contain real threads. `unread` counts the member's messages that
 * Support has not read — the number that means somebody is waiting.
 */
create or replace function public.holup_cc_threads(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  support bigint := public.holup_cc_support_profile();
  lim  integer := least(greatest(coalesce(nullif(p->>'limit','')::integer, 50), 1), 200);
  off  integer := greatest(coalesce(nullif(p->>'offset','')::integer, 0), 0);
  q    text := nullif(trim(p->>'q'), '');
  items jsonb;
  total integer;
begin
  perform public.holup_cc_require('notifications', false);

  if support is null then
    return jsonb_build_object('supportProfileId', null, 'total', 0, 'items', '[]'::jsonb,
      'note', 'No profile with the username holup exists, so there is no Support identity to send from.');
  end if;

  select count(*) into total
    from public.conversations c
    join public.profiles other on other.id = case when c.user_a = support then c.user_b else c.user_a end
   where support in (c.user_a, c.user_b)
     and (q is null or other.name ilike '%' || q || '%' or other.username ilike '%' || q || '%');

  select coalesce(jsonb_agg(jsonb_build_object(
           'conversationId', t.id,
           'member', jsonb_build_object('id', t.other_id, 'name', t.other_name, 'username', t.other_username, 'status', t.other_status),
           'lastMessageAt', t.last_message_at,
           'lastBody', t.last_body,
           'lastFromSupport', t.last_from_support,
           'unread', t.unread
         ) order by t.last_message_at desc nulls last, t.id desc), '[]'::jsonb)
    into items
    from (
      select c.id, c.last_message_at, other.id as other_id, other.name as other_name,
             other.username as other_username, other.status as other_status,
             (select m.body from public.messages m where m.conversation_id = c.id order by m.created_at desc, m.id desc limit 1) as last_body,
             (select m.sender_id = support from public.messages m where m.conversation_id = c.id order by m.created_at desc, m.id desc limit 1) as last_from_support,
             (select count(*) from public.messages m
               where m.conversation_id = c.id and m.sender_id <> support and m.read_at is null) as unread
        from public.conversations c
        join public.profiles other on other.id = case when c.user_a = support then c.user_b else c.user_a end
       where support in (c.user_a, c.user_b)
         and (q is null or other.name ilike '%' || q || '%' or other.username ilike '%' || q || '%')
       order by c.last_message_at desc nulls last, c.id desc
       limit lim offset off
    ) t;

  return jsonb_build_object('supportProfileId', support, 'total', total, 'items', items);
end $function$;

revoke all on function public.holup_cc_threads(jsonb) from public, anon;
grant execute on function public.holup_cc_threads(jsonb) to authenticated, service_role;

/**
 * One thread, with both sides.
 *
 * Reading it marks the member's messages read — the same thing opening a mail in
 * the Inbox does. That is the only write a read-level account can cause here.
 */
create or replace function public.holup_cc_thread(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  support bigint := public.holup_cc_support_profile();
  cid bigint := nullif(p->>'conversationId','')::bigint;
  member bigint := nullif(p->>'memberId','')::bigint;
  conv public.conversations;
  other public.profiles;
  msgs jsonb;
begin
  perform public.holup_cc_require('notifications', false);
  if support is null then
    perform public.crushly_fail(409, 'no_support_identity', 'No profile with the username holup exists.');
  end if;

  if cid is not null then
    select * into conv from public.conversations where id = cid;
    if not found then
      perform public.crushly_fail(404, 'not_found', 'That conversation does not exist.');
    end if;
    if support not in (conv.user_a, conv.user_b) then
      perform public.crushly_fail(404, 'not_found', 'That conversation is not a Support thread.');
    end if;
  elsif member is not null then
    select * into conv from public.conversations
     where user_a = least(support, member) and user_b = greatest(support, member);
    if not found then
      select * into other from public.profiles where id = member;
      if not found then
        perform public.crushly_fail(404, 'not_found', 'No such member.');
      end if;
      -- A thread that does not exist yet is not an error: the centre is about to
      -- start one, and it needs the member's name to write it.
      return jsonb_build_object(
        'conversationId', null,
        'member', jsonb_build_object('id', other.id, 'name', other.name, 'username', other.username, 'status', other.status),
        'messages', '[]'::jsonb
      );
    end if;
  else
    perform public.crushly_fail(400, 'bad_request', 'A conversation or a member is required.');
  end if;

  select p.* into other from public.profiles p
   where p.id = case when conv.user_a = support then conv.user_b else conv.user_a end;

  update public.messages
     set read_at = coalesce(read_at, public.now_ms())
   where conversation_id = conv.id and sender_id <> support and read_at is null;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'fromSupport', m.sender_id = support, 'kind', m.kind,
           'body', m.body, 'mediaUrl', m.media_url, 'createdAt', m.created_at, 'readAt', m.read_at
         ) order by m.created_at asc, m.id asc), '[]'::jsonb)
    into msgs
    from public.messages m where m.conversation_id = conv.id;

  return jsonb_build_object(
    'conversationId', conv.id,
    'member', jsonb_build_object('id', other.id, 'name', other.name, 'username', other.username, 'status', other.status),
    'messages', msgs
  );
end $function$;

revoke all on function public.holup_cc_thread(jsonb) from public, anon;
grant execute on function public.holup_cc_thread(jsonb) to authenticated, service_role;

/**
 * Say something to a member as Support — creating the thread if there is not one.
 *
 * `manage` on notifications, not `read`: this is an action, and it appears in
 * the member's app as a message from the platform.
 *
 * The conversation is created directly rather than through `open_conversation`
 * because that function applies the *member's* privacy rules about who may
 * approach them. Support is not approaching; it is answering. But it still
 * refuses two cases: a non-existent member, and a banned one — a thread with
 * somebody who cannot read it is a lie about having contacted them.
 */
create or replace function public.holup_cc_send_support_message(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  support bigint := public.holup_cc_support_profile();
  actor   uuid   := auth.uid();
  member  bigint := nullif(p->>'memberId','')::bigint;
  cid     bigint := nullif(p->>'conversationId','')::bigint;
  body    text   := nullif(trim(p->>'body'), '');
  other   public.profiles;
  conv    public.conversations;
  msg     public.messages;
  nowms   bigint := public.now_ms();
begin
  perform public.holup_cc_require('notifications', true);

  if support is null then
    perform public.crushly_fail(409, 'no_support_identity', 'No profile with the username holup exists, so nothing can be sent as Support.');
  end if;
  if body is null or length(body) < 1 then
    perform public.crushly_fail(400, 'empty', 'Write something before sending.');
  end if;
  if length(body) > 4000 then
    perform public.crushly_fail(400, 'too_long', 'Keep it under 4000 characters.');
  end if;

  if cid is not null then
    select * into conv from public.conversations where id = cid;
    if not found or support not in (conv.user_a, conv.user_b) then
      perform public.crushly_fail(404, 'not_found', 'That is not a Support conversation.');
    end if;
    member := case when conv.user_a = support then conv.user_b else conv.user_a end;
  else
    if member is null then
      perform public.crushly_fail(400, 'bad_request', 'Choose a member to write to.');
    end if;
    select * into other from public.profiles where id = member;
    if not found then
      perform public.crushly_fail(404, 'not_found', 'No such member.');
    end if;
    if other.status = 'banned' then
      perform public.crushly_fail(409, 'banned', 'That member is banned and cannot receive messages.');
    end if;
    select * into conv from public.conversations
     where user_a = least(support, member) and user_b = greatest(support, member);
    if not found then
      insert into public.conversations (user_a, user_b, created_at, last_message_at)
      values (least(support, member), greatest(support, member), nowms, nowms)
      returning * into conv;
    end if;
  end if;

  /*
   * Support writes with permission, and the difference is not cosmetic.
   *
   * `holup_whisper_insert_guard` is the member-to-member rule: a stranger gets
   * two requests, and the recipient decides. Applied to this function it would
   * mean the platform's own support message sat *unreadable* behind a request
   * the member had to accept — which is not support, it is a cold call. Support
   * is also not a stranger: the member is writing to this same thread.
   *
   * So the permission row is accepted first, and the guard — which is not
   * touched, and still runs — sees an accepted thread and lets the insert
   * through. Every other property it enforces still holds: the conversation must
   * exist, the sender must be in it, and neither side may have blocked the other.
   */
  insert into public.holup_whisper_permissions as wp
    (conversation_id, requester_id, recipient_id, state, request_messages, created_at, decided_at)
  values (conv.id, support, member, 'accepted', 0, nowms, nowms)
  on conflict (conversation_id) do update
    set state = 'accepted',
        decided_at = coalesce(wp.decided_at, nowms);

  insert into public.messages (conversation_id, sender_id, kind, body, meta, created_at)
  values (conv.id, support, 'text', body, jsonb_build_object('fromControl', true, 'actor', actor), nowms)
  returning * into msg;

  update public.conversations set last_message_at = nowms where id = conv.id;

  select * into other from public.profiles
   where id = case when conv.user_a = support then conv.user_b else conv.user_a end;

  return jsonb_build_object(
    'conversationId', conv.id,
    'messageId', msg.id,
    'member', jsonb_build_object('id', other.id, 'name', other.name),
    'sentAt', nowms
  );
end $function$;

revoke all on function public.holup_cc_send_support_message(jsonb) from public, anon;
grant execute on function public.holup_cc_send_support_message(jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
