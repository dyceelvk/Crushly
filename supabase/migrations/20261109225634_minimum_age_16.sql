-- Holup is one 16+ product: nobody younger than 16 is granted access.
--
-- This supersedes the 18+ gate applied in 20261109110817. It changes only the
-- minimum age and the preference floor/default. It does not create a teen
-- account type, a teen-mode branch, or a second project, and it does not touch
-- the relationship objects.
--
-- Ordering note: this ships before the matching client copy because the server
-- becoming more permissive is harmless to already-installed 18+ clients, while
-- the reverse (16+ copy in front of an 18+ server) would show an eligible
-- person a rejection they cannot resolve.

begin;

-- 1. Preflight. Abort the whole migration rather than half-applying a policy
--    change if any stored age preference would violate the new floor.
do $$
begin
  if exists (
    select 1
      from public.preferences
     where age_min is null
        or age_max is null
        or age_min < 16
        or age_max < 16
        or age_min > 99
        or age_max > 99
        or age_min > age_max
  ) then
    raise exception using
      errcode = 'check_violation',
      message = 'Cannot apply the 16+ policy: stored age preferences fall outside 16-99.';
  end if;
end
$$;

-- 2. New accounts start at the floor of the product, not at 18.
alter table public.preferences
  alter column age_min set default 16;

-- 3. Keep the floor true for every writer, including direct PostgREST writers.
alter table public.preferences
  drop constraint if exists preferences_age_range_check;
alter table public.preferences
  add constraint preferences_age_range_check
  check (
    age_min between 16 and 99
    and age_max between 16 and 99
    and age_min <= age_max
  );

-- 4. The access gate. Function and trigger names are kept so the deployed
--    trigger definition continues to cover every insert and every birthdate or
--    onboarding change; only the threshold, the error code and the wording move.
create or replace function public.experimental_check_adult_profile() returns trigger
language plpgsql security definer set search_path=public as $$
declare birth date;
begin
  if new.birthdate is null and not new.onboarded then return new; end if;
  if new.birthdate is null or new.birthdate !~ '^\d{4}-\d{2}-\d{2}$'
     or not pg_input_is_valid(new.birthdate,'date') then
    perform public.crushly_fail(400,'invalid_birthday','Please enter a valid birthday.');
  end if;
  birth := new.birthdate::date;
  -- Exactly 16 today is eligible; anyone younger is refused.
  if birth > (current_date - interval '16 years')::date then
    perform public.crushly_fail(403,'minimum_age','Holup is for people aged 16 and over.');
  end if;
  if birth <= (current_date - interval '100 years')::date then
    perform public.crushly_fail(400,'invalid_birthday','Please check your birthday.');
  end if;
  return new;
end $$;

revoke all on function public.experimental_check_adult_profile() from public, anon, authenticated;

-- 5. The gate must exist and stay enabled, whatever the deployed history is.
drop trigger if exists experimental_adult_profile_gate on public.profiles;
create trigger experimental_adult_profile_gate
  before insert or update of birthdate, onboarded on public.profiles
  for each row execute function public.experimental_check_adult_profile();

notify pgrst, 'reload schema';

commit;
