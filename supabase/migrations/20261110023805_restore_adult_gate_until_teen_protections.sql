begin;
-- Restore the previously required adult gate until a separately protected teen mode exists.
-- Serialize with profile and preference writes. Do not make assumptions about existing minors.
lock table public.profiles, public.preferences in share row exclusive mode;
do $$ begin
 if exists(select 1 from public.profiles where birthdate is not null and pg_input_is_valid(birthdate,'date') and birthdate::date > (current_date - interval '18 years')::date) then
  raise exception 'Existing under-18 profiles require a separate safeguarding plan; migration aborted.';
 end if;
end $$;
update public.preferences set age_min=greatest(age_min,18), age_max=greatest(age_max,18) where age_min<18 or age_max<18;
alter table public.preferences alter column age_min set default 18;
alter table public.preferences drop constraint if exists preferences_age_range_check;
alter table public.preferences add constraint preferences_age_range_check check(age_min between 18 and 99 and age_max between 18 and 99 and age_min <= age_max);
create or replace function public.experimental_check_adult_profile() returns trigger language plpgsql security definer set search_path=public as $$
declare birth date;
begin
 if new.birthdate is null and not new.onboarded then return new; end if;
 if new.birthdate is null or new.birthdate !~ '^\d{4}-\d{2}-\d{2}$' or not pg_input_is_valid(new.birthdate,'date') then
  perform public.crushly_fail(400,'invalid_birthday','Please enter a valid birthday.');
 end if;
 birth:=new.birthdate::date;
 if birth > (current_date - interval '18 years')::date then
  perform public.crushly_fail(403,'adult_only','Holup is for adults aged 18 or older.');
 end if;
 if birth <= (current_date - interval '100 years')::date then
  perform public.crushly_fail(400,'invalid_birthday','Please check your birthday.');
 end if;
 return new;
end $$;
revoke all on function public.experimental_check_adult_profile() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
