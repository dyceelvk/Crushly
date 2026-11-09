-- Server-side authority uses immutable authenticated user IDs, not client email.
create table if not exists public.holup_admins (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  created_at bigint not null default public.now_ms()
);
alter table public.holup_admins enable row level security;
revoke all on public.holup_admins from public, anon, authenticated;
insert into public.holup_admins(auth_user_id)
  select id from auth.users where id='03deee67-8259-4ccf-8011-d5a74d2732d9'::uuid
    and lower(email)=lower('rielosInc@gmail.com') and email_confirmed_at is not null
  on conflict do nothing;

create table if not exists public.holup_features (
  key text primary key, enabled boolean not null, updated_at bigint not null default public.now_ms()
);
alter table public.holup_features enable row level security;
revoke all on public.holup_features from public,anon,authenticated;
insert into public.holup_features(key,enabled) values ('calls',false),('public_post_sharing',true) on conflict do nothing;

create table if not exists public.holup_announcement (
  singleton boolean primary key default true check(singleton),
  title text not null default '', body text not null default '', active boolean not null default false,
  updated_at bigint not null default public.now_ms()
);
alter table public.holup_announcement enable row level security;
revoke all on public.holup_announcement from public,anon,authenticated;
insert into public.holup_announcement(singleton) values(true) on conflict do nothing;

create table if not exists public.holup_admin_events (
  id bigint generated always as identity primary key, actor uuid not null references auth.users(id),
  kind text not null, details jsonb not null, created_at bigint not null default public.now_ms()
);
alter table public.holup_admin_events enable row level security;
revoke all on public.holup_admin_events from public,anon,authenticated;

create or replace function public.holup_is_admin() returns boolean
language sql stable security definer set search_path=public as $$
 select auth.uid() is not null and exists(select 1 from holup_admins where auth_user_id=auth.uid())
$$;
create or replace function public.holup_feature_enabled(p_key text) returns boolean
language sql stable security definer set search_path=public as $$
 select coalesce((select enabled from holup_features where key=p_key),false)
$$;
revoke all on function public.holup_feature_enabled(text) from public,anon,authenticated;

create or replace function public.holup_app_settings() returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
  if public.me_id() is null then perform public.crushly_fail(401,'unauthorized','Please sign in.'); end if;
  return jsonb_build_object('callsEnabled',public.holup_feature_enabled('calls'),
    'publicSharingEnabled',public.holup_feature_enabled('public_post_sharing'),
    'announcement',(select case when active then jsonb_build_object('title',title,'body',body) else null end from holup_announcement where singleton));
end $$;
create or replace function public.holup_admin_state() returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
  if not public.holup_is_admin() then perform public.crushly_fail(403,'forbidden','Admin access required.'); end if;
  return jsonb_build_object('features',(select jsonb_object_agg(key,enabled) from holup_features),
    'announcement',(select jsonb_build_object('title',title,'body',body,'active',active) from holup_announcement where singleton));
end $$;
create or replace function public.holup_admin_set_feature(p_key text,p_enabled boolean) returns boolean
language plpgsql security definer set search_path=public as $$
declare old_value boolean;
begin
  if not public.holup_is_admin() then perform public.crushly_fail(403,'forbidden','Admin access required.'); end if;
  if p_key not in ('calls','public_post_sharing') or p_enabled is null then perform public.crushly_fail(400,'bad_feature','Unknown feature.'); end if;
  select enabled into old_value from holup_features where key=p_key for update;
  update holup_features set enabled=p_enabled,updated_at=public.now_ms() where key=p_key;
  insert into holup_admin_events(actor,kind,details) values(auth.uid(),'feature',jsonb_build_object('key',p_key,'before',old_value,'after',p_enabled));
  return p_enabled;
end $$;
create or replace function public.holup_admin_announcement(p_title text,p_body text,p_active boolean) returns boolean
language plpgsql security definer set search_path=public as $$
declare t text:=btrim(coalesce(p_title,'')); b text:=btrim(coalesce(p_body,''));
begin
  if not public.holup_is_admin() then perform public.crushly_fail(403,'forbidden','Admin access required.'); end if;
  if length(t)>100 or length(b)>500 or p_active is null or (p_active and (t='' or b='')) then
    perform public.crushly_fail(400,'bad_announcement','Add a title and message, within the length limits.');
  end if;
  update holup_announcement set title=t,body=b,active=p_active,updated_at=public.now_ms() where singleton;
  insert into holup_admin_events(actor,kind,details) values(auth.uid(),'announcement',jsonb_build_object('title',t,'body',b,'active',p_active));
  return true;
end $$;
revoke all on function public.holup_is_admin() from public,anon,authenticated;
revoke all on function public.holup_app_settings() from public,anon,authenticated;
revoke all on function public.holup_admin_state() from public,anon,authenticated;
revoke all on function public.holup_admin_set_feature(text,boolean) from public,anon,authenticated;
revoke all on function public.holup_admin_announcement(text,text,boolean) from public,anon,authenticated;
grant execute on function public.holup_is_admin(), public.holup_app_settings(), public.holup_admin_state(), public.holup_admin_set_feature(text,boolean), public.holup_admin_announcement(text,text,boolean) to authenticated,service_role;

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
  peer := case when conv.user_a = me then conv.user_b else conv.user_a end;
  if conv.closed or public.messaging_block_reason(me, peer) is not null then
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
revoke all on function public.register_call_room(bigint) from public, anon;
grant execute on function public.register_call_room(bigint) to authenticated;

create or replace function public.can_join_call(p_channel text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.holup_feature_enabled('calls') and exists (
    select 1 from public.call_rooms r join public.conversations c on c.id = r.conversation_id
    where r.channel = p_channel and r.expires_at > public.now_ms() and r.closed_at is null
      and public.me_id() in (r.caller_id, r.callee_id)
      and not c.closed and public.messaging_block_reason(r.caller_id, r.callee_id) is null
  )
$$;
revoke all on function public.can_join_call(text) from public, anon;
grant execute on function public.can_join_call(text) to authenticated;

create or replace function public.end_call_room(p_channel text) returns void
language sql security definer set search_path = public as $$
  update public.call_rooms set closed_at = public.now_ms()
    where channel = p_channel and public.me_id() in (caller_id, callee_id) and closed_at is null
$$;
revoke all on function public.end_call_room(text) from public, anon;
grant execute on function public.end_call_room(text) to authenticated;


create or replace function public.validate_call_invitation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'call' and not public.holup_feature_enabled('calls') then
    perform public.crushly_fail(403,'disabled','Calls are currently unavailable.');
  end if;
  if new.kind = 'call' and not exists (
    select 1 from public.call_rooms r where r.channel = new.meta ->> 'channel'
      and r.conversation_id = new.conversation_id and r.caller_id = new.sender_id
      and r.closed_at is null and r.expires_at > public.now_ms()
  ) then
    perform public.crushly_fail(400, '', 'This call invitation has expired. Start a new call.');
  end if;
  return new;
end $$;
drop trigger if exists validate_call_invitation on public.messages;
create trigger validate_call_invitation before insert on public.messages
  for each row execute function public.validate_call_invitation();

-- An anonymous preview is deliberately separate from signed-in post access.
-- Never expose media URLs: Worker media remains behind live authorization.
-- Every request re-evaluates current audience and profile privacy.
create or replace function public.public_post_preview(p_post_id bigint)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object('id',po.id,'body',left(po.body,300),'author',p.name)
  from posts po join profiles p on p.id=po.author_id join privacy pr on pr.user_id=p.id
  where public.holup_feature_enabled('public_post_sharing') and po.id=p_post_id and po.audience='everyone' and po.circle_id is null
    and p.onboarded and p.status='active' and pr.profile_visibility='everyone' and not pr.incognito
  limit 1
$$;
revoke all on function public.public_post_preview(bigint) from public, anon, authenticated;
grant execute on function public.public_post_preview(bigint) to anon, authenticated, service_role;
notify pgrst, 'reload schema';

notify pgrst, 'reload schema';
