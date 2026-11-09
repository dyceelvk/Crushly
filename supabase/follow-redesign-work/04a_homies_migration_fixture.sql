-- Disposable database only. Set up a grandfathered pair and unaccepted Keeps.
do $$
declare a bigint; b bigint; c bigint;
begin
 select id into a from profiles where auth_user_id=(select id from auth.users where email='marcus@crushly.app');
 select id into b from profiles where auth_user_id=(select id from auth.users where email='daniel@crushly.app');
 select id into c from profiles where auth_user_id=(select id from auth.users where email='tobi@crushly.app');
 update profiles set onboarded=true,status='active' where id in (a,b,c);
 update privacy set profile_visibility='everyone',incognito=false,who_can_crush='everyone' where user_id in (a,b,c);
 delete from blocks where blocker_id in (a,b,c) and blocked_id in (a,b,c);
 insert into connections(user_a,user_b) values(least(a,b),greatest(a,b)) on conflict do nothing;
 insert into holup_existing_close_pairs(user_a,user_b) values(least(a,b),greatest(a,b)) on conflict do nothing;
 insert into keeps(keeper_id,kept_id) values(a,b),(a,c),(c,a) on conflict do nothing;
end $$;
