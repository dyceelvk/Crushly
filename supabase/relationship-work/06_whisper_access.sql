-- ISOLATED EXPERIMENT, NOT A PRODUCTION MIGRATION.
-- Apply after 01_core.sql to a disposable DB only. An ended/blocked thread's
-- history stays stored but is unavailable until both people approve again.
-- In-flight/already downloaded content cannot be recalled.
begin;

create or replace function public.whisper_thread_allowed(p_conversation_id bigint) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.conversations c
    where c.id=p_conversation_id and (c.user_a=public.me_id() or c.user_b=public.me_id())
      and not c.closed and public.is_connected_pair(c.user_a,c.user_b)
      and not public.is_blocked_pair(c.user_a,c.user_b))
$$;
revoke all on function public.whisper_thread_allowed(bigint) from public,anon,authenticated;
grant execute on function public.whisper_thread_allowed(bigint) to authenticated,service_role;

create or replace function public.whisper_can_read(p_id bigint) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.messages m where m.id=p_id
    and public.whisper_thread_allowed(m.conversation_id)
    and not exists(select 1 from public.hidden_whispers h where h.message_id=m.id and h.user_id=public.me_id()))
$$;
revoke all on function public.whisper_can_read(bigint) from public,anon,authenticated;
grant execute on function public.whisper_can_read(bigint) to authenticated,service_role;

drop policy if exists conversations_pair on public.conversations;
create policy conversations_pair on public.conversations for select to authenticated using (public.whisper_thread_allowed(id));
drop policy if exists messages_pair on public.messages;
create policy messages_pair on public.messages for select to authenticated using (public.whisper_can_read(id));
-- Raw rows cannot selectively mask receipts. RPC serialization already respects
-- both members' settings, so deny those columns on direct PostgREST table reads.
-- This intentionally needs an installed-client compatibility gate.
revoke select on public.messages from public,anon,authenticated;
revoke select (read_at,delivered_at) on public.messages from public,anon,authenticated;
grant select (id,conversation_id,sender_id,kind,body,media_url,meta,created_at) on public.messages to authenticated;

drop policy if exists message_reactions_pair on public.message_reactions;
create policy message_reactions_pair on public.message_reactions for select to authenticated using (public.whisper_can_read(message_id));


create or replace function public.get_messages(
  p_conversation_id bigint, p_after_id bigint default 0, p_before_id bigint default 0, p_limit integer default 40
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  conv record;
  peer bigint;
  show_receipts boolean;
  lim integer := least(greatest(coalesce(p_limit, 40), 1), 100);
  items jsonb;
  has_more boolean := false;
  last_read_mine bigint;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  select * into conv from conversations c where c.id = p_conversation_id;
  if not found or (conv.user_a <> me and conv.user_b <> me) then
    perform public.crushly_fail(404, '', 'Conversation not found.');
  end if;
  peer := case when conv.user_a = me then conv.user_b else conv.user_a end;
  if not public.whisper_thread_allowed(p_conversation_id) then
    perform public.crushly_fail(404, '', 'Conversation not found.');
  end if;
  show_receipts := public.receipts_visible(me, peer);

  if coalesce(p_after_id, 0) > 0 then
    select coalesce(jsonb_agg(public.serialize_message(m, me, show_receipts) order by m.id), '[]'::jsonb) into items
      from (select * from messages ms where ms.conversation_id = p_conversation_id and not exists (select 1 from public.hidden_whispers h where h.message_id=ms.id and h.user_id=me) and ms.id > p_after_id
            order by ms.id asc limit lim) m;
    has_more := false;
  elsif coalesce(p_before_id, 0) > 0 then
    select coalesce(jsonb_agg(public.serialize_message(m, me, show_receipts) order by m.id), '[]'::jsonb) into items
      from (select * from messages ms where ms.conversation_id = p_conversation_id and not exists (select 1 from public.hidden_whispers h where h.message_id=ms.id and h.user_id=me) and ms.id < p_before_id
            order by ms.id desc limit lim) m;
    has_more := jsonb_array_length(items) = lim;
  else
    select coalesce(jsonb_agg(public.serialize_message(m, me, show_receipts) order by m.id), '[]'::jsonb) into items
      from (select * from messages ms where ms.conversation_id = p_conversation_id and not exists (select 1 from public.hidden_whispers h where h.message_id=ms.id and h.user_id=me)
            order by ms.id desc limit lim) m;
    has_more := jsonb_array_length(items) = lim;
  end if;

  if show_receipts then
    select max(ms.id) into last_read_mine from messages ms
     where ms.conversation_id = p_conversation_id and ms.sender_id = me and ms.read_at is not null;
  end if;

  return jsonb_build_object('items', items, 'hasMore', has_more, 'lastReadMine', last_read_mine);
end $$;

create or replace function public.sync_whispers(p_conversation_id bigint, p_ids bigint[]) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare me bigint:=public.me_id(); c public.conversations; peer bigint;
begin
  if me is null then perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.'); end if;
  if coalesce(array_length(p_ids,1),0)>500 then perform public.crushly_fail(400, '', 'Too many messages.'); end if;
  select * into c from public.conversations where id=p_conversation_id;
  if not found or not public.whisper_thread_allowed(p_conversation_id) then
    perform public.crushly_fail(404, '', 'Conversation not found.'); end if;
  peer := case when c.user_a=me then c.user_b else c.user_a end;
  return coalesce((select jsonb_agg(public.serialize_message(m,me,public.receipts_visible(me,peer)) order by m.id)
    from public.messages m where m.conversation_id=c.id and m.id=any(p_ids)
      and not exists(select 1 from public.hidden_whispers h where h.message_id=m.id and h.user_id=me)), '[]'::jsonb);
end $$;

create or replace function public.list_conversations() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  items jsonb;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'peer', public.peer_summary(case when c.user_a = me then c.user_b else c.user_a end, me),
    'lastMessage', (
      select public.serialize_message(m, me, false) from messages m
       where m.conversation_id = c.id and not exists (select 1 from public.hidden_whispers h where h.message_id=m.id and h.user_id=me) order by m.id desc limit 1
    ),
    'unread', (
      select count(*)::int from messages m
       where m.conversation_id = c.id and m.sender_id <> me and m.read_at is null and not exists (select 1 from public.hidden_whispers h where h.message_id=m.id and h.user_id=me)
    ),
    'updatedAt', coalesce(c.last_message_at, c.created_at)
  ) order by coalesce(c.last_message_at, c.created_at) desc), '[]'::jsonb)
  into items
  from conversations c
  where public.whisper_thread_allowed(c.id);

  return jsonb_build_object('items', items);
end $$;

create or replace function public.load_conversation(p_conversation_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  conv record;
  peer bigint;
  reason text;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  select * into conv from conversations c where c.id = p_conversation_id;
  if not found or (conv.user_a <> me and conv.user_b <> me) then
    perform public.crushly_fail(404, '', 'Conversation not found.');
  end if;
  peer := case when conv.user_a = me then conv.user_b else conv.user_a end;
  if not public.whisper_thread_allowed(p_conversation_id) then
    perform public.crushly_fail(404, '', 'Conversation not found.');
  end if;
  reason := public.messaging_block_reason(me, peer);
  return jsonb_build_object(
    'id', conv.id,
    'closed', conv.closed,
    'peer', public.peer_summary(peer, me),
    'canSend', not conv.closed and reason is null,
    'blockReason', case when conv.closed then 'This connection has ended.' else reason end
  );
end $$;

create or replace function public.can_view_media(p_path text, p_url text default null::text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  me bigint := public.me_id();
  v_kind text := split_part(ltrim(coalesce(p_path, ''), '/'), '/', 1);
  m public.moments;
  msg public.messages;
  post public.posts;
begin
  if me is null or p_path is null or p_path = ''
     or (p_url is not null and public.media_object_path(p_url) <> p_path) then
    return jsonb_build_object('allowed', false, 'cacheable', false);
  end if;

  if v_kind = 'banners' then
    return jsonb_build_object('allowed', exists (
      select 1 from public.profile_banners b
      join public.profiles pf on pf.id = b.user_id
      join public.privacy pr on pr.user_id = b.user_id
      where public.media_object_path(b.url) = p_path
        and split_part(p_path, '/', 2) = b.user_id::text
        and (b.user_id = me or (
          pf.onboarded and pf.status = 'active'
          and not public.is_blocked_pair(me, b.user_id)
          and (pr.profile_visibility = 'everyone' or public.is_connected_pair(me, b.user_id))
          and (not pr.incognito or public.is_connected_pair(me, b.user_id))
        ))
    ), 'cacheable', false);
  end if;

  if v_kind in ('photos', 'seed') then
    return jsonb_build_object('allowed', exists (
      select 1 from photos ph join profiles pf on pf.id = ph.user_id
        join privacy pr on pr.user_id = pf.id
       where public.media_object_path(ph.url) = p_path
         and (v_kind = 'seed' or split_part(p_path, '/', 2) = ph.user_id::text)
         and (ph.user_id = me or (
           pf.onboarded and pf.status = 'active'
           and not public.is_blocked_pair(me, ph.user_id)
           and (pr.profile_visibility = 'everyone' or public.is_connected_pair(me, ph.user_id))
           and (not pr.incognito or public.is_connected_pair(me, ph.user_id))
         ))
    ), 'cacheable', false);
  end if;

  if v_kind = 'moments' then
    select * into m from moments mo where public.media_object_path(mo.media_url) = p_path
      and split_part(p_path, '/', 2) = mo.user_id::text limit 1;
    if not found and p_url is not null then
      select * into m from moments mo where mo.media_url = p_url
        and split_part(p_path, '/', 2) = mo.user_id::text limit 1;
    end if;
    if not found then
      return jsonb_build_object('allowed', false, 'cacheable', false);
    end if;
    if m.expires_at <= public.now_ms() then
      return jsonb_build_object('allowed', false, 'cacheable', false);
    end if;
    if not public.can_view_moment(m, me) then
      return jsonb_build_object('allowed', false, 'cacheable', false);
    end if;
    return jsonb_build_object('allowed', true, 'cacheable', false);
  end if;

  if v_kind = 'messages' then
    select ms.* into msg from messages ms
      join conversations c on c.id = ms.conversation_id
      where public.media_object_path(ms.media_url) = p_path and (c.user_a = me or c.user_b = me)
        and split_part(p_path, '/', 2) = ms.sender_id::text
        and public.whisper_can_read(ms.id)
      limit 1;
    if not found and p_url is not null then
      select ms.* into msg from messages ms
        join conversations c on c.id = ms.conversation_id
        where ms.media_url = p_url and (c.user_a = me or c.user_b = me)
          and split_part(p_path, '/', 2) = ms.sender_id::text
        and public.whisper_can_read(ms.id)
        limit 1;
    end if;
    if not found then
      return jsonb_build_object('allowed', false, 'cacheable', false);
    end if;
    return jsonb_build_object('allowed', true, 'cacheable', false);
  end if;

  -- Media belongs to the original uploader's row, not an arbitrary row that
  -- copied its URL. Visibility is checked again on every request.
  if v_kind = 'posts' then
    select po.* into post from posts po
     where (public.media_object_path(po.media_url) = p_path or (p_url is not null and po.media_url = p_url))
       and split_part(p_path, '/', 2) = po.author_id::text
     limit 1;
    if not found then
      return jsonb_build_object('allowed', false, 'cacheable', false);
    end if;
    if not public.can_view_post(post, me) then
      return jsonb_build_object('allowed', false, 'cacheable', false);
    end if;
    return jsonb_build_object('allowed', true, 'cacheable', false);
  end if;

  -- Inside a Circle: the messages people sent, and the room's cover.
  if v_kind = 'circles' then
    if exists (
      select 1 from circle_messages m2
        join circle_members cm on cm.circle_id = m2.circle_id
       where cm.member_id = me
         and (public.media_object_path(m2.media_url) = p_path or (p_url is not null and m2.media_url = p_url))
         and split_part(p_path, '/', 2) = m2.sender_id::text
         and not public.is_blocked_pair(me, m2.sender_id)
    ) then
      return jsonb_build_object('allowed', true, 'cacheable', false);
    end if;
    if exists (
      select 1 from circles c
        join circle_members cm on cm.circle_id = c.id
       where cm.member_id = me
         and (public.media_object_path(c.cover_url) = p_path or (p_url is not null and c.cover_url = p_url))
         and split_part(p_path, '/', 2) = c.owner_id::text
    ) then
      return jsonb_build_object('allowed', true, 'cacheable', false);
    end if;
    return jsonb_build_object('allowed', false, 'cacheable', false);
  end if;

  return jsonb_build_object('allowed', false, 'cacheable', false);
end $function$;

create or replace function public.whisper_moment_target(p_message_id bigint) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare me bigint:=public.me_id(); msg public.messages; conv public.conversations; mo public.moments; raw_id text;
begin
  if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
  select * into msg from public.messages where id=p_message_id and kind='moment_reply'
    and not exists(select 1 from public.hidden_whispers h where h.message_id=p_message_id and h.user_id=me);
  if not found then return null; end if;
  select * into conv from public.conversations where id=msg.conversation_id;
  if not found or not public.whisper_thread_allowed(conv.id) then return null; end if;
  raw_id:=msg.meta->>'momentId';
  if raw_id is null or raw_id !~ '^[1-9][0-9]{0,17}$' then return null; end if;
  select * into mo from public.moments where id=raw_id::bigint;
  if not found or mo.expires_at<=public.now_ms() or mo.user_id=msg.sender_id
     or mo.user_id not in (conv.user_a,conv.user_b) or not public.can_view_moment(mo,me) then return null; end if;
  return jsonb_build_object('momentId',mo.id,'userId',mo.user_id,'mine',mo.user_id=me);
end $$;

create or replace function public.peer_presence(p_conversation_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  conv record;
  peer bigint;
  r record;
  v record;
  see_online boolean;
  see_activity boolean;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  select * into conv from conversations c
   where c.id = p_conversation_id and (c.user_a = me or c.user_b = me);
  if not found or not public.whisper_thread_allowed(p_conversation_id) then
    perform public.crushly_fail(404, '', 'Conversation not found.');
  end if;
  peer := case when conv.user_a = me then conv.user_b else conv.user_a end;

  select p.last_active_at, pr.show_online, pr.show_activity into r
    from profiles p join privacy pr on pr.user_id = p.id where p.id = peer;
  select pr.show_online, pr.show_activity into v from privacy pr where pr.user_id = me;

  see_online := coalesce(r.show_online, true) and coalesce(v.show_online, true);
  see_activity := see_online and coalesce(r.show_activity, true) and coalesce(v.show_activity, true);

  return jsonb_build_object(
    'peerId', peer,
    'online', case when see_online then public.is_online_at(r.last_active_at) else null end,
    'activity', case when see_activity then public.activity_label_at(r.last_active_at) else null end,
    -- Receipts need both sides; the receipt tick is drawn from this, and the
    -- channel's `read` broadcast is only sent when it is true.
    'receipts', public.receipts_visible(me, peer),
    -- Whether this member's own presence may be announced on the channel. It is
    -- my switch about me, so I am the only one who has to allow it.
    'announce', coalesce(v.show_online, true),
    'closed', conv.closed
  );
end $$;


-- Receipt writes are interactions: take the same pair lock as removal/block,
-- then recheck. Never acknowledge a message this member has hidden.
create or replace function public.mark_messages_delivered(p_conversation_id bigint,p_up_to_id bigint default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id(); c public.conversations; ceiling_id bigint; stamped int; highest bigint;
begin
  if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
  select * into c from public.conversations where id=p_conversation_id;
  if not found or (c.user_a<>me and c.user_b<>me) then perform public.crushly_fail(404,'','Conversation not found.'); end if;
  perform public.relationship_pair_lock(c.user_a,c.user_b);
  if not public.whisper_thread_allowed(p_conversation_id) then perform public.crushly_fail(404,'','Conversation not found.'); end if;
  ceiling_id:=coalesce(p_up_to_id,0);
  if ceiling_id<=0 then select max(id) into ceiling_id from public.messages where conversation_id=p_conversation_id; end if;
  if ceiling_id is null then return jsonb_build_object('upTo',0,'count',0); end if;
  with stamped_rows as (
    update public.messages ms set delivered_at=public.now_ms()
     where ms.conversation_id=p_conversation_id and ms.sender_id<>me and ms.delivered_at is null and ms.id<=ceiling_id
       and not exists(select 1 from public.hidden_whispers h where h.message_id=ms.id and h.user_id=me)
    returning ms.id
  ) select count(*)::int,max(id) into stamped,highest from stamped_rows;
  return jsonb_build_object('upTo',coalesce(highest,0),'count',coalesce(stamped,0));
end $$;

create or replace function public.mark_conversation_read(p_conversation_id bigint) returns boolean
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id(); c public.conversations;
begin
  if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
  select * into c from public.conversations where id=p_conversation_id;
  if not found or (c.user_a<>me and c.user_b<>me) then perform public.crushly_fail(404,'','Conversation not found.'); end if;
  perform public.relationship_pair_lock(c.user_a,c.user_b);
  if not public.whisper_thread_allowed(p_conversation_id) then perform public.crushly_fail(404,'','Conversation not found.'); end if;
  update public.messages ms set delivered_at=coalesce(ms.delivered_at,public.now_ms()),read_at=coalesce(ms.read_at,public.now_ms())
   where ms.conversation_id=p_conversation_id and ms.sender_id<>me and (ms.delivered_at is null or ms.read_at is null)
     and not exists(select 1 from public.hidden_whispers h where h.message_id=ms.id and h.user_id=me);
  update public.notifications set read_at=public.now_ms() where user_id=me and kind in ('message','moment_reply') and ref_id=p_conversation_id and read_at is null;
  return true;
end $$;

-- Badge counts reflect only currently accessible conversations.
create or replace function public.badges() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  latest record;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  select n.id, n.kind, n.body, n.actor_id, pf.name as actor_name
    into latest
    from notifications n left join profiles pf on pf.id = n.actor_id
   where n.user_id = me
   order by n.id desc limit 1;

  return jsonb_build_object(
    'notifications', (select count(*)::int from notifications n where n.user_id = me and n.read_at is null),
    'messages', (
      select count(*)::int
        from messages m join conversations c on c.id = m.conversation_id
       where public.whisper_thread_allowed(c.id)
         and m.sender_id <> me and m.read_at is null
         and not exists(select 1 from public.hidden_whispers h where h.message_id=m.id and h.user_id=me)
         and not public.is_blocked_pair(me, m.sender_id)
    ),
    'crushes', (
      select count(*)::int from notifications n
       where n.user_id = me and n.read_at is null and n.kind in ('crush', 'deep_crush', 'mutual')
    ),
    'latestNotification', case when latest.id is null then null else jsonb_build_object(
      'id', latest.id, 'kind', latest.kind, 'body', latest.body,
      'actor_id', latest.actor_id, 'actor_name', latest.actor_name) end
  );
end $$;

-- Registering a call is also an interaction and must serialize with removal.
create or replace function public.register_call_room(p_conversation_id bigint) returns text
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  conv record;
  peer bigint;
  token text := 'call-' || replace(gen_random_uuid()::text, '-', '');
begin
  if me is null then perform public.crushly_fail(401, '', 'Sign in again to make calls.'); end if;
  if not public.holup_feature_enabled('calls') then perform public.crushly_fail(403,'disabled','Calls are currently unavailable.'); end if;
  select * into conv from public.conversations where id = p_conversation_id;
  if not found or me not in (conv.user_a, conv.user_b) then
    perform public.crushly_fail(404, '', 'Conversation not found.');
  end if;
  perform public.relationship_pair_lock(conv.user_a,conv.user_b);
  peer := case when conv.user_a = me then conv.user_b else conv.user_a end;
  if not public.whisper_thread_allowed(p_conversation_id) then
    perform public.crushly_fail(403, '', 'Calling is not available in this conversation.');
  end if;
  -- Serialize per-caller creation to make the rate limit safe under concurrency.
  perform pg_advisory_xact_lock(me);
  if (select count(*) from public.call_rooms where caller_id = me and created_at > public.now_ms() - 60000) >= 5 then
    perform public.crushly_fail(429, '', 'Too many calls. Wait a minute and try again.');
  end if;
  delete from public.call_rooms where expires_at < public.now_ms() - 86400000;
  insert into public.call_rooms(channel, conversation_id, caller_id, callee_id) values(token, conv.id, me, peer);
  return token;
end $$;
commit;
