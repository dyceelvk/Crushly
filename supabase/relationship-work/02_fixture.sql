-- Disposable test database only; establishes legacy state before conversion.
delete from public.blocks;
delete from public.keeps;
delete from public.connections;
delete from public.crushes;
delete from public.notifications;
update public.profiles set onboarded=true,status='active' where id between 1 and 8;
update public.privacy set profile_visibility='everyone', incognito=false where user_id between 1 and 8;
insert into public.connections(user_a,user_b) values(1,2);
insert into public.conversations(user_a,user_b,closed) values(1,2,false),(1,3,false) on conflict(user_a,user_b) do update set closed=false;
insert into public.keeps(keeper_id,kept_id) values(1,2),(1,3),(4,5),(5,4);
insert into public.crushes(from_id,to_id,status) values(1,2,'accepted'),(1,3,'pending'),(3,1,'accepted'),(1,4,'declined');
