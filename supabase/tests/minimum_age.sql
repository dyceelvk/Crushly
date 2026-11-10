-- Holup is 18+ until protected teen mode is ready: the floor lives in the database, not in a form.
-- A 17-year-old is refused with 403/minimum_age, someone whose eighteenth
-- birthday is today is admitted, and no writer can store a preference floor
-- below 18 — including one that reaches the table without the app.
begin;
do $test$
declare
  started boolean;
  blocked_code text;
  probe_id bigint;
begin
  -- 1. Seventeen years old is refused, with the public code the client reads.
  select id into probe_id from profiles order by id limit 1;
  assert probe_id is not null, 'need one seeded profile';
  begin
    update profiles
       set birthdate = ((current_date - interval '17 years')::date)::text
     where id = probe_id;
    assert false, 'a 17-year-old was allowed to keep a birthdate';
  exception
    when others then
      blocked_code := sqlerrm;
  end;
  assert blocked_code like '%adult_only%',
    'under-18 must fail with the adult_only code, got: ' || blocked_code;

  -- 2. The day of the eighteenth birthday is eligible; the day before is not.
  update profiles
     set birthdate = ((current_date - interval '18 years')::date)::text
   where id = probe_id;
  assert not exists (
    select 1 from profiles
     where id = probe_id
       and birthdate::date > (current_date - interval '18 years')::date
  ), 'eighteenth birthday must be admitted';

  begin
    update profiles
       set birthdate = ((current_date - interval '18 years' + interval '1 day')::date)::text
     where id = probe_id;
    assert false, 'the day before the eighteenth birthday was admitted';
  exception
    when others then
      blocked_code := sqlerrm;
  end;
  assert blocked_code like '%adult_only%', 'just under 18 must be refused';

  -- 3. A birthday nobody could have, or one a century old, is not a pass.
  begin
    update profiles set birthdate = 'not-a-date' where id = probe_id;
    assert false, 'a malformed birthday was stored';
  exception
    when others then
      blocked_code := sqlerrm;
  end;
  assert blocked_code like '%invalid_birthday%', 'malformed birthday must be invalid_birthday';

  begin
    update profiles
       set birthdate = ((current_date - interval '101 years')::date)::text
     where id = probe_id;
    assert false, 'a 101-year-old birthday was stored';
  exception
    when others then
      blocked_code := sqlerrm;
  end;
  assert blocked_code like '%invalid_birthday%', 'implausible birthday must be invalid_birthday';

  -- 4. New accounts start at the product floor at 18.
  update profiles
     set birthdate = ((current_date - interval '25 years')::date)::text
   where id = probe_id;
  insert into preferences(user_id) values (probe_id)
  on conflict (user_id) do update set age_min = default, age_max = default;
  assert (select age_min from preferences where user_id = probe_id) = 18,
    'a new preference row must start at 18';
  assert (select column_default from information_schema.columns
           where table_schema = 'public' and table_name = 'preferences'
             and column_name = 'age_min') = '18',
    'the column default must be 18';

  -- 5. The floor holds even when the app is not in the way.
  begin
    update preferences set age_min = 17 where user_id = probe_id;
    assert false, 'a preference floor below 18 was stored';
  exception
    when check_violation then null;
  end;
  begin
    update preferences set age_min = 40, age_max = 20 where user_id = probe_id;
    assert false, 'an inverted age range was stored';
  exception
    when check_violation then null;
  end;
  update preferences set age_min = 18, age_max = 99 where user_id = probe_id;

  -- 6. A member with no birthday cannot slip through by being onboarded.
  started := false;
  begin
    insert into profiles(auth_user_id, name, birthdate, onboarded)
    values ('00000000-0000-4000-8000-0000000000aa', 'No Birthday', null, true);
    assert false, 'an onboarded profile was created without a birthday';
  exception
    when others then
      started := true;
  end;
  assert started, 'onboarded without a birthday must be refused';
end
$test$;
rollback;
