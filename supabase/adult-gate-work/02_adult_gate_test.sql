-- Destructive disposable database only. Requires migrations/seed and 01 experiment.
begin;
do $test$
declare uid uuid; member_id bigint; denied boolean; b18 text;
begin
 select auth_user_id,id into uid,member_id from profiles where id=7;
 assert public.age_of('2000-02-31') is null, 'invalid date crashed or returned an age';
 assert public.age_of(to_char((current_date-interval '18 years')::date,'YYYY-MM-DD'))=18, 'birthday boundary is wrong';
 b18:=to_char((current_date-interval '18 years')::date,'YYYY-MM-DD');
 -- Incomplete signups can save other fields, not mark themselves onboarded.
 update profiles set onboarded=false,birthdate=null where id=member_id;
 perform set_config('request.jwt.claim.sub',uid::text,true); set local role authenticated;
 update public.profiles set name='Incomplete' where id=member_id;
 denied:=false; begin update public.profiles set onboarded=true where id=member_id; exception when sqlstate 'P0001' then denied:=sqlerrm like '__CRUSHLY__400__invalid_birthday%'; end; assert denied,'missing birthday activated';
 denied:=false; begin update public.profiles set birthdate='2000-02-31' where id=member_id; exception when sqlstate 'P0001' then denied:=sqlerrm like '__CRUSHLY__400__invalid_birthday%'; end; assert denied,'invalid birthday accepted';
 denied:=false; begin update public.profiles set birthdate=to_char((current_date-interval '18 years'+interval '1 day')::date,'YYYY-MM-DD') where id=member_id; exception when sqlstate 'P0001' then denied:=sqlerrm like '__CRUSHLY__403__adult_only%'; end; assert denied,'under-18 birthday accepted';
 update public.profiles set birthdate=b18 where id=member_id;
 update public.profiles set onboarded=true where id=member_id;
 denied:=false; begin update public.profiles set birthdate=null where id=member_id; exception when sqlstate 'P0001' then denied:=true; end; assert denied,'birthday removed from onboarded profile';
 denied:=false; begin update public.profiles set birthdate='1900-01-01' where id=member_id; exception when sqlstate 'P0001' then denied:=true; end; assert denied,'over-99 birthday accepted';
 reset role;
 raise notice 'experimental adult profile age gate tests passed';
end $test$;
rollback;
