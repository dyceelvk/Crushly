-- Per-member hide and sender-only removal of a Whisper.
-- Server authorization and content revocation are independent of the client UI.
create table if not exists public.hidden_whispers (
  message_id bigint not null references public.messages(id) on delete cascade,
  user_id bigint not null references public.profiles(id) on delete cascade,
  primary key(message_id,user_id)
);
alter table public.hidden_whispers enable row level security;
revoke all on public.hidden_whispers from public, anon, authenticated;

create or replace function public.whisper_can_read(p_id bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.messages m join public.conversations c on c.id=m.conversation_id
    where m.id=p_id and (c.user_a=public.me_id() or c.user_b=public.me_id())
      and not public.is_blocked_pair(c.user_a,c.user_b)
      and not exists(select 1 from public.hidden_whispers h where h.message_id=m.id and h.user_id=public.me_id()))
$$;
revoke all on function public.whisper_can_read(bigint) from public, anon, authenticated;
grant execute on function public.whisper_can_read(bigint) to authenticated, service_role;

drop policy if exists messages_pair on public.messages;
create policy messages_pair on public.messages for select to authenticated using (public.whisper_can_read(id));

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
  where (c.user_a = me or c.user_b = me) and not c.closed
    and not public.is_blocked_pair(me, case when c.user_a = me then c.user_b else c.user_a end);

  return jsonb_build_object('items', items);
end $$;

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
  if public.is_blocked_pair(me, peer) then
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

create or replace function public.toggle_message_reaction(p_message_id bigint, p_kind text default 'crush')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  msg record;
  conv record;
  existing_kind text;
  peer bigint;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  select * into msg from messages ms where ms.id = p_message_id and not exists (select 1 from public.hidden_whispers h where h.message_id=ms.id and h.user_id=me);
  if not found then
    perform public.crushly_fail(404, '', 'Message not found.');
  end if;
  select * into conv from conversations c where c.id = msg.conversation_id;
  if conv.user_a <> me and conv.user_b <> me then
    perform public.crushly_fail(404, '', 'Conversation not found.');
  end if;
  peer := case when conv.user_a = me then conv.user_b else conv.user_a end;
  if coalesce(p_kind, 'crush') not in ('crush', 'laugh', 'fire', 'wow') then
    p_kind := 'crush';
  end if;
  select r.kind into existing_kind from message_reactions r
   where r.message_id = msg.id and r.user_id = me;
  if existing_kind = p_kind then
    delete from message_reactions r where r.message_id = msg.id and r.user_id = me;
  else
    insert into message_reactions (message_id, user_id, kind) values (msg.id, me, p_kind)
    on conflict (message_id, user_id) do update set kind = excluded.kind, created_at = public.now_ms();
  end if;
  return (
    select public.serialize_message(m, me, public.receipts_visible(me, peer))
      from messages m where m.id = msg.id
  );
end $$;

-- ---------------------------------------------------------------- moments

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
        and not public.is_blocked_pair(c.user_a, c.user_b)
        and not exists (select 1 from public.hidden_whispers h where h.message_id=ms.id and h.user_id=me)
      limit 1;
    if not found and p_url is not null then
      select ms.* into msg from messages ms
        join conversations c on c.id = ms.conversation_id
        where ms.media_url = p_url and (c.user_a = me or c.user_b = me)
          and split_part(p_path, '/', 2) = ms.sender_id::text
        and not public.is_blocked_pair(c.user_a, c.user_b)
          and not exists (select 1 from public.hidden_whispers h where h.message_id=ms.id and h.user_id=me)
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


-- Hold a key lock on a quoted message while inserting a reply. This makes the
-- scrub below safe even when a reply races a deletion.
create or replace function public.whisper_reply_guard() returns trigger
language plpgsql security definer set search_path=public as $$
declare target bigint; found_id bigint;
begin
  if coalesce(new.meta #>> '{replyTo,id}', '') ~ '^[0-9]{1,18}$' then
    target := (new.meta #>> '{replyTo,id}')::bigint;
    select m.id into found_id from public.messages m where m.id=target and m.conversation_id=new.conversation_id for key share;
    if found_id is null or exists(select 1 from public.hidden_whispers h where h.message_id=target and h.user_id=new.sender_id) then
      new.meta := new.meta - 'replyTo';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.whisper_reply_guard() from public, anon, authenticated;
drop trigger if exists whisper_reply_guard on public.messages;
create trigger whisper_reply_guard before insert on public.messages for each row execute function public.whisper_reply_guard();

create or replace function public.delete_whisper(p_message_id bigint, p_everyone boolean default false) returns boolean
language plpgsql security definer set search_path=public as $$
declare me bigint := public.me_id(); m public.messages; c public.conversations;
begin
  if me is null then perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.'); end if;
  if p_everyone is null then perform public.crushly_fail(400, '', 'Choose how to delete.'); end if;
  select * into m from public.messages where id=p_message_id for update;
  if not found then perform public.crushly_fail(404, '', 'Whisper not found.'); end if;
  select * into c from public.conversations where id=m.conversation_id;
  if not found or (c.user_a<>me and c.user_b<>me) or public.is_blocked_pair(c.user_a,c.user_b) then
    perform public.crushly_fail(404, '', 'Whisper not found.');
  end if;
  if p_everyone then
    if m.sender_id<>me then perform public.crushly_fail(403, '', 'Only the sender can delete for everyone.'); end if;
    -- Replies carry a snapshot of the old text: scrub it before removing the row.
    update public.messages set meta=jsonb_set(meta, '{replyTo,preview}', to_jsonb('Whisper deleted'::text))
      where conversation_id=m.conversation_id and meta #>> '{replyTo,id}' = m.id::text;
    -- Notifications do not identify individual messages, so conservatively clear
    -- previews for this sender and thread; already-delivered pushes cannot be recalled.
    update public.notifications set body='Whisper' where kind='message' and actor_id=me and ref_id=m.conversation_id;
    delete from public.messages where id=m.id;
  else
    insert into public.hidden_whispers(message_id,user_id) values(m.id,me) on conflict do nothing;
    update public.notifications set body='Whisper' where kind='message' and user_id=me and actor_id=m.sender_id and ref_id=m.conversation_id;
  end if;
  return true;
end $$;
revoke all on function public.delete_whisper(bigint,boolean) from public, anon, authenticated;
grant execute on function public.delete_whisper(bigint,boolean) to authenticated, service_role;

-- Refresh already loaded messages, including removals and redacted reply quotes.
create or replace function public.sync_whispers(p_conversation_id bigint, p_ids bigint[]) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare me bigint:=public.me_id(); c public.conversations; peer bigint;
begin
  if me is null then perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.'); end if;
  if coalesce(array_length(p_ids,1),0)>500 then perform public.crushly_fail(400, '', 'Too many messages.'); end if;
  select * into c from public.conversations where id=p_conversation_id;
  if not found or (c.user_a<>me and c.user_b<>me) or public.is_blocked_pair(c.user_a,c.user_b) then
    perform public.crushly_fail(404, '', 'Conversation not found.'); end if;
  peer := case when c.user_a=me then c.user_b else c.user_a end;
  return coalesce((select jsonb_agg(public.serialize_message(m,me,public.receipts_visible(me,peer)) order by m.id)
    from public.messages m where m.conversation_id=c.id and m.id=any(p_ids)
      and not exists(select 1 from public.hidden_whispers h where h.message_id=m.id and h.user_id=me)), '[]'::jsonb);
end $$;
revoke all on function public.sync_whispers(bigint,bigint[]) from public, anon, authenticated;
grant execute on function public.sync_whispers(bigint,bigint[]) to authenticated, service_role;
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
       where (c.user_a = me or c.user_b = me) and not c.closed
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

notify pgrst, 'reload schema';
