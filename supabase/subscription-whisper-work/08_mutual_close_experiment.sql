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
