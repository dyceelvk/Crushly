-- Applied to Holup production: ordinary clients may update their own profile,
-- but may not award, change or remove verification badge tiers themselves.
-- Existing badges and server-authorized review actions are unchanged.
create or replace function public.guard_profile_badge_tier()
returns trigger language plpgsql set search_path = '' as $$
begin
 if current_user in ('anon','authenticated') and new.badge_tier is distinct from old.badge_tier then
  raise exception 'Badge tier is managed by Holup reviewers' using errcode = '42501';
 end if;
 return new;
end $$;
drop trigger if exists guard_profile_badge_tier on public.profiles;
create trigger guard_profile_badge_tier before update of badge_tier on public.profiles
 for each row execute function public.guard_profile_badge_tier();
revoke all on function public.guard_profile_badge_tier() from public,anon,authenticated;
