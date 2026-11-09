-- Applied to production as migration 20261109110817. Defense in depth only: incomplete-account social access and teen isolation remain unresolved.
create or replace function public.age_of(birthdate text) returns integer
language sql stable set search_path=public as $$
  select case when birthdate is null or birthdate !~ '^\d{4}-\d{2}-\d{2}$'
      or not pg_input_is_valid(birthdate,'date') then null
    else extract(year from age(current_date,birthdate::date))::integer end
$$;

create or replace function public.experimental_check_adult_profile() returns trigger
language plpgsql security definer set search_path=public as $$
declare birth date;
begin
  if new.birthdate is null and not new.onboarded then return new; end if;
  if new.birthdate is null or new.birthdate !~ '^\d{4}-\d{2}-\d{2}$'
     or not pg_input_is_valid(new.birthdate,'date') then
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
drop trigger if exists experimental_adult_profile_gate on public.profiles;
create trigger experimental_adult_profile_gate before insert or update of birthdate,onboarded
  on public.profiles for each row execute function public.experimental_check_adult_profile();
