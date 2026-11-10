-- A shared Space can unfurl without telling a stranger anything the member
-- has not already chosen to show everyone.
--
-- This is the anonymous twin of the Space screen: no viewer, so no viewer-dependent
-- field exists (no distance, no shared interests, no "they are online", no Add Up
-- counts). It answers only for a profile whose owner set profile_visibility to
-- 'everyone' and is not incognito - the same gate public_post_preview uses - and
-- only for a profile that is onboarded and active.
--
-- Deliberately absent: photos, follower-shaped counts, activity, location. A link
-- should read like a name card, not like a dossier.
create or replace function public.public_space_preview(p_id bigint)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'id', p.id,
    'name', nullif(p.name, ''),
    'username', nullif(p.username, ''),
    'city', case when pr.show_city then nullif(p.city, '') else null end,
    'bio', nullif(left(coalesce(p.bio, ''), 200), ''),
    'verified', p.verification = 'verified',
    'badgeTier', case
      when p.badge_tier = 'diamond' then 'diamond'
      when p.badge_tier = 'gold' then 'gold'
      when p.verification = 'verified' then 'verified'
      else 'none'
    end
  )
  from public.profiles p
  join public.privacy pr on pr.user_id = p.id
  where p.id = p_id
    and p.onboarded
    and p.status = 'active'
    and pr.profile_visibility = 'everyone'
    and not pr.incognito
  limit 1
$$;

revoke all on function public.public_space_preview(bigint) from public;
grant execute on function public.public_space_preview(bigint) to anon, authenticated, service_role;
