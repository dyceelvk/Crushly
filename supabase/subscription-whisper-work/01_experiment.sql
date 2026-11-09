-- EXPERIMENT ONLY: apply to a disposable legacy-schema database, never deploy.
-- Standalone v3 functions are intentionally not connected to the installed app.
-- Existing compatibility RPCs, read paths, realtime and UI still need redesign.
begin;
lock table public.keeps,public.connections,public.conversations,public.blocks,public.privacy in share row exclusive mode;

create table if not exists public.v3_migration_markers(name text primary key);
alter table public.v3_migration_markers enable row level security;
revoke all on public.v3_migration_markers from public,anon,authenticated;

-- Existing open-to-everyone preference is preserved. The new secure default for
-- accounts with no prior preference is request-first; it does not enable teens.
alter table public.privacy add column if not exists v3_whisper_open boolean not null default false;

create table if not exists public.v3_whisper_permissions (
  conversation_id bigint primary key references public.conversations(id) on delete cascade,
  requester_id bigint not null references public.profiles(id) on delete cascade,
  recipient_id bigint not null references public.profiles(id) on delete cascade,
  state text not null check(state in ('pending','accepted','declined','blocked')),
  request_messages smallint not null default 0 check(request_messages between 0 and 2),
  created_at bigint not null default public.now_ms(),
  decided_at bigint,
  check(requester_id<>recipient_id)
);
alter table public.v3_whisper_permissions enable row level security;
revoke all on public.v3_whisper_permissions from public,anon,authenticated;

-- Preserve legacy Keeps AND turn already-existing Connections into mutual
-- subscriptions; existing conversations retain their closed/blocked state.
do $$
begin
 if not exists(select 1 from public.v3_migration_markers where name='subscription-whisper-v3') then
   insert into public.keeps(keeper_id,kept_id,created_at)
     select user_a,user_b,created_at from public.connections where not public.is_blocked_pair(user_a,user_b)
     union all select user_b,user_a,created_at from public.connections where not public.is_blocked_pair(user_a,user_b)
     on conflict do nothing;
   insert into public.v3_whisper_permissions(conversation_id,requester_id,recipient_id,state)
     select id,user_a,user_b,'accepted' from public.conversations on conflict do nothing;
   update public.privacy set v3_whisper_open=(who_can_message='everyone');
   insert into public.v3_migration_markers(name) values('subscription-whisper-v3');
 end if;
end $$;

create or replace function public.v3_pair_lock(a bigint,b bigint) returns void
language sql volatile security definer set search_path=public as $$
 select pg_advisory_xact_lock(hashtextextended('holup-relationship:'||least(a,b)||':'||greatest(a,b),0))
$$;
revoke all on function public.v3_pair_lock(bigint,bigint) from public,anon,authenticated;

create or replace function public.v3_keep_subscribe(p_target bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id(); inserted int;
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 if p_target is null or p_target=me then perform public.crushly_fail(400,'','Invalid member.'); end if;
 perform public.v3_pair_lock(me,p_target);
 if public.is_blocked_pair(me,p_target) or public.load_visible_profile(me,p_target,false) is null then
   perform public.crushly_fail(404,'','Space not available.'); end if;
 if not exists(select 1 from public.keeps where keeper_id=me and kept_id=p_target) and
    (select count(*) from public.keeps where keeper_id=me and created_at>public.now_ms()-86400000::bigint)>=100 then
   perform public.crushly_fail(429,'','That’s a lot for one day.'); end if;
 insert into public.keeps(keeper_id,kept_id) values(me,p_target) on conflict do nothing;
 get diagnostics inserted=row_count;
 if inserted>0 then perform public.notify_to(p_target,'keep',me,null,''); end if;
 return jsonb_build_object('keeps',true,'keepsYou',exists(select 1 from public.keeps where keeper_id=p_target and kept_id=me),
   'mutual',exists(select 1 from public.keeps where keeper_id=p_target and kept_id=me));
end $$;

create or replace function public.v3_keep_unsubscribe(p_target bigint) returns boolean
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id();
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 if p_target is null or p_target=me then perform public.crushly_fail(400,'','Invalid member.'); end if;
 perform public.v3_pair_lock(me,p_target);
 delete from public.keeps where keeper_id=me and kept_id=p_target;
 -- Deliberately do not change either Add Ups or Whisper permissions.
 return true;
end $$;

create or replace function public.v3_can_view_kept_list(p_owner bigint) returns boolean
language sql stable security definer set search_path=public as $$
 select public.me_id() is not null and not public.is_blocked_pair(public.me_id(),p_owner)
   and public.load_visible_profile(public.me_id(),p_owner,false) is not null
   and (public.me_id()=p_owner or exists(select 1 from public.keeps where keeper_id=public.me_id() and kept_id=p_owner))
$$;

-- Counts are directional: keptClose counts subscribers to this Space.
create or replace function public.v3_keep_stats(p_owner bigint) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare me bigint:=public.me_id();
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 if public.load_visible_profile(me,p_owner,false) is null or public.is_blocked_pair(me,p_owner) then
   perform public.crushly_fail(404,'','Space not available.'); end if;
 return jsonb_build_object(
  'keptClose',(select count(*) from public.keeps k join public.profiles p on p.id=k.keeper_id
    where k.kept_id=p_owner and p.onboarded and p.status='active' and not public.is_blocked_pair(p_owner,k.keeper_id)),
  'keeping',(select count(*) from public.keeps k join public.profiles p on p.id=k.kept_id
    where k.keeper_id=p_owner and p.onboarded and p.status='active' and not public.is_blocked_pair(p_owner,k.kept_id)),
  'canViewKeptClose',public.v3_can_view_kept_list(p_owner),
  'keeps',exists(select 1 from public.keeps where keeper_id=me and kept_id=p_owner),
  'keepsYou',exists(select 1 from public.keeps where keeper_id=p_owner and kept_id=me));
end $$;

create or replace function public.v3_kept_close_people(p_owner bigint,p_offset integer default 0,p_limit integer default 40) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare me bigint:=public.me_id(); out_json jsonb; lim int:=least(greatest(coalesce(p_limit,40),1),100); off int:=greatest(coalesce(p_offset,0),0);
begin
 if not public.v3_can_view_kept_list(p_owner) then perform public.crushly_fail(403,'','This list is private.'); end if;
 with readable as (
  select k.keeper_id,k.created_at,public.relationship_list_profile(me,k.keeper_id) as profile
   from public.keeps k join public.profiles p on p.id=k.keeper_id
   where k.kept_id=p_owner and p.onboarded and p.status='active'
    and not public.is_blocked_pair(p_owner,k.keeper_id) and not public.is_blocked_pair(me,k.keeper_id)
 ), page as (
  select * from readable where profile is not null order by created_at desc,keeper_id desc offset off limit lim+1
 ) select jsonb_build_object('items',coalesce((select jsonb_agg(profile order by created_at desc,keeper_id desc)
      from (select * from page order by created_at desc,keeper_id desc limit lim) x),'[]'::jsonb),
      'hasMore',(select count(*)>lim from page)) into out_json;
 return out_json;
end $$;

create or replace function public.v3_set_whisper_open(p_open boolean) returns boolean
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id();
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 if p_open is null then perform public.crushly_fail(400,'','Choose a setting.'); end if;
 update public.privacy set v3_whisper_open=p_open where user_id=me;
 if not found then perform public.crushly_fail(404,'','Privacy settings not found.'); end if;
 return p_open;
end $$;

create or replace function public.v3_begin_whisper_request(p_target bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id(); cv public.conversations; permission public.v3_whisper_permissions;
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 if p_target is null or p_target=me then perform public.crushly_fail(400,'','Invalid member.'); end if;
 perform public.v3_pair_lock(me,p_target);
 if public.is_blocked_pair(me,p_target) or public.load_visible_profile(me,p_target,false) is null then
   perform public.crushly_fail(404,'','Space not available.'); end if;
 select * into cv from public.conversations where user_a=least(me,p_target) and user_b=greatest(me,p_target);
 if not found then
   insert into public.conversations(user_a,user_b) values(least(me,p_target),greatest(me,p_target)) returning * into cv;
   insert into public.v3_whisper_permissions(conversation_id,requester_id,recipient_id,state) values(cv.id,me,p_target,'pending');
 end if;
 select * into permission from public.v3_whisper_permissions where conversation_id=cv.id;
 if not found or permission.state in ('declined','blocked') or cv.closed then
   perform public.crushly_fail(404,'','Whisper unavailable.'); end if;
 return jsonb_build_object('id',cv.id,'state',permission.state,'sent',permission.request_messages,
  'requester',permission.requester_id=me,'open',coalesce((select v3_whisper_open from public.privacy where user_id=permission.recipient_id),false));
end $$;

create or replace function public.v3_accept_whisper(p_conversation_id bigint) returns boolean
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id(); c public.conversations; permission public.v3_whisper_permissions;
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 select * into c from public.conversations where id=p_conversation_id;
 if not found or me not in (c.user_a,c.user_b) then perform public.crushly_fail(404,'','Request unavailable.'); end if;
 perform public.v3_pair_lock(c.user_a,c.user_b);
 select * into permission from public.v3_whisper_permissions where conversation_id=c.id;
 if not found or permission.recipient_id<>me or permission.state<>'pending' or permission.request_messages=0 or public.is_blocked_pair(c.user_a,c.user_b)
    or not exists(select 1 from public.conversations where id=c.id and not closed) then
   perform public.crushly_fail(404,'','Request unavailable.'); end if;
 update public.v3_whisper_permissions set state='accepted',decided_at=public.now_ms() where conversation_id=c.id;
 return true;
end $$;

create or replace function public.v3_decline_whisper(p_conversation_id bigint) returns boolean
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id(); c public.conversations; permission public.v3_whisper_permissions;
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 select * into c from public.conversations where id=p_conversation_id;
 if not found or me not in (c.user_a,c.user_b) then perform public.crushly_fail(404,'','Request unavailable.'); end if;
 perform public.v3_pair_lock(c.user_a,c.user_b);
 select * into permission from public.v3_whisper_permissions where conversation_id=c.id;
 if not found or permission.recipient_id<>me or permission.state<>'pending' or public.is_blocked_pair(c.user_a,c.user_b) then
   perform public.crushly_fail(404,'','Request unavailable.'); end if;
 update public.v3_whisper_permissions set state='declined',decided_at=public.now_ms() where conversation_id=c.id;
 return true;
end $$;

-- Every inserted Whisper (including Moment replies) uses a durable counter;
-- deleting the original message cannot reset the two-message allowance.
-- Pair lock serializes two simultaneous sends and block/accept races.
create or replace function public.v3_whisper_insert_guard() returns trigger
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id(); c public.conversations; perm public.v3_whisper_permissions; open_now boolean;
begin
 select * into c from public.conversations where id=new.conversation_id;
 if not found or me is null or new.sender_id<>me or me not in (c.user_a,c.user_b) then
   perform public.crushly_fail(404,'','Whisper unavailable.'); end if;
 perform public.v3_pair_lock(c.user_a,c.user_b);
 select * into c from public.conversations where id=new.conversation_id;
 select * into perm from public.v3_whisper_permissions where conversation_id=c.id;
 if not found or c.closed or public.is_blocked_pair(c.user_a,c.user_b) or perm.state in ('declined','blocked') then
   perform public.crushly_fail(404,'','Whisper unavailable.'); end if;
 if perm.state='accepted' then return new; end if;
 -- Opening an empty composer does not reserve or accept a request. Whichever
 -- participant actually sends the first message becomes the requester.
 if perm.request_messages=0 and me=perm.recipient_id then
   if public.load_visible_profile(me,perm.requester_id,false) is null then
     perform public.crushly_fail(404,'','Space not available.'); end if;
   update public.v3_whisper_permissions set requester_id=me,recipient_id=perm.requester_id where conversation_id=c.id;
   select * into perm from public.v3_whisper_permissions where conversation_id=c.id;
 end if;
 -- Serialize with setting updates; a message sent while open starts a lasting conversation.
 select v3_whisper_open into open_now from public.privacy where user_id=perm.recipient_id for update;
 if coalesce(open_now,false) then
   -- An actual message, not simply opening an empty composer, starts an
   -- ongoing conversation. It survives a later change to the open preference.
   if me<>perm.requester_id and perm.request_messages=0 then
     perform public.crushly_fail(403,'request_pending','There is no request to reply to.'); end if;
   update public.v3_whisper_permissions set state='accepted',decided_at=public.now_ms() where conversation_id=c.id;
   return new;
 end if;
 if me=perm.recipient_id then
   if perm.request_messages=0 then perform public.crushly_fail(403,'request_pending','There is no request to reply to.'); end if;
   -- The recipient's reply is consent. The decision and insert commit together.
   update public.v3_whisper_permissions set state='accepted',decided_at=public.now_ms() where conversation_id=c.id;
   return new;
 end if;
 if new.kind='call' then perform public.crushly_fail(403,'request_pending','Calls require an accepted Whisper.'); end if;
 update public.v3_whisper_permissions set request_messages=request_messages+1 where conversation_id=c.id and request_messages<2;
 if not found then perform public.crushly_fail(403,'request_limit','Wait for this Whisper request to be accepted.'); end if;
 return new;
end $$;
revoke all on function public.v3_whisper_insert_guard() from public,anon,authenticated;
drop trigger if exists v3_whisper_insert_guard on public.messages;
create trigger v3_whisper_insert_guard before insert on public.messages for each row execute function public.v3_whisper_insert_guard();

-- Match all mutations on a pair, including direct block-table writes, to the same lock.
create or replace function public.v3_block_lock() returns trigger language plpgsql security definer set search_path=public as $$
begin perform public.v3_pair_lock(new.blocker_id,new.blocked_id); return new; end $$;
revoke all on function public.v3_block_lock() from public,anon,authenticated;
drop trigger if exists v3_block_lock on public.blocks;
create trigger v3_block_lock before insert on public.blocks for each row execute function public.v3_block_lock();
create or replace function public.v3_block_cleanup() returns trigger language plpgsql security definer set search_path=public as $$
begin
 update public.v3_whisper_permissions set state='blocked',decided_at=public.now_ms()
  where conversation_id in (select id from public.conversations where user_a=least(new.blocker_id,new.blocked_id) and user_b=greatest(new.blocker_id,new.blocked_id));
 update public.conversations set closed=true where user_a=least(new.blocker_id,new.blocked_id) and user_b=greatest(new.blocker_id,new.blocked_id);
 return null;
end $$;
revoke all on function public.v3_block_cleanup() from public,anon,authenticated;
drop trigger if exists v3_block_cleanup on public.blocks;
create trigger v3_block_cleanup after insert on public.blocks for each row execute function public.v3_block_cleanup();

revoke all on function public.v3_keep_subscribe(bigint),public.v3_keep_unsubscribe(bigint),public.v3_can_view_kept_list(bigint),public.v3_keep_stats(bigint),public.v3_kept_close_people(bigint,integer,integer),public.v3_set_whisper_open(boolean),public.v3_begin_whisper_request(bigint),public.v3_accept_whisper(bigint),public.v3_decline_whisper(bigint) from public,anon,authenticated;
grant execute on function public.v3_keep_subscribe(bigint),public.v3_keep_unsubscribe(bigint),public.v3_can_view_kept_list(bigint),public.v3_keep_stats(bigint),public.v3_kept_close_people(bigint,integer,integer),public.v3_set_whisper_open(boolean),public.v3_begin_whisper_request(bigint),public.v3_accept_whisper(bigint),public.v3_decline_whisper(bigint) to authenticated,service_role;
commit;
