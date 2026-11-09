-- EXPERIMENT ONLY: not a deployable migration. The clients, notification routing,
-- every Whisper read/media/realtime path, and compatibility gate must be
-- completed and audited before this is moved into migrations/.
-- Applied only to a disposable database by the relationship-work tests.
-- All conversion and function replacements are atomic; writers cannot alter
-- the legacy tables partway through the snapshot. Production rollout still
-- needs a maintenance window, client gate, and tested rollback strategy.
begin;
lock table public.blocks,public.connections,public.keeps,public.crushes,public.conversations in share row exclusive mode;

create table if not exists public.keep_close_requests (
  requester_id bigint not null references public.profiles(id) on delete cascade,
  recipient_id bigint not null references public.profiles(id) on delete cascade,
  state text not null default 'pending' check (state in ('pending','accepted','declined','cancelled')),
  created_at bigint not null default public.now_ms(),
  answered_at bigint,
  primary key (requester_id, recipient_id),
  check (requester_id <> recipient_id)
);
create index if not exists keep_close_requests_recipient_idx on public.keep_close_requests (recipient_id,created_at desc) where state='pending';
alter table public.keep_close_requests enable row level security;
revoke all on public.keep_close_requests from public, anon, authenticated;
-- Deliberately no direct writes, and no raw relationship rows readable by a
-- nonparticipant. The UI uses narrowly scoped security-definer RPCs.

create table if not exists public.relationship_migration_markers (name text primary key);
alter table public.relationship_migration_markers enable row level security;
revoke all on public.relationship_migration_markers from public, anon, authenticated;

do $$
begin
  if not exists(select 1 from public.relationship_migration_markers where name='keep-close-approval-v1') then
    -- An existing connection is already approved. A legacy one-way keep is NOT.
    insert into public.keep_close_requests(requester_id,recipient_id,state,created_at)
      select k.keeper_id,k.kept_id,'pending',k.created_at from public.keeps k
      where not public.is_connected_pair(k.keeper_id,k.kept_id)
        and not public.is_blocked_pair(k.keeper_id,k.kept_id)
      on conflict do nothing;
    delete from public.keeps;
    -- Preserve the compatibility table as approved relationships only.
    insert into public.keeps(keeper_id,kept_id,created_at)
      select user_a,user_b,created_at from public.connections
      union all select user_b,user_a,created_at from public.connections
      on conflict do nothing;
    -- Legacy permissive privacy could have opened a conversation with no
    -- connection. Close it during the same conversion; retain history.
    update public.conversations c set closed=true
      where not public.is_connected_pair(c.user_a,c.user_b) or public.is_blocked_pair(c.user_a,c.user_b);
    insert into public.relationship_migration_markers(name) values('keep-close-approval-v1');
  end if;
end $$;

-- Pair-scoped transaction lock serializes requests, decisions, removals, and
-- block triggers, including a direct RLS-authorized INSERT into blocks.
create or replace function public.relationship_pair_lock(a bigint,b bigint) returns void
language sql volatile security definer set search_path=public as $$
  select pg_advisory_xact_lock(hashtextextended('holup-relationship:' || least(a,b)::text || ':' || greatest(a,b)::text,0))
$$;
revoke all on function public.relationship_pair_lock(bigint,bigint) from public,anon,authenticated;

create or replace function public.keep_state(p_member_id bigint) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare me bigint:=public.me_id(); connected boolean; outgoing boolean; incoming boolean; n bigint;
begin
  if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
  if p_member_id is null or me=p_member_id or public.is_blocked_pair(me,p_member_id) then
    return jsonb_build_object('keeps',false,'keepsYou',false,'keepsCount',0,'keptByCount',0,'self',me=p_member_id,'outgoing',false,'incoming',false);
  end if;
  if public.load_visible_profile(me,p_member_id,false) is null then perform public.crushly_fail(404,'','Space not available.'); end if;
  connected:=public.is_connected_pair(me,p_member_id);
  outgoing:=exists(select 1 from public.keep_close_requests where requester_id=me and recipient_id=p_member_id and state='pending');
  incoming:=exists(select 1 from public.keep_close_requests where requester_id=p_member_id and recipient_id=me and state='pending');
  select count(*) into n from public.connections c where c.user_a=p_member_id or c.user_b=p_member_id;
  return jsonb_build_object('keeps',connected,'keepsYou',connected,'keepsCount',n,'keptByCount',n,'self',false,'outgoing',outgoing,'incoming',incoming);
end $$;

-- Sending an ask is NEVER an implicit acceptance, even if an ask exists in the
-- opposite direction. Only recipient's explicit accept RPC can create a pair.
create or replace function public.keep_close(p_member_id bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id(); n int; last_decline bigint; inserted int;
begin
  if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
  if p_member_id is null or me=p_member_id then perform public.crushly_fail(400,'','You can’t keep yourself close.'); end if;
  perform public.relationship_pair_lock(me,p_member_id);
  if public.is_blocked_pair(me,p_member_id) or public.load_visible_profile(me,p_member_id,false) is null then
    perform public.crushly_fail(404,'','Space not available.'); end if;
  if public.is_connected_pair(me,p_member_id) then return public.keep_state(p_member_id); end if;
  if exists(select 1 from public.keep_close_requests where requester_id=me and recipient_id=p_member_id and state='pending') then
    return public.keep_state(p_member_id); end if;
  select answered_at into last_decline from public.keep_close_requests where requester_id=me and recipient_id=p_member_id and state='declined';
  if last_decline>public.now_ms()-7*86400000::bigint then perform public.crushly_fail(429,'request_cooldown','Please give them some space before asking again.'); end if;
  select count(*) into n from public.keep_close_requests where requester_id=me and created_at>public.now_ms()-86400000::bigint;
  if n>=100 then perform public.crushly_fail(429,'','That’s a lot for one day — try again tomorrow.'); end if;
  insert into public.keep_close_requests(requester_id,recipient_id,state,created_at,answered_at)
    values(me,p_member_id,'pending',public.now_ms(),null)
    on conflict(requester_id,recipient_id) do update set state='pending',created_at=excluded.created_at,answered_at=null;
  -- Prototype uses existing notification kind. New distinct notification kinds
  -- and routing must ship together with the new UI, not this partial code.
  perform public.notify_to(p_member_id,'keep',me,null,'');
  return public.keep_state(p_member_id);
end $$;

create or replace function public.accept_keep_close(p_from_id bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id();
begin
  if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
  if p_from_id is null or p_from_id=me then perform public.crushly_fail(400,'','Invalid request.'); end if;
  perform public.relationship_pair_lock(me,p_from_id);
  if public.is_blocked_pair(me,p_from_id) or public.load_visible_profile(me,p_from_id,false) is null then
    perform public.crushly_fail(404,'','Request unavailable.'); end if;
  if not exists(select 1 from public.keep_close_requests where requester_id=p_from_id and recipient_id=me and state='pending') then
    perform public.crushly_fail(404,'','This request is no longer waiting.'); end if;
  update public.keep_close_requests set state='accepted',answered_at=public.now_ms()
    where ((requester_id=p_from_id and recipient_id=me) or (requester_id=me and recipient_id=p_from_id)) and state='pending';
  perform public.connect_pair(me,p_from_id);
  insert into public.keeps(keeper_id,kept_id) values(me,p_from_id),(p_from_id,me) on conflict do nothing;
  delete from public.notifications where user_id=me and actor_id=p_from_id and kind='keep' and read_at is null;
  return public.keep_state(p_from_id);
end $$;

create or replace function public.decline_keep_close(p_from_id bigint) returns boolean
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id();
begin
  if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
  if p_from_id is null or p_from_id=me then perform public.crushly_fail(400,'','Invalid request.'); end if;
  perform public.relationship_pair_lock(me,p_from_id);
  update public.keep_close_requests set state='declined',answered_at=public.now_ms()
    where requester_id=p_from_id and recipient_id=me and state='pending';
  if not found then perform public.crushly_fail(404,'','This request is no longer waiting.'); end if;
  delete from public.notifications where user_id=me and actor_id=p_from_id and kind='keep' and read_at is null;
  return true;
end $$;

create or replace function public.disconnect_pair(a bigint,b bigint) returns void
language plpgsql security definer set search_path=public as $$
begin
  perform public.relationship_pair_lock(a,b);
  delete from public.connections where user_a=least(a,b) and user_b=greatest(a,b);
  delete from public.keeps where (keeper_id=a and kept_id=b) or (keeper_id=b and kept_id=a);
  update public.keep_close_requests set state='cancelled',answered_at=public.now_ms()
    where ((requester_id=a and recipient_id=b) or (requester_id=b and recipient_id=a)) and state in ('pending','accepted');
  update public.conversations set closed=true where user_a=least(a,b) and user_b=greatest(a,b);
  -- Add Up follows deliberately survive an ordinary Keep Close removal.
end $$;

create or replace function public.let_go(p_member_id bigint) returns boolean
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id();
begin
  if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
  if p_member_id is null or me=p_member_id then perform public.crushly_fail(400,'','Invalid member.'); end if;
  perform public.relationship_pair_lock(me,p_member_id);
  if public.is_connected_pair(me,p_member_id) then perform public.disconnect_pair(me,p_member_id);
  else
    update public.keep_close_requests set state='cancelled',answered_at=public.now_ms()
      where requester_id=me and recipient_id=p_member_id and state='pending';
  end if;
  delete from public.notifications where user_id=p_member_id and actor_id=me and kind='keep' and read_at is null;
  return true;
end $$;

create or replace function public.keeps_severed_on_block() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  perform public.disconnect_pair(new.blocker_id,new.blocked_id);
  delete from public.crushes where (from_id=new.blocker_id and to_id=new.blocked_id) or (from_id=new.blocked_id and to_id=new.blocker_id);
  return null;
end $$;

-- Old installed clients must not accidentally approve what used to be a
-- different kind of request. A version/compatibility UX still has to be built.
create or replace function public.accept_connection_request(p_from_id bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
begin perform public.crushly_fail(409,'update_required','Update Holup to manage Keep Close requests.'); return null; end $$;
create or replace function public.decline_connection_request(p_from_id bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
begin perform public.crushly_fail(409,'update_required','Update Holup to manage Keep Close requests.'); return null; end $$;
create or replace function public.cancel_connection_request(p_to_id bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
begin perform public.crushly_fail(409,'update_required','Update Holup to manage Keep Close requests.'); return null; end $$;
revoke all on function public.accept_keep_close(bigint),public.decline_keep_close(bigint) from public,anon,authenticated;
grant execute on function public.accept_keep_close(bigint),public.decline_keep_close(bigint) to authenticated,service_role;

-- Add Up is a directional follow. Opposite-direction follows do not approve a
-- Keep Close, and unfollowing never removes an approved Keep Close connection.
create or replace function public.crush_member(p_target_id bigint,p_is_deep boolean default false,p_note text default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id(); was_active boolean; was_deep boolean; used integer; target record; clean_note text;
begin
  if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
  if p_target_id is null or p_target_id=me then perform public.crushly_fail(400,'','You can’t add yourself up.'); end if;
  perform public.relationship_pair_lock(me,p_target_id);
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
  perform public.relationship_pair_lock(me,p_target_id);
  delete from public.crushes where from_id=me and to_id=p_target_id;
  delete from public.notifications where user_id=p_target_id and actor_id=me and kind in ('crush','deep_crush') and read_at is null;
  return true;
end $$;

-- Authoritative send/open rule: no exceptions for a permissive old privacy
-- setting or an Add Up. Read, presence and media endpoints still require audit.
create or replace function public.messaging_block_reason(p_viewer bigint,p_target bigint) returns text
language plpgsql stable security definer set search_path=public as $$
begin
  if p_viewer is null or p_target is null or p_viewer=p_target then return 'You can’t message yourself.'; end if;
  if public.is_blocked_pair(p_viewer,p_target) then return 'This member is no longer available.'; end if;
  if not public.is_connected_pair(p_viewer,p_target) then return 'Whispers are available after a Keep Close request is approved.'; end if;
  return null;
end $$;

create or replace function public.ensure_conversation(a bigint,b bigint) returns bigint
language plpgsql security definer set search_path=public as $$
declare conv_id bigint;
begin
  perform public.relationship_pair_lock(a,b);
  if public.messaging_block_reason(a,b) is not null then perform public.crushly_fail(403,'messaging_restricted','Keep Close approval is required to Whisper.'); end if;
  insert into public.conversations(user_a,user_b,closed) values(least(a,b),greatest(a,b),false)
    on conflict(user_a,user_b) do update set closed=false returning id into conv_id;
  return conv_id;
end $$;

-- Recheck after acquiring the same lock as disconnect/block, closing the race
-- between a send's earlier authorization check and its INSERT.
create or replace function public.whisper_relationship_guard() returns trigger
language plpgsql security definer set search_path=public as $$
declare a bigint; b bigint; is_closed boolean;
begin
  select user_a,user_b into a,b from public.conversations where id=new.conversation_id;
  if a is null then perform public.crushly_fail(404,'','Conversation unavailable.'); end if;
  perform public.relationship_pair_lock(a,b);
  select closed into is_closed from public.conversations where id=new.conversation_id;
  if is_closed or public.messaging_block_reason(a,b) is not null then
    perform public.crushly_fail(403,'messaging_restricted','Keep Close approval is required to Whisper.'); end if;
  return new;
end $$;
revoke all on function public.whisper_relationship_guard() from public,anon,authenticated;
drop trigger if exists whisper_relationship_guard on public.messages;
create trigger whisper_relationship_guard before insert on public.messages for each row execute function public.whisper_relationship_guard();

create or replace function public.can_join_whisper(p_topic text) returns boolean
language plpgsql stable security definer set search_path=public as $$
declare me bigint:=public.me_id(); conv_id bigint; c public.conversations;
begin
  if me is null then return false; end if;
  conv_id:=public.whisper_topic_conversation(p_topic);
  select * into c from public.conversations where id=conv_id;
  return found and (c.user_a=me or c.user_b=me) and not c.closed and public.messaging_block_reason(c.user_a,c.user_b) is null;
end $$;

-- A reaction is interaction too; a closed / non-approved pair cannot add,
-- change or remove one through the installed-client RPC.
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
  perform public.relationship_pair_lock(conv.user_a,conv.user_b);
  select * into conv from public.conversations where id=msg.conversation_id;
  if not found or conv.closed or public.messaging_block_reason(conv.user_a,conv.user_b) is not null then
    perform public.crushly_fail(403,'messaging_restricted','Keep Close approval is required to interact.'); end if;
  peer:=case when conv.user_a=me then conv.user_b else conv.user_a end;
  if coalesce(p_kind,'crush') not in ('crush','laugh','fire','wow') then p_kind:='crush'; end if;
  select kind into existing_kind from public.message_reactions where message_id=msg.id and user_id=me;
  if existing_kind=p_kind then delete from public.message_reactions where message_id=msg.id and user_id=me;
  else insert into public.message_reactions(message_id,user_id,kind) values(msg.id,me,p_kind)
    on conflict(message_id,user_id) do update set kind=excluded.kind,created_at=public.now_ms(); end if;
  return (select public.serialize_message(m,me,public.receipts_visible(me,peer)) from public.messages m where m.id=msg.id);
end $$;

-- Own pending requests only; never provide a target member parameter. Each
-- profile must be independently visible and not blocked to the list reader.
create or replace function public.keep_close_request_list(p_direction text,p_offset integer default 0,p_limit integer default 40)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare me bigint:=public.me_id(); lim int:=least(greatest(coalesce(p_limit,40),1),100); off int:=greatest(coalesce(p_offset,0),0); result jsonb;
begin
  if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
  if p_direction is null or p_direction not in ('incoming','outgoing') then perform public.crushly_fail(400,'','Unknown request list.'); end if;
  with visible as (
    select r.created_at as at, case when p_direction='incoming' then r.requester_id else r.recipient_id end as person
    from public.keep_close_requests r where r.state='pending'
      and ((p_direction='incoming' and r.recipient_id=me) or (p_direction='outgoing' and r.requester_id=me))
  ), loaded as (
    select at,person,public.relationship_list_profile(me,person) as profile from visible
    where not public.is_blocked_pair(me,person)
  ), page as (
    select * from loaded where profile is not null order by at desc,person desc offset off limit lim+1
  )
  select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('profile',profile,'at',at) order by at desc,person desc) from (select * from page order by at desc,person desc limit lim) p),'[]'::jsonb),'hasMore',(select count(*)>lim from page)) into result;
  return result;
end $$;
revoke all on function public.keep_close_request_list(text,integer,integer) from public,anon,authenticated;
grant execute on function public.keep_close_request_list(text,integer,integer) to authenticated,service_role;

commit;
