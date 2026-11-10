-- Holup is one 16+ product: nobody younger than 16 is granted access.
--
-- This re-applies the rule from 20261109225634, which
-- 20261110023805_restore_adult_gate_until_teen_protections replaced with an 18+
-- gate. The owner's requirement is 16+, not 18+, and no separate teen account
-- type, teen-mode branch or second project is introduced here — the same
-- function, the same trigger and the same gate, with the threshold the product
-- actually promises.
--
-- What this does NOT do: it does not widen anyone's saved age filters. Members
-- whose age_min/age_max were raised to 18 by the previous migration keep the
-- range they now see; the floor only says what values are *permitted* from here
-- on. Their original 16/17 values are not recoverable, and silently lowering a
-- preference a member can see would be a worse lie than leaving it.

begin;

-- 1. Preflight against real people, not just stored preferences. If any account
--    on this project is younger than 16, applying the rule retroactively is a
--    safeguarding decision about a named person, so abort and make it explicit
--    rather than letting an UPDATE decide it.
lock table public.profiles, public.preferences in share row exclusive mode;
do $$
begin
  if exists (
    select 1 from public.profiles
     where birthdate is not null
       and pg_input_is_valid(birthdate, 'date')
       and birthdate::date > (current_date - interval '16 years')::date
  ) then
    raise exception 'Existing under-16 profiles require a safeguarding decision; migration aborted.';
  end if;

  if exists (
    select 1 from public.preferences
     where age_min is null or age_max is null
        or age_min > 99 or age_max > 99
        or age_min > age_max
  ) then
    raise exception using
      errcode = 'check_violation',
      message = 'Cannot apply the 16+ policy: stored age preferences are inconsistent.';
  end if;
end
$$;

-- 2. New accounts start at the floor of the product, not at 18.
alter table public.preferences alter column age_min set default 16;

-- 3. Keep the floor true for every writer, including direct PostgREST writes.
alter table public.preferences drop constraint if exists preferences_age_range_check;
alter table public.preferences add constraint preferences_age_range_check
  check (age_min between 16 and 99 and age_max between 16 and 99 and age_min <= age_max);

-- 4. The access gate. The function and trigger names stay as they are, so the
--    deployed trigger definition keeps covering every insert and every birthdate
--    or onboarding change; only the threshold, the error code and the wording
--    move. Exactly 16 today is eligible.
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
