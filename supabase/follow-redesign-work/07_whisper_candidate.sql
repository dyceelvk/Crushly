-- DISPOSABLE EXPERIMENT ONLY, not production. Requires follow + Homies candidate.
-- Must be integrated with all message APIs, read/media/realtime security and
-- old-client migration as a single reviewed cutover before any deployment.
begin;
lock table public.conversations,public.blocks,public.privacy,public.messages in share row exclusive mode;
alter table public.privacy add column holup_whisper_open boolean not null default false;
create table public.holup_whisper_permissions (
 conversation_id bigint primary key references public.conversations(id) on delete cascade,
 requester_id bigint not null references public.profiles(id) on delete cascade,
 recipient_id bigint not null references public.profiles(id) on delete cascade,
 state text not null check(state in ('pending','accepted','declined','blocked')),
 request_messages smallint not null default 0 check(request_messages between 0 and 2),
 created_at bigint not null default public.now_ms(),decided_at bigint,
 check(requester_id<>recipient_id)
);
alter table public.holup_whisper_permissions enable row level security;
revoke all on public.holup_whisper_permissions from public,anon,authenticated;
-- Preserve all existing open threads; neither the presence of a Homie nor an
-- Add Up is used as consent. Closed threads remain closed and fail closed.
insert into public.holup_whisper_permissions(conversation_id,requester_id,recipient_id,state)
 select id,user_a,user_b,'accepted' from public.conversations where not closed and not public.is_blocked_pair(user_a,user_b);
update public.privacy set holup_whisper_open=(who_can_message='everyone');
create or replace function public.holup_set_whisper_open(p_open boolean) returns boolean
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id();
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 if p_open is null then perform public.crushly_fail(400,'','Choose a setting.'); end if;
 update public.privacy set holup_whisper_open=p_open where user_id=me;
 if not found then perform public.crushly_fail(404,'','Privacy settings not found.'); end if;
 return p_open;
end $$;

create or replace function public.holup_begin_whisper_request(p_target bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id(); cv public.conversations; permission public.holup_whisper_permissions;
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 if p_target is null or p_target=me then perform public.crushly_fail(400,'','Invalid member.'); end if;
 perform public.holup_follow_pair_lock(me,p_target);
 if public.is_blocked_pair(me,p_target) or public.relationship_list_profile(me,p_target) is null then
   perform public.crushly_fail(404,'','Space not available.'); end if;
 select * into cv from public.conversations where user_a=least(me,p_target) and user_b=greatest(me,p_target);
 if not found then
   insert into public.conversations(user_a,user_b) values(least(me,p_target),greatest(me,p_target)) returning * into cv;
   insert into public.holup_whisper_permissions(conversation_id,requester_id,recipient_id,state) values(cv.id,me,p_target,'pending');
 end if;
 select * into permission from public.holup_whisper_permissions where conversation_id=cv.id;
 if not found or permission.state in ('declined','blocked') or cv.closed then
   perform public.crushly_fail(404,'','Whisper unavailable.'); end if;
 return jsonb_build_object('id',cv.id,'state',permission.state,'sent',permission.request_messages,
  'requester',permission.requester_id=me,'open',coalesce((select holup_whisper_open from public.privacy where user_id=permission.recipient_id),false));
end $$;

create or replace function public.holup_accept_whisper(p_conversation_id bigint) returns boolean
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id(); c public.conversations; permission public.holup_whisper_permissions;
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 select * into c from public.conversations where id=p_conversation_id;
 if not found or me not in (c.user_a,c.user_b) then perform public.crushly_fail(404,'','Request unavailable.'); end if;
 perform public.holup_follow_pair_lock(c.user_a,c.user_b);
 select * into permission from public.holup_whisper_permissions where conversation_id=c.id;
 if not found or permission.recipient_id<>me or permission.state<>'pending' or permission.request_messages=0 or public.is_blocked_pair(c.user_a,c.user_b)
    or not exists(select 1 from public.conversations where id=c.id and not closed) then
   perform public.crushly_fail(404,'','Request unavailable.'); end if;
 update public.holup_whisper_permissions set state='accepted',decided_at=public.now_ms() where conversation_id=c.id;
 return true;
end $$;

create or replace function public.holup_decline_whisper(p_conversation_id bigint) returns boolean
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id(); c public.conversations; permission public.holup_whisper_permissions;
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 select * into c from public.conversations where id=p_conversation_id;
 if not found or me not in (c.user_a,c.user_b) then perform public.crushly_fail(404,'','Request unavailable.'); end if;
 perform public.holup_follow_pair_lock(c.user_a,c.user_b);
 select * into permission from public.holup_whisper_permissions where conversation_id=c.id;
 if not found or permission.recipient_id<>me or permission.state<>'pending' or public.is_blocked_pair(c.user_a,c.user_b) then
   perform public.crushly_fail(404,'','Request unavailable.'); end if;
 update public.holup_whisper_permissions set state='declined',decided_at=public.now_ms() where conversation_id=c.id;
 return true;
end $$;

-- Every inserted Whisper (including Moment replies) uses a durable counter;
-- deleting the original message cannot reset the two-message allowance.
-- Pair lock serializes two simultaneous sends and block/accept races.
create or replace function public.holup_whisper_insert_guard() returns trigger
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id(); c public.conversations; perm public.holup_whisper_permissions; open_now boolean;
begin
 select * into c from public.conversations where id=new.conversation_id;
 if not found or me is null or new.sender_id<>me or me not in (c.user_a,c.user_b) then
   perform public.crushly_fail(404,'','Whisper unavailable.'); end if;
 perform public.holup_follow_pair_lock(c.user_a,c.user_b);
 select * into c from public.conversations where id=new.conversation_id;
 select * into perm from public.holup_whisper_permissions where conversation_id=c.id;
 if not found or c.closed or public.is_blocked_pair(c.user_a,c.user_b) or perm.state in ('declined','blocked') then
   perform public.crushly_fail(404,'','Whisper unavailable.'); end if;
 if perm.state='accepted' then return new; end if;
 -- Opening an empty composer does not reserve or accept a request. Whichever
 -- participant actually sends the first message becomes the requester.
 if perm.request_messages=0 and me=perm.recipient_id then
   if public.relationship_list_profile(me,perm.requester_id) is null then
     perform public.crushly_fail(404,'','Space not available.'); end if;
   update public.holup_whisper_permissions set requester_id=me,recipient_id=perm.requester_id where conversation_id=c.id;
   select * into perm from public.holup_whisper_permissions where conversation_id=c.id;
 end if;
 -- Serialize with setting updates; a message sent while open starts a lasting conversation.
 select holup_whisper_open into open_now from public.privacy where user_id=perm.recipient_id for update;
 if coalesce(open_now,false) then
   -- An actual message, not simply opening an empty composer, starts an
   -- ongoing conversation. It survives a later change to the open preference.
   if me<>perm.requester_id and perm.request_messages=0 then
     perform public.crushly_fail(403,'request_pending','There is no request to reply to.'); end if;
   update public.holup_whisper_permissions set state='accepted',decided_at=public.now_ms() where conversation_id=c.id;
   return new;
 end if;
 if me=perm.recipient_id then
   if perm.request_messages=0 then perform public.crushly_fail(403,'request_pending','There is no request to reply to.'); end if;
   -- The recipient's reply is consent. The decision and insert commit together.
   update public.holup_whisper_permissions set state='accepted',decided_at=public.now_ms() where conversation_id=c.id;
   return new;
 end if;
 if new.kind='call' then perform public.crushly_fail(403,'request_pending','Calls require an accepted Whisper.'); end if;
 update public.holup_whisper_permissions set request_messages=request_messages+1 where conversation_id=c.id and request_messages<2;
 if not found then perform public.crushly_fail(403,'request_limit','Wait for this Whisper request to be accepted.'); end if;
 return new;
end $$;
revoke all on function public.holup_whisper_insert_guard() from public,anon,authenticated;
drop trigger if exists holup_whisper_insert_guard on public.messages;
create trigger holup_whisper_insert_guard before insert on public.messages for each row execute function public.holup_whisper_insert_guard();

-- The Homies candidate already takes the shared pair lock before a block.
create or replace function public.holup_whisper_cleanup_block() returns trigger language plpgsql security definer set search_path=public as $$
begin
 update public.holup_whisper_permissions set state='blocked',decided_at=public.now_ms()
  where conversation_id in (select id from public.conversations where user_a=least(new.blocker_id,new.blocked_id) and user_b=greatest(new.blocker_id,new.blocked_id));
 update public.conversations set closed=true where user_a=least(new.blocker_id,new.blocked_id) and user_b=greatest(new.blocker_id,new.blocked_id);
 return new;
end $$;
create trigger holup_whisper_cleanup_block after insert on public.blocks for each row execute function public.holup_whisper_cleanup_block();
revoke all on function public.holup_whisper_cleanup_block() from public,anon,authenticated;
revoke all on function public.holup_set_whisper_open(boolean),public.holup_begin_whisper_request(bigint),public.holup_accept_whisper(bigint),public.holup_decline_whisper(bigint) from public,anon,authenticated;
grant execute on function public.holup_set_whisper_open(boolean),public.holup_begin_whisper_request(bigint),public.holup_accept_whisper(bigint),public.holup_decline_whisper(bigint) to authenticated,service_role;
commit;
