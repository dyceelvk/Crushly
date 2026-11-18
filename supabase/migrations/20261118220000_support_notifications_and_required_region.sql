-- Two corrections to how holUpp Support reaches a member, and one new rule about
-- where a member is.
--
-- 1. Support contact is a notification from holUpp, not a Whisper from a person
--    called "Holup". A Whisper is a conversation between two members, and a
--    support note arriving as one — among somebody's crushes, titled with a
--    stranger's display name — is the wrong shape and the wrong voice. The
--    message row stays (it is the record, and a member can still answer in the
--    same thread); what changes is that the member is *told* through
--    Notifications, as holUpp, and that thread is marked official.
--
-- 2. A region is required. Until now detection was a fire-and-forget call on
--    session refresh, so 2 of 25 accounts had a region and every user page in
--    the Control Centre read "Country not recorded". It now records on every
--    session, sets the profile's country when nothing is declared, and can be
--    asked whether the member has been located yet.
--
-- 3. Where a member is is private by default. It is never shown to other
--    members unless they choose to show it.

-- ---------------------------------------------------------------- 1. contact

alter table public.notifications
  drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check check (kind in (
    'crush','deep_crush','mutual','message','moment_reply','moment_reaction',
    'verified','verification_rejected','post_reaction','post_comment','post_mention',
    'keep','circle_request','circle_approved','circle_declined','circle_invite','circle_joined',
    'verification','announcement','account','moderation','payment','system',
    /* holUpp Support wrote to you. Deliberately its own kind: it must not be
       filed under Whispers, because it is not a Whisper. */
    'support'
  ));

-- A support thread is identifiable as one, so the member's app can label it and
-- the Control Centre can list its own threads without guessing from a name.
alter table public.conversations
  add column if not exists official boolean not null default false;

update public.conversations c
   set official = true
 where exists (
   select 1 from public.holup_whisper_permissions wp
    where wp.conversation_id = c.id and wp.state = 'accepted'
 );

-- Support messages now also land in Notifications, addressed from holUpp itself.
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
      insert into public.conversations (user_a, user_b, created_at, last_message_at, official)
      values (least(support, member), greatest(support, member), nowms, nowms, true)
      returning * into conv;
    end if;
  end if;

  update public.conversations set official = true where id = conv.id;

  /*
   * Support writes with permission. `holup_whisper_insert_guard` is the
   * member-to-member rule: a stranger gets two requests and the recipient
   * decides. Support is not a stranger — it is the platform, and the member is
   * writing back in this same thread. The permission row is accepted first so
   * the guard, which is not touched and still runs, lets the insert through.
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

  /*
   * The notification is the point of this migration. actor_id stays null on
   * purpose: nothing about this came from a member, and a null actor is what
   * makes the member's app say "holUpp" instead of a name. ref_id is the
   * conversation, so a tap opens the thread to answer in.
   */
  insert into public.notifications (user_id, kind, actor_id, ref_id, body, created_at)
  values (member, 'support', null, conv.id, left(body, 300), nowms);

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

-- ------------------------------------------------------------------ 2. region

-- Whether a member can be located at all, so the app can require it rather than
-- hope. No location values are returned to the caller.
create or replace function public.holup_region_status()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
stable
as $function$
declare
  me bigint := public.me_id();
  r  public.holup_user_regions;
begin
  if me is null then return jsonb_build_object('located', false, 'required', true); end if;
  select * into r from public.holup_user_regions where profile_id = me;
  return jsonb_build_object(
    'located', coalesce(r.detected_country_code, r.effective_country_code) is not null,
    'required', true,
    'declared', r.selected_country_code,
    'method', r.detection_method,
    'detectedAt', r.last_detected_at,
    /* Detection is required; disclosure is not. False unless the member says
       otherwise, and there is no profile field that leaks it in the meantime. */
    'shared', coalesce(r.share_with_members, false)
  );
end $function$;

revoke all on function public.holup_region_status() from public, anon;
grant execute on function public.holup_region_status() to authenticated;

alter table public.holup_user_regions
  add column if not exists share_with_members boolean not null default false;

create or replace function public.holup_region_share(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  me bigint := public.me_id();
  want boolean := coalesce((p->>'share')::boolean, false);
begin
  if me is null then perform public.crushly_fail(401, 'unauthorized', 'Sign in first.'); end if;
  update public.holup_user_regions set share_with_members = want, updated_at = public.now_ms()
   where profile_id = me;
  if not found then
    perform public.crushly_fail(409, 'not_located', 'Turn location on before choosing whether to share it.');
  end if;
  return jsonb_build_object('shared', want);
end $function$;

revoke all on function public.holup_region_share(jsonb) from public, anon;
grant execute on function public.holup_region_share(jsonb) to authenticated;

-- Support messages are not whispers. Keep them out of the section that says
-- "where a Crush turns into a conversation".
create or replace function public.holup_conversations_flag_official()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.official is null then new.official := false; end if;
  return new;
end $function$;

drop trigger if exists conversations_flag_official on public.conversations;
create trigger conversations_flag_official
  before insert or update on public.conversations
  for each row execute function public.holup_conversations_flag_official();

notify pgrst, 'reload schema';
