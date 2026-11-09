-- EXPERIMENT ONLY. Run after 01, 04 and 08 on a disposable database.
-- Notifications, direct table reads and badge counters must agree about current
-- access. Never keep snapshots of changed/deleted message or post text.
begin;
update public.notifications set body='' where kind in ('message','moment_reply','post_comment','post_mention') and body<>'';

create or replace function public.notify_to(p_uid bigint,p_kind text,p_actor_id bigint default null,p_ref_id bigint default null,p_body text default '')
returns void language plpgsql security definer set search_path=public as $$
declare existing_id bigint; clean text:=case when p_kind in ('message','moment_reply','post_comment','post_mention') then '' else coalesce(p_body,'') end;
begin
 if not public.notification_allowed(p_uid,p_kind) then return; end if;
 if p_kind in ('post_mention','keep','message') and p_actor_id is not null then
  select id into existing_id from public.notifications where user_id=p_uid and kind=p_kind and actor_id=p_actor_id
   and ref_id is not distinct from p_ref_id and read_at is null limit 1;
  if existing_id is not null then update public.notifications set created_at=public.now_ms(),body=clean where id=existing_id; return; end if;
 end if;
 insert into public.notifications(user_id,kind,actor_id,ref_id,body) values(p_uid,p_kind,p_actor_id,p_ref_id,clean);
end $$;

create or replace function public.v3_notification_visible(n public.notifications) returns boolean
language plpgsql stable security definer set search_path=public as $$
declare me bigint:=public.me_id();
begin
 if me is null or n.user_id is distinct from me then return false; end if;
 if n.actor_id is not null and (public.is_blocked_pair(me,n.actor_id) or not exists(
   select 1 from public.profiles p where p.id=n.actor_id and p.onboarded and p.status='active')) then return false; end if;
 if n.kind in ('message','moment_reply') then return coalesce(public.whisper_thread_allowed(n.ref_id),false); end if;
 if n.kind in ('post_reaction','post_comment','post_mention') then
  return exists(select 1 from public.posts p where p.id=n.ref_id and public.can_view_post(p,me)); end if;
 if n.kind='moment_reaction' then
  return exists(select 1 from public.moments m where m.id=n.ref_id and m.expires_at>public.now_ms() and public.can_view_moment(m,me)); end if;
 if n.kind='keep' then return exists(select 1 from public.keeps k where k.keeper_id=n.actor_id and k.kept_id=me); end if;
 if n.kind in ('crush','deep_crush') then return exists(select 1 from public.crushes c where c.from_id=n.actor_id and c.to_id=me and c.status in ('pending','accepted')); end if;
 if n.kind='mutual' then return false; end if; -- superseded legacy matchmaking notices
 return true;
end $$;
revoke all on function public.v3_notification_visible(public.notifications) from public,anon,authenticated;
grant execute on function public.v3_notification_visible(public.notifications) to authenticated,service_role;

-- Direct table access used by old clients must have the identical filter; only
-- read_at can be updated. Never permit clients to forge events or change actors.
drop policy if exists notifications_own on public.notifications;
drop policy if exists v3_notifications_read on public.notifications;
create policy v3_notifications_read on public.notifications for select to authenticated using(public.v3_notification_visible(notifications));
drop policy if exists v3_notifications_mark_read on public.notifications;
create policy v3_notifications_mark_read on public.notifications for update to authenticated using(public.v3_notification_visible(notifications)) with check(user_id=public.me_id());
revoke all on public.notifications from public,anon,authenticated;
grant select on public.notifications to authenticated;
grant update(read_at) on public.notifications to authenticated;

create or replace function public.list_notifications() returns setof jsonb
language plpgsql stable security definer set search_path=public as $$
declare me bigint:=public.me_id(); n record; visible_actor jsonb; actor jsonb;
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 for n in select nt.*,pf.name as actor_name,pf.verification as actor_verification from public.notifications nt
   left join public.profiles pf on pf.id=nt.actor_id
   where nt.user_id=me and public.v3_notification_visible(nt) order by nt.created_at desc,nt.id desc limit 100
 loop
  actor:=null;
  if n.actor_id is not null then
   visible_actor:=public.relationship_list_profile(me,n.actor_id);
   if visible_actor is not null then
    actor:=jsonb_build_object('id',n.actor_id,'name',n.actor_name,'verified',n.actor_verification='verified','photo',public.photos_of(n.actor_id)->0->>'url');
   elsif n.kind in ('keep','message','moment_reply') then
    -- The person initiated this direct interaction. Only their name/id are
    -- needed to identify it; no hidden Space picture or badge is disclosed.
    actor:=jsonb_build_object('id',n.actor_id,'name',n.actor_name,'verified',false,'photo',null);
   end if;
  end if;
  return next jsonb_build_object('id',n.id,'kind',n.kind,'body',n.body,'refId',n.ref_id,'createdAt',n.created_at,'read',n.read_at is not null,'actor',actor);
 end loop;
end $$;

create or replace function public.badges() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare me bigint:=public.me_id(); latest record; actor_ok boolean;
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 select n.id,n.kind,n.body,n.actor_id,pf.name as actor_name into latest
 from public.notifications n left join public.profiles pf on pf.id=n.actor_id
 where n.user_id=me and public.v3_notification_visible(n) order by n.created_at desc,n.id desc limit 1;
 actor_ok:=latest.actor_id is not null and (latest.kind in ('keep','message','moment_reply') or public.relationship_list_profile(me,latest.actor_id) is not null);
 return jsonb_build_object(
  'notifications',(select count(*)::int from public.notifications n where n.user_id=me and n.read_at is null and public.v3_notification_visible(n)),
  'messages',(select count(*)::int from public.messages m where public.whisper_thread_allowed(m.conversation_id) and m.sender_id<>me and m.read_at is null
    and not exists(select 1 from public.hidden_whispers h where h.message_id=m.id and h.user_id=me)),
  'crushes',(select count(*)::int from public.notifications n where n.user_id=me and n.read_at is null and n.kind in ('crush','deep_crush') and public.v3_notification_visible(n)),
  'latestNotification',case when latest.id is null then null else jsonb_build_object('id',latest.id,'kind',latest.kind,'body',latest.body,
    'actor_id',case when actor_ok then latest.actor_id else null end,'actor_name',case when actor_ok then latest.actor_name else null end) end);
end $$;
commit;
