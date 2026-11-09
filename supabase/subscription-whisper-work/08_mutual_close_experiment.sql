-- EXPERIMENT ONLY: Requires 01 and 04, disposable DB only. The latest
-- policy is reciprocal Close Ones: adding is immediate in each direction,
-- but Close/Connections audiences require BOTH directions. Whispers remain
-- independent. Inbound Kept Close counts do not become mutual counts.
begin;

create or replace function public.is_connected_pair(a bigint,b bigint) returns boolean
language sql stable security definer set search_path=public as $$
 select a is not null and b is not null and a<>b and not public.is_blocked_pair(a,b)
   and exists(select 1 from public.keeps where keeper_id=a and kept_id=b)
   and exists(select 1 from public.keeps where keeper_id=b and kept_id=a)
$$;

create or replace function public.v3_can_view_kept_list(p_owner bigint) returns boolean
language sql stable security definer set search_path=public as $$
 select public.me_id() is not null and not public.is_blocked_pair(public.me_id(),p_owner)
   and public.load_visible_profile(public.me_id(),p_owner,false) is not null
   and (public.me_id()=p_owner or public.is_connected_pair(public.me_id(),p_owner))
$$;

-- The old historical Add Up exception let non-connections view private Spaces.
-- Close-only must always mean a current reciprocal Keep, not an old Add Up.
create or replace function public.load_visible_profile(p_viewer bigint,p_target bigint,p_full boolean default false)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r record;
begin
 if p_viewer is null or p_target is null then return null; end if;
 if p_viewer<>p_target and public.is_blocked_pair(p_viewer,p_target) then return null; end if;
 select p.onboarded,p.status,pr.profile_visibility into r from public.profiles p join public.privacy pr on pr.user_id=p.id where p.id=p_target;
 if not found or not r.onboarded then return null; end if;
 if p_viewer<>p_target then
   if r.status<>'active' and not public.is_connected_pair(p_viewer,p_target) then return null; end if;
   if r.profile_visibility='connections' and not public.is_connected_pair(p_viewer,p_target) then return null; end if;
 end if;
 return public.public_profile(p_viewer,p_target,p_full);
end $$;
-- A private Space can initiate a Keep; the recipient may safely Keep back
-- without seeing that Space's private content before the reciprocal action.
-- Existence, status and block checks are repeated under the shared pair lock.
create or replace function public.v3_keep_subscribe(p_target bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
declare me bigint:=public.me_id(); inserted int; incoming boolean;
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 if p_target is null or p_target=me then perform public.crushly_fail(400,'','Invalid member.'); end if;
 perform public.v3_pair_lock(me,p_target);
 incoming:=exists(select 1 from public.keeps where keeper_id=p_target and kept_id=me);
 if public.is_blocked_pair(me,p_target) or not exists(select 1 from public.profiles p where p.id=p_target and p.onboarded and p.status='active')
   or (public.load_visible_profile(me,p_target,false) is null and not incoming) then
   perform public.crushly_fail(404,'','Space not available.'); end if;
 if not exists(select 1 from public.keeps where keeper_id=me and kept_id=p_target) and
    (select count(*) from public.keeps where keeper_id=me and created_at>public.now_ms()-86400000::bigint)>=100 then
   perform public.crushly_fail(429,'','That’s a lot for one day.'); end if;
 insert into public.keeps(keeper_id,kept_id) values(me,p_target) on conflict do nothing;
 get diagnostics inserted=row_count;
 if inserted>0 then perform public.notify_to(p_target,'keep',me,null,''); end if;
 return jsonb_build_object('keeps',true,'keepsYou',incoming,'mutual',incoming);
end $$;

-- Only an incoming actor who chose to Keep this recipient may be shown as a
-- limited card when their Space is private; no photo, bio, age, city, handle,
-- online state, interests, posts or other profile attributes are returned.
-- Ordinary directory lists continue to filter private identities completely.
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
 ), loaded as (
  select ids.person,ids.at,public.relationship_list_profile(me,ids.person) as profile,
   not exists(select 1 from public.keeps k2 where k2.keeper_id=me and k2.kept_id=ids.person) as can_keep_back,
   p.name from ids join public.profiles p on p.id=ids.person
   where p.onboarded and p.status='active' and not public.is_blocked_pair(me,ids.person)
 ), readable as (
  select person,at,can_keep_back,(profile is null) as limited,
   coalesce(profile,case when p_direction='incoming' then jsonb_build_object('id',person,'name',name,'photos','[]'::jsonb) end) as profile
  from loaded
 ), page as (select * from readable where profile is not null order by at desc,person desc offset off limit lim+1)
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('profile',profile,'at',at,
     'canKeepBack',p_direction='incoming' and can_keep_back,'limited',limited) order by at desc,person desc)
   from (select * from page order by at desc,person desc limit lim) q),'[]'::jsonb),'hasMore',(select count(*)>lim from page)) into result;
 return result;
end $$;

-- Historical match rows are migration inputs, not current friendship evidence.
-- Keep them available to trusted server code only; older installed clients may
-- need an upgrade gate before a production cutover.
revoke all on public.connections from public,anon,authenticated;

-- Remaining old-client list and current Circle/share candidate callers must not
-- read the obsolete connections table: its rows survive a one-sided un-Keep.
-- Only mutual Close Ones are candidates. Old pending-crush queues are no longer
-- relationship requests; legacy clients still require an explicit upgrade path.
create or replace function public.crushes_feed() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare me bigint:=public.me_id(); mutual jsonb;
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 select coalesce(jsonb_agg(q.profile || jsonb_build_object('at',q.at) order by q.at desc,q.person desc),'[]'::jsonb) into mutual
 from (
   select k.kept_id as person,k.created_at as at,public.relationship_list_profile(me,k.kept_id) as profile
   from public.keeps k join public.profiles p on p.id=k.kept_id
   where k.keeper_id=me and p.onboarded and p.status='active'
    and public.is_connected_pair(me,k.kept_id) and not public.is_blocked_pair(me,k.kept_id)
 ) q where q.profile is not null;
 return jsonb_build_object('incoming','[]'::jsonb,'outgoing','[]'::jsonb,'mutual',mutual,'requestCount',0);
end $$;

-- Legacy directional Keep endpoints must use the same pair lock and visibility
-- checks as new clients. Return the historic JSON shape, but never raw counts
-- for an unavailable/blocked Space.
create or replace function public.keep_state(p_member_id bigint) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare me bigint:=public.me_id(); s jsonb;
begin
 if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
 if p_member_id is null or p_member_id=me then return jsonb_build_object('keeps',false,'keepsYou',false,'keepsCount',0,'keptByCount',0,'self',true); end if;
 s:=public.v3_keep_stats(p_member_id);
 return jsonb_build_object('keeps',s->'keeps','keepsYou',s->'keepsYou','keepsCount',s->'keeping','keptByCount',s->'keptClose','self',false);
end $$;
create or replace function public.keep_close(p_member_id bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
begin perform public.v3_keep_subscribe(p_member_id); return public.keep_state(p_member_id); end $$;
create or replace function public.let_go(p_member_id bigint) returns boolean
language plpgsql security definer set search_path=public as $$
begin return public.v3_keep_unsubscribe(p_member_id); end $$;

-- Old approval/removal actions have incompatible semantics. Fail closed rather
-- than falsely approving Add Ups, changing the other person's follow, or
-- closing an accepted Whisper. This is NOT an installed-client upgrade gate.
create or replace function public.accept_connection_request(p_from_id bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
begin perform public.crushly_fail(409,'upgrade_required','Update Holup to manage Close Ones.'); return null; end $$;
create or replace function public.decline_connection_request(p_from_id bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
begin perform public.crushly_fail(409,'upgrade_required','Update Holup to manage Close Ones.'); return null; end $$;
create or replace function public.cancel_connection_request(p_to_id bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
begin perform public.crushly_fail(409,'upgrade_required','Update Holup to manage Add Ups.'); return null; end $$;
create or replace function public.remove_connection(p_target_id bigint) returns boolean
language plpgsql security definer set search_path=public as $$
begin perform public.crushly_fail(409,'upgrade_required','Update Holup to manage Close Ones.'); return false; end $$;
commit;
