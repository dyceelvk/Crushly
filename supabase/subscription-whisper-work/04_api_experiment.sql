-- ISOLATED EXPERIMENT ONLY: never apply to production. Requires 01_experiment.sql.
-- This integrates the real Whisper RPCs for disposable tests. It intentionally
-- disables new live Whisper/call joins until revocation can be enforced.
begin;
create or replace function public.whisper_thread_allowed(p_conversation_id bigint) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.conversations c join public.v3_whisper_permissions p on p.conversation_id=c.id
   where c.id=p_conversation_id and public.me_id() in (c.user_a,c.user_b)
     and not c.closed and not public.is_blocked_pair(c.user_a,c.user_b) and p.state in ('pending','accepted'))
$$;
revoke all on function public.whisper_thread_allowed(bigint) from public,anon,authenticated;
grant execute on function public.whisper_thread_allowed(bigint) to authenticated,service_role;
create or replace function public.v3_whisper_accepted(p_conversation_id bigint) returns boolean
language sql stable security definer set search_path=public as $$
 select public.whisper_thread_allowed(p_conversation_id) and exists(select 1 from public.v3_whisper_permissions p
  where p.conversation_id=p_conversation_id and p.state='accepted')
$$;
revoke all on function public.v3_whisper_accepted(bigint) from public,anon,authenticated;
grant execute on function public.v3_whisper_accepted(bigint) to authenticated,service_role;

create or replace function public.messaging_block_reason(p_viewer bigint,p_target bigint) returns text
language plpgsql stable security definer set search_path=public as $$
begin
 if p_viewer is null or p_target is null or p_viewer=p_target then return 'You can’t message yourself.'; end if;
 if public.is_blocked_pair(p_viewer,p_target) then return 'This member is no longer available.'; end if;
 return null; -- the pair-scoped request guard enforces the message quota
end $$;

create or replace function public.ensure_conversation(a bigint,b bigint) returns bigint
language plpgsql security definer set search_path=public as $$
begin
 if public.me_id() is null or public.me_id()<>a then perform public.crushly_fail(404,'','Whisper unavailable.'); end if;
 return (public.v3_begin_whisper_request(b)->>'id')::bigint;
end $$;

create or replace function public.open_conversation(p_target_id bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 result:=public.v3_begin_whisper_request(p_target_id);
 return result || jsonb_build_object('peer',public.peer_summary(p_target_id,public.me_id()) || case when result->>'state'='pending' then jsonb_build_object('online',null) else '{}'::jsonb end);
end $$;



create or replace function public.whisper_can_read(p_id bigint) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.messages m where m.id=p_id
    and public.whisper_thread_allowed(m.conversation_id)
    and not exists(select 1 from public.hidden_whispers h where h.message_id=m.id and h.user_id=public.me_id()))
$$;


revoke all on function public.whisper_can_read(bigint) from public,anon,authenticated;
grant execute on function public.whisper_can_read(bigint) to authenticated,service_role;
drop policy if exists conversations_pair on public.conversations;
create policy conversations_pair on public.conversations for select to authenticated using(public.whisper_thread_allowed(id));
drop policy if exists messages_pair on public.messages;
create policy messages_pair on public.messages for select to authenticated using(public.whisper_can_read(id));
revoke select on public.messages from public,anon,authenticated;
revoke select (read_at,delivered_at) on public.messages from public,anon,authenticated;
grant select (id,conversation_id,sender_id,kind,body,media_url,meta,created_at) on public.messages to authenticated;
drop policy if exists message_reactions_pair on public.message_reactions;
create policy message_reactions_pair on public.message_reactions for select to authenticated using(public.whisper_can_read(message_id));


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


create or replace function public.load_conversation(p_conversation_id bigint) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare me bigint:=public.me_id(); c public.conversations; p public.v3_whisper_permissions; peer bigint; open_now boolean; capped boolean;
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 if not public.whisper_thread_allowed(p_conversation_id) then perform public.crushly_fail(404,'','Conversation not found.'); end if;
 select * into c from public.conversations where id=p_conversation_id;
 select * into p from public.v3_whisper_permissions where conversation_id=c.id;
 peer:=case when c.user_a=me then c.user_b else c.user_a end;
 select v3_whisper_open into open_now from public.privacy where user_id=p.recipient_id;
 capped:=p.state='pending' and p.requester_id=me and p.request_messages>=2 and not coalesce(open_now,false);
 return jsonb_build_object('id',c.id,'closed',false,'peer',public.peer_summary(peer,me) || case when p.state='pending' then jsonb_build_object('online',null) else '{}'::jsonb end,'canSend',not capped,
   'blockReason',case when capped then 'Wait for this Whisper request to be accepted.' else null end,
   'requestState',p.state,'isIncomingRequest',p.state='pending' and p.recipient_id=me and p.request_messages>0,
   'requestMessages',p.request_messages,'requestLimit',2);
end $$;

create or replace function public.list_conversations() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare me bigint:=public.me_id(); result jsonb;
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,
   'peer',public.peer_summary(case when c.user_a=me then c.user_b else c.user_a end,me) || case when p.state='pending' then jsonb_build_object('online',null) else '{}'::jsonb end,
   'lastMessage',(select public.serialize_message(m,me,false) from public.messages m where m.conversation_id=c.id
     and not exists(select 1 from public.hidden_whispers h where h.message_id=m.id and h.user_id=me) order by m.id desc limit 1),
   'unread',(select count(*)::int from public.messages m where m.conversation_id=c.id and m.sender_id<>me and m.read_at is null
     and not exists(select 1 from public.hidden_whispers h where h.message_id=m.id and h.user_id=me)),
   'updatedAt',coalesce(c.last_message_at,c.created_at), 'requestState',p.state,
   'isIncomingRequest',p.state='pending' and p.recipient_id=me and p.request_messages>0)
   order by coalesce(c.last_message_at,c.created_at) desc),'[]'::jsonb) into result
  from public.conversations c join public.v3_whisper_permissions p on p.conversation_id=c.id
  where public.whisper_thread_allowed(c.id);
 return jsonb_build_object('items',result);
end $$;

-- Request inbox exposes only the authenticated recipient's pending requests.
create or replace function public.v3_whisper_request_list(p_offset integer default 0,p_limit integer default 40) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare me bigint:=public.me_id(); result jsonb; lim int:=least(greatest(coalesce(p_limit,40),1),100); off int:=greatest(coalesce(p_offset,0),0);
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 with page as (
   select c.id,c.last_message_at,c.created_at,p.requester_id from public.conversations c
   join public.v3_whisper_permissions p on p.conversation_id=c.id
   where p.state='pending' and p.recipient_id=me and p.request_messages>0 and public.whisper_thread_allowed(c.id)
   order by coalesce(c.last_message_at,c.created_at) desc,c.id desc offset off limit lim+1
 ) select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,
     'peer',public.peer_summary(x.requester_id,me) || jsonb_build_object('online',null),'updatedAt',coalesce(x.last_message_at,x.created_at))
     order by coalesce(x.last_message_at,x.created_at) desc,x.id desc)
     from (select * from page order by coalesce(last_message_at,created_at) desc,id desc limit lim) x),'[]'::jsonb),
   'hasMore',(select count(*)>lim from page)) into result;
 return result;
end $$;
revoke all on function public.v3_whisper_request_list(integer,integer) from public,anon,authenticated;
grant execute on function public.v3_whisper_request_list(integer,integer) to authenticated,service_role;


create or replace function public.toggle_message_reaction(p_message_id bigint,p_kind text default 'crush') returns jsonb
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id(); msg public.messages; conv public.conversations; peer bigint; existing_kind text;
begin
  if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
  select * into msg from public.messages where id=p_message_id
    and not exists(select 1 from public.hidden_whispers h where h.message_id=p_message_id and h.user_id=me);
  if not found then perform public.crushly_fail(404,'','Message not found.'); end if;
  select * into conv from public.conversations where id=msg.conversation_id;
  if not found or (conv.user_a<>me and conv.user_b<>me) then perform public.crushly_fail(404,'','Conversation not found.'); end if;
  perform public.v3_pair_lock(conv.user_a,conv.user_b);
  select * into conv from public.conversations where id=msg.conversation_id;
  if not found or not public.v3_whisper_accepted(conv.id) then
    perform public.crushly_fail(403,'messaging_restricted','Keep Close approval is required to interact.'); end if;
  peer:=case when conv.user_a=me then conv.user_b else conv.user_a end;
  if coalesce(p_kind,'crush') not in ('crush','laugh','fire','wow') then p_kind:='crush'; end if;
  select kind into existing_kind from public.message_reactions where message_id=msg.id and user_id=me;
  if existing_kind=p_kind then delete from public.message_reactions where message_id=msg.id and user_id=me;
  else insert into public.message_reactions(message_id,user_id,kind) values(msg.id,me,p_kind)
    on conflict(message_id,user_id) do update set kind=excluded.kind,created_at=public.now_ms(); end if;
  return (select public.serialize_message(m,me,public.receipts_visible(me,peer)) from public.messages m where m.id=msg.id);
end $$;


-- Immediate Add Up follows, independent of Keep Close and Whispers.
create or replace function public.crush_member(p_target_id bigint,p_is_deep boolean default false,p_note text default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id(); was_active boolean; was_deep boolean; used integer; target record; clean_note text;
begin
  if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
  if p_target_id is null or p_target_id=me then perform public.crushly_fail(400,'','You can’t add yourself up.'); end if;
  perform public.v3_pair_lock(me,p_target_id);
  if public.is_blocked_pair(me,p_target_id) or public.load_visible_profile(me,p_target_id,false) is null then
    perform public.crushly_fail(404,'','Space not available.'); end if;
  select p.name,pr.who_can_crush into target from public.profiles p join public.privacy pr on pr.user_id=p.id where p.id=p_target_id;
  if target.who_can_crush='verified' and not exists(select 1 from public.profiles where id=me and verification='verified') then
    perform public.crushly_fail(403,'verification_required',target.name || ' only accepts Add Ups from verified members.'); end if;
  was_active:=exists(select 1 from public.crushes where from_id=me and to_id=p_target_id and status in ('pending','accepted'));
  was_deep:=exists(select 1 from public.crushes where from_id=me and to_id=p_target_id and status in ('pending','accepted') and deep);
  if coalesce(p_is_deep,false) and not was_deep then
    select count(*) into used from public.crushes where from_id=me and deep and created_at>public.now_ms()-86400000::bigint;
    if used>=3 then perform public.crushly_fail(429,'deep_limit','You’ve sent your 3 Big Ups for today.'); end if;
  end if;
  clean_note:=case when btrim(coalesce(p_note,''))='' then null else left(btrim(p_note),140) end;
  insert into public.crushes(from_id,to_id,deep,note,status,created_at,responded_at)
    values(me,p_target_id,coalesce(p_is_deep,false),clean_note,'pending',public.now_ms(),null)
    on conflict(from_id,to_id) do update set status='pending',deep=excluded.deep,note=excluded.note,
      created_at=case when crushes.status in ('pending','accepted') then crushes.created_at else excluded.created_at end,responded_at=null;
  delete from public.passes where from_id=me and to_id=p_target_id;
  if not was_active then perform public.notify_to(p_target_id,'crush',me,null,''); end if;
  return jsonb_build_object('mutual',false,'isNew',not was_active,'request','following','profile',public.load_visible_profile(me,p_target_id,false));
end $$;

create or replace function public.uncrush_member(p_target_id bigint) returns boolean
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id();
begin
  if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
  if p_target_id is null or p_target_id=me then perform public.crushly_fail(400,'','Invalid member.'); end if;
  perform public.v3_pair_lock(me,p_target_id);
  delete from public.crushes where from_id=me and to_id=p_target_id;
  delete from public.notifications where user_id=p_target_id and actor_id=me and kind in ('crush','deep_crush') and read_at is null;
  return true;
end $$;

-- Active follow status must not be mistaken for a pending approval.
create or replace function public.public_profile(p_viewer bigint, p_target bigint, p_full boolean default false)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  r record;
  v record;
  interests jsonb;
  intentions jsonb;
  shared_interests jsonb;
  km double precision;
  my_deep boolean;
  my_note text;
  my_found boolean;
  their_deep boolean;
  their_note text;
  their_found boolean;
  my_status text;
  my_responded bigint;
  their_status text;
  connected boolean;
  can_see_online boolean;
  can_see_activity boolean;
  result jsonb;
begin
  select p.*, pr.show_distance, pr.show_online, pr.show_activity, pr.discoverable,
         pr.profile_visibility, pr.who_can_message, pr.who_can_crush, pr.show_age,
         pr.show_city, pr.incognito
    into r
    from profiles p join privacy pr on pr.user_id = p.id
   where p.id = p_target;
  if not found then
    return null;
  end if;

  select p.lat, p.lng, p.interests, p.intentions, p.verification, pr.show_online, pr.show_activity
    into v
    from profiles p join privacy pr on pr.user_id = p.id
   where p.id = p_viewer;

  interests := coalesce(r.interests, '[]'::jsonb);
  intentions := coalesce(r.intentions, '[]'::jsonb);
  km := public.distance_km(v.lat, v.lng, r.lat, r.lng);
  connected := public.is_connected_pair(p_viewer, p_target);

  select c.deep, c.note, c.status, c.responded_at into my_deep, my_note, my_status, my_responded
    from crushes c where c.from_id = p_viewer and c.to_id = p_target;
  my_found := found;
  select c.deep, c.note, c.status into their_deep, their_note, their_status
    from crushes c where c.from_id = p_target and c.to_id = p_viewer;
  their_found := found;

  /*
   * Two different questions, so two different answers.
   *
   * The dot means "they are here right now"; the label means "they were here at
   * 14:20". Somebody may be happy to be seen online while not wanting to hand
   * out a log of when they were last around — which is why `show_activity` is
   * its own switch and both sides have to allow it, exactly like `show_online`.
   */
  can_see_online := r.show_online and coalesce(v.show_online, true);
  can_see_activity := can_see_online and r.show_activity and coalesce(v.show_activity, true);

  select coalesce(jsonb_agg(i), '[]'::jsonb) into shared_interests
    from jsonb_array_elements_text(interests) i
   where i in (select jsonb_array_elements_text(coalesce(v.interests, '[]'::jsonb)));

  result := jsonb_build_object(
    'id', r.id,
    'name', r.name,
    'username', nullif(r.username, ''),
    'age', case when r.show_age then public.age_of(r.birthdate) else null end,
    'pronouns', nullif(r.pronouns, ''),
    'city', case when r.show_city then nullif(r.city, '') else null end,
    'verified', r.verification = 'verified',
    -- Which seal, if any. 'verified' is the ordinary one, 'gold' is earned,
    -- 'diamond' belongs to the company account alone.
    'badgeTier', case
      when r.badge_tier = 'diamond' then 'diamond'
      when r.badge_tier = 'gold' then 'gold'
      when r.verification = 'verified' then 'verified'
      else 'none'
    end,
    -- Keep Close, read from this viewer's side: are they keeping you close?
    'keepsYou', exists (select 1 from keeps k where k.keeper_id = p_target and k.kept_id = p_viewer),
    'distance', case when r.show_distance then public.distance_label(km) else null end,
    'online', case when can_see_online then public.is_online_at(r.last_active_at) else null end,
    'activity', case when can_see_activity then public.activity_label_at(r.last_active_at) else null end,
    'bio', r.bio,
    'intentions', intentions,
    'relationshipIntention', nullif(r.relationship_intention, ''),
    'interests', interests,
    'sharedInterests', shared_interests,
    'photos', public.photos_of(p_target),
    -- Add Up booleans mean an active one-way follow, independent of Keep Close.
    'crush', jsonb_build_object(
      'sent', my_found and my_status in ('pending', 'accepted'),
      'sentStatus', my_status,
      'sentDeep', coalesce(my_deep, false),
      'received', their_found and their_status in ('pending', 'accepted'),
      'receivedStatus', their_status,
      'receivedDeep', coalesce(their_deep, false),
      'note', case when their_found and their_status in ('pending', 'accepted') then their_note else null end,
      'respondedAt', my_responded,
      'mutual', connected
    ),
    'canMessage', public.messaging_block_reason(p_viewer, p_target) is null,
    'acceptsCrushes', r.who_can_crush <> 'verified' or (v.verification = 'verified'),
    -- The ring. True only when there is a live Moment THIS viewer may open.
    'hasMoment', exists (
      select 1 from moments m
       where m.user_id = p_target
         and m.expires_at > public.now_ms()
         and public.can_view_moment(m, p_viewer)
    )
  );

  if p_full then
    result := result || jsonb_build_object(
      'languages', coalesce(r.languages, '[]'::jsonb),
      'lifestyle', coalesce(r.lifestyle, '{}'::jsonb),
      'messageBlockReason', public.messaging_block_reason(p_viewer, p_target)
    );
  end if;
  return result;
end $function$;

-- The owner-selected Close audience for Add Up identities consists of people
-- who Keep the owner Close, regardless of whether the owner Keeps them back.
create or replace function public.space_relationship_stats(p_target_id bigint) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare me bigint:=public.me_id(); visibility text; close_stats jsonb;
begin
  if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
  close_stats:=public.v3_keep_stats(p_target_id); -- also verifies Space and block visibility
  select add_up_list_visibility into visibility from public.privacy where user_id=p_target_id;
  return jsonb_build_object(
    'addUps',(select count(*) from public.crushes c join public.profiles p on p.id=c.from_id
      where c.to_id=p_target_id and c.status in ('pending','accepted') and p.onboarded and p.status='active'
        and not public.is_blocked_pair(c.from_id,p_target_id)),
    'keptClose',close_stats->'keptClose',
    'canViewAddUps',me=p_target_id or visibility='everyone' or (visibility='close' and (close_stats->>'canViewKeptClose')::boolean),
    'canViewKeptClose',close_stats->'canViewKeptClose',
    'addUpVisibility',case when me=p_target_id then visibility else null end
  );
end $$;

create or replace function public.space_relationship_people(p_target_id bigint,p_kind text,p_offset integer default 0,p_limit integer default 40)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare me bigint:=public.me_id(); stats jsonb; result jsonb; lim int:=least(greatest(coalesce(p_limit,40),1),100); off int:=greatest(coalesce(p_offset,0),0);
begin
  if p_kind is null or p_kind not in ('addUps','keptClose') then perform public.crushly_fail(400,'','Unknown list.'); end if;
  stats:=public.space_relationship_stats(p_target_id);
  if p_kind='keptClose' then return public.v3_kept_close_people(p_target_id,p_offset,p_limit); end if;
  if not (stats->>'canViewAddUps')::boolean then perform public.crushly_fail(403,'','This list is private.'); end if;
  with readable as (
    select c.from_id as person,c.created_at as at,public.relationship_list_profile(me,c.from_id) as member
    from public.crushes c join public.profiles p on p.id=c.from_id
    where c.to_id=p_target_id and c.status in ('pending','accepted') and p.onboarded and p.status='active'
      and not public.is_blocked_pair(p_target_id,c.from_id) and not public.is_blocked_pair(me,c.from_id)
  ), page as (select * from readable where member is not null order by at desc,person desc offset off limit lim+1)
  select jsonb_build_object('items',coalesce((select jsonb_agg(member order by at desc,person desc)
    from (select * from page order by at desc,person desc limit lim) x),'[]'::jsonb),
    'hasMore',(select count(*)>lim from page)) into result;
  return result;
end $$;

-- Owner's outgoing subscriptions, with the same profile/block visibility as
-- the subscription hub. Never return a hidden Space via public_profile alone.
create or replace function public.close_ones(p_limit integer default 50,p_after bigint default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare me bigint:=public.me_id(); result jsonb; lim integer:=least(greatest(coalesce(p_limit,50),1),100);
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 with readable as (
   select k.kept_id,k.created_at,public.relationship_list_profile(me,k.kept_id) as member,
     exists(select 1 from public.keeps k2 where k2.keeper_id=k.kept_id and k2.kept_id=me) as mutual
   from public.keeps k where k.keeper_id=me and not public.is_blocked_pair(me,k.kept_id)
     and (p_after is null or (k.created_at,k.kept_id)<(select k2.created_at,k2.kept_id from public.keeps k2 where k2.keeper_id=me and k2.kept_id=p_after))
 ), page as (select * from readable where member is not null order by created_at desc,kept_id desc limit lim)
 select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object('member',member,'keepsYou',mutual,'keptAt',created_at) order by created_at desc,kept_id desc),'[]'::jsonb)) into result from page;
 return result;
end $$;

-- Paged subscription hub for the signed-in member only.
create or replace function public.v3_keep_people(p_direction text,p_offset integer default 0,p_limit integer default 40) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare me bigint:=public.me_id(); result jsonb; lim int:=least(greatest(coalesce(p_limit,40),1),100); off int:=greatest(coalesce(p_offset,0),0);
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 if p_direction is null or p_direction not in ('incoming','outgoing','mutual') then perform public.crushly_fail(400,'','Unknown list.'); end if;
 with ids as (
  select case when p_direction='incoming' then k.keeper_id else k.kept_id end as person,k.created_at as at
  from public.keeps k where
    ((p_direction='incoming' and k.kept_id=me) or (p_direction in ('outgoing','mutual') and k.keeper_id=me))
    and (p_direction<>'mutual' or exists(select 1 from public.keeps k2 where k2.keeper_id=k.kept_id and k2.kept_id=me))
 ), readable as (
  select person,at,public.relationship_list_profile(me,person) as profile from ids where not public.is_blocked_pair(me,person)
 ), page as (select * from readable where profile is not null order by at desc,person desc offset off limit lim+1)
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('profile',profile,'at',at) order by at desc,person desc)
   from (select * from page order by at desc,person desc limit lim) q),'[]'::jsonb),'hasMore',(select count(*)>lim from page)) into result;
 return result;
end $$;
revoke all on function public.v3_keep_people(text,integer,integer) from public,anon,authenticated;
grant execute on function public.v3_keep_people(text,integer,integer) to authenticated,service_role;

-- No typing, presence, read or delivery signal before explicit/reply/open consent.
-- New joins are disabled until already-active sockets can be force-revoked.
create or replace function public.can_join_whisper(p_topic text) returns boolean
language sql stable security definer set search_path=public as $$ select false $$;
create or replace function public.can_join_call(p_channel text) returns boolean
language sql stable security definer set search_path=public as $$ select false $$;
create or replace function public.register_call_room(p_conversation_id bigint) returns text
language plpgsql security definer set search_path=public as $$
begin perform public.crushly_fail(403,'disabled','Calls are currently unavailable.'); return null; end $$;


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
  if not public.v3_whisper_accepted(p_conversation_id) then
    return jsonb_build_object('peerId',peer,'online',null,'activity',null,'receipts',false,'announce',false,'closed',false);
  end if;

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

create or replace function public.mark_messages_delivered(p_conversation_id bigint,p_up_to_id bigint default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id(); c public.conversations; ceiling_id bigint; stamped int; highest bigint;
begin
  if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
  select * into c from public.conversations where id=p_conversation_id;
  if not found or (c.user_a<>me and c.user_b<>me) then perform public.crushly_fail(404,'','Conversation not found.'); end if;
  perform public.v3_pair_lock(c.user_a,c.user_b);
  if not public.whisper_thread_allowed(p_conversation_id) then perform public.crushly_fail(404,'','Conversation not found.'); end if;
  if not public.v3_whisper_accepted(p_conversation_id) then return jsonb_build_object('upTo',0,'count',0); end if;
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
  perform public.v3_pair_lock(c.user_a,c.user_b);
  if not public.whisper_thread_allowed(p_conversation_id) then perform public.crushly_fail(404,'','Conversation not found.'); end if;
  if not public.v3_whisper_accepted(p_conversation_id) then
    update public.notifications set read_at=public.now_ms() where user_id=me and kind in ('message','moment_reply') and ref_id=p_conversation_id and read_at is null;
    return true;
  end if;
  update public.messages ms set delivered_at=coalesce(ms.delivered_at,public.now_ms()),read_at=coalesce(ms.read_at,public.now_ms())
   where ms.conversation_id=p_conversation_id and ms.sender_id<>me and (ms.delivered_at is null or ms.read_at is null)
     and not exists(select 1 from public.hidden_whispers h where h.message_id=ms.id and h.user_id=me);
  update public.notifications set read_at=public.now_ms() where user_id=me and kind in ('message','moment_reply') and ref_id=p_conversation_id and read_at is null;
  return true;
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


commit;
