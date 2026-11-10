-- Disposable-only deletion experiment. NOT release-ready. Apply after 12 and 13.
begin;
create or replace function public.holup_delete_whisper(p_message_id bigint,p_everyone boolean default false) returns boolean
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id(); msg public.messages; c public.conversations;
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 select * into msg from public.messages where id=p_message_id;
 if not found then perform public.crushly_fail(404,'','Whisper not found.'); end if;
 select * into c from public.conversations where id=msg.conversation_id;
 if not found or me not in(c.user_a,c.user_b) then perform public.crushly_fail(404,'','Whisper not found.'); end if;
 perform public.holup_follow_pair_lock(c.user_a,c.user_b);
 select * into c from public.conversations where id=msg.conversation_id;
 select * into msg from public.messages where id=p_message_id;
 if not found or c.closed or public.is_blocked_pair(c.user_a,c.user_b) then perform public.crushly_fail(404,'','Whisper not found.'); end if;
 if p_everyone is null then perform public.crushly_fail(400,'','Choose how to delete.'); end if;
 if p_everyone then
  if msg.sender_id<>me then perform public.crushly_fail(403,'','Only the sender can delete for everyone.'); end if;
  -- Stored reply snapshots must not retain deleted content.
  update public.messages set meta=meta-'replyTo' where conversation_id=c.id and meta #>> '{replyTo,id}'=p_message_id::text;
  delete from public.messages where id=msg.id;
 else
  insert into public.hidden_whispers(message_id,user_id) values(msg.id,me) on conflict do nothing;
 end if;
 return true;
end $$;
revoke all on function public.holup_delete_whisper(bigint,boolean) from public,anon,authenticated;
grant execute on function public.holup_delete_whisper(bigint,boolean) to authenticated,service_role;

-- Supports removing deleted/hidden messages and their cached reply quotes
-- from currently open clients without granting raw message-table access.
create or replace function public.holup_visible_whisper_ids(p_conversation_id bigint,p_ids bigint[])
returns bigint[] language plpgsql stable security definer set search_path=public as $$
declare me bigint:=public.me_id(); c public.conversations;
begin
 if me is null or p_ids is null or cardinality(p_ids)>200 then
  perform public.crushly_fail(400,'','Invalid Whisper selection.'); end if;
 select * into c from public.conversations where id=p_conversation_id;
 if not found or me not in(c.user_a,c.user_b) or c.closed or public.is_blocked_pair(c.user_a,c.user_b) then
  perform public.crushly_fail(404,'','Whisper not found.'); end if;
 return array(select m.id from public.messages m where m.conversation_id=c.id and m.id=any(p_ids)
  and not exists(select 1 from public.hidden_whispers h where h.message_id=m.id and h.user_id=me));
end $$;
revoke all on function public.holup_visible_whisper_ids(bigint,bigint[]) from public,anon,authenticated;
grant execute on function public.holup_visible_whisper_ids(bigint,bigint[]) to authenticated,service_role;

create or replace function public.serialize_message(m public.messages, p_viewer bigint, p_show_receipts boolean)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', m.id,
    'conversationId', m.conversation_id,
    'senderId', m.sender_id,
    'mine', m.sender_id = p_viewer,
    'kind', m.kind,
    'body', m.body,
    'mediaUrl', m.media_url,
    'meta', case when coalesce(m.meta #>> '{replyTo,id}','') ~ '^[0-9]{1,18}$' and
      not exists(select 1 from public.messages target where target.id=(m.meta #>> '{replyTo,id}')::bigint
       and target.conversation_id=m.conversation_id and not exists
         (select 1 from public.hidden_whispers h where h.message_id=target.id and h.user_id=p_viewer))
      then m.meta - 'replyTo' else m.meta end,
    'createdAt', m.created_at,
    'readAt', case when m.sender_id = p_viewer and not p_show_receipts then null else m.read_at end,
    'deliveredAt', case when m.sender_id = p_viewer then m.delivered_at else null end,
    'reactions', coalesce((
      select jsonb_agg(jsonb_build_object('userId', r.user_id, 'kind', r.kind))
        from message_reactions r where r.message_id = m.id
    ), '[]'::jsonb)
  )
$$;

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
  if conv.closed or public.is_blocked_pair(me, peer) then
    perform public.crushly_fail(404, '', 'Conversation not found.');
  end if;
  show_receipts := public.receipts_visible(me, peer);

  if coalesce(p_after_id, 0) > 0 then
    select coalesce(jsonb_agg(public.serialize_message(m, me, show_receipts) order by m.id), '[]'::jsonb) into items
      from (select * from messages ms where ms.conversation_id = p_conversation_id and not exists(select 1 from public.hidden_whispers h where h.message_id=ms.id and h.user_id=me) and ms.id > p_after_id
            order by ms.id asc limit lim) m;
    has_more := false;
  elsif coalesce(p_before_id, 0) > 0 then
    select coalesce(jsonb_agg(public.serialize_message(m, me, show_receipts) order by m.id), '[]'::jsonb) into items
      from (select * from messages ms where ms.conversation_id = p_conversation_id and not exists(select 1 from public.hidden_whispers h where h.message_id=ms.id and h.user_id=me) and ms.id < p_before_id
            order by ms.id desc limit lim) m;
    has_more := jsonb_array_length(items) = lim;
  else
    select coalesce(jsonb_agg(public.serialize_message(m, me, show_receipts) order by m.id), '[]'::jsonb) into items
      from (select * from messages ms where ms.conversation_id = p_conversation_id and not exists(select 1 from public.hidden_whispers h where h.message_id=ms.id and h.user_id=me)
            order by ms.id desc limit lim) m;
    has_more := jsonb_array_length(items) = lim;
  end if;

  if show_receipts then
    select max(ms.id) into last_read_mine from messages ms
     where ms.conversation_id = p_conversation_id and ms.sender_id = me and ms.read_at is not null and not exists(select 1 from public.hidden_whispers h where h.message_id=ms.id and h.user_id=me);
  end if;

  return jsonb_build_object('items', items, 'hasMore', has_more, 'lastReadMine', last_read_mine);
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
       where m.conversation_id = c.id and not exists(select 1 from public.hidden_whispers h where h.message_id=m.id and h.user_id=me) order by m.id desc limit 1
    ),
    'unread', (
      select count(*)::int from messages m
       where m.conversation_id = c.id and m.sender_id <> me and m.read_at is null and not exists(select 1 from public.hidden_whispers h where h.message_id=m.id and h.user_id=me)
    ),
    'updatedAt', coalesce(c.last_message_at, c.created_at)
  ) order by coalesce(c.last_message_at, c.created_at) desc), '[]'::jsonb)
  into items
  from conversations c
  where (c.user_a = me or c.user_b = me) and not c.closed
    and not public.is_blocked_pair(me, case when c.user_a = me then c.user_b else c.user_a end);

  return jsonb_build_object('items', items);
end $$;

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
  select * into msg from messages ms where ms.id = p_message_id;
  if not found then
    perform public.crushly_fail(404, '', 'Message not found.');
  end if;
  select * into conv from conversations c where c.id = msg.conversation_id;
  if conv.user_a <> me and conv.user_b <> me then
    perform public.crushly_fail(404, '', 'Conversation not found.');
  end if;
  perform public.holup_follow_pair_lock(conv.user_a,conv.user_b);
  if conv.closed or public.is_blocked_pair(conv.user_a,conv.user_b) or not exists
    (select 1 from public.messages m where m.id=p_message_id and not exists
      (select 1 from public.hidden_whispers h where h.message_id=m.id and h.user_id=me)) then
    perform public.crushly_fail(404,'','Message not found.'); end if;
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
        and not c.closed and not exists (select 1 from public.hidden_whispers h where h.message_id=ms.id and h.user_id=me)
      limit 1;
    if not found and p_url is not null then
      select ms.* into msg from messages ms
        join conversations c on c.id = ms.conversation_id
        where ms.media_url = p_url and (c.user_a = me or c.user_b = me)
          and split_part(p_path, '/', 2) = ms.sender_id::text
        and not public.is_blocked_pair(c.user_a, c.user_b)
        and not c.closed and not exists (select 1 from public.hidden_whispers h where h.message_id=ms.id and h.user_id=me)
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

create or replace function public.holup_can_see_whisper_reaction(p_message_id bigint) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.messages m join public.conversations c on c.id=m.conversation_id
  join public.holup_whisper_permissions p on p.conversation_id=c.id
  where m.id=p_message_id and public.me_id() in(c.user_a,c.user_b) and not c.closed
  and p.state in ('pending','accepted') and not public.is_blocked_pair(c.user_a,c.user_b)
  and not exists(select 1 from public.hidden_whispers h where h.message_id=m.id and h.user_id=public.me_id()));
$$;
commit;
