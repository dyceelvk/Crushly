-- DESTRUCTIVE synthetic fixture for disposable DB only. Run in same psql
-- session immediately before candidate 12 and 18_reset_scope_after.sql.
create temporary table reset_scope_snapshot (key text primary key, digest text) on commit preserve rows;
do $$
declare c public.conversations; m bigint;
begin
 select * into c from public.conversations limit 1;
 assert c.id is not null;
 insert into public.messages(conversation_id,sender_id,kind,body) values(c.id,c.user_a,'text','synthetic reset scope') returning id into m;
 insert into public.hidden_whispers(message_id,user_id) values(m,c.user_b);
 insert into public.message_reactions(message_id,user_id) values(m,c.user_b);
 insert into public.notifications(user_id,actor_id,kind,ref_id,body) values
  (c.user_b,c.user_a,'message',c.id,'reset-target-message'),
  (c.user_b,c.user_a,'moment_reply',c.id,'reset-target-moment-reply'),
  (c.user_b,c.user_a,'moment_reaction',c.id,'must-keep-unrelated-moment-reaction'),
  (c.user_b,c.user_a,'post_comment',c.id,'must-keep-unrelated-post-comment'),
  (c.user_b,c.user_a,'moment_reply',9223372036854775807,'must-keep-unmatched-reply');
 update public.privacy set who_can_message='everyone' where user_id=c.user_b;
end $$;
insert into reset_scope_snapshot select 'profiles',md5(coalesce(string_agg(to_jsonb(t)::text,',' order by id),'')) from public.profiles t;
insert into reset_scope_snapshot select 'privacy',md5(coalesce(string_agg(to_jsonb(t)::text,',' order by user_id),'')) from public.privacy t;
insert into reset_scope_snapshot select 'posts',md5(coalesce(string_agg(to_jsonb(t)::text,',' order by id),'')) from public.posts t;
insert into reset_scope_snapshot select 'moments',md5(coalesce(string_agg(to_jsonb(t)::text,',' order by id),'')) from public.moments t;
insert into reset_scope_snapshot select 'connections',md5(coalesce(string_agg(to_jsonb(t)::text,',' order by user_a,user_b),'')) from public.connections t;
insert into reset_scope_snapshot select 'follows',md5(coalesce(string_agg(to_jsonb(t)::text,',' order by follower_id,followed_id),'')) from public.holup_follows t;
insert into reset_scope_snapshot select 'homies',md5(coalesce(string_agg(to_jsonb(t)::text,',' order by user_a,user_b),'')) from public.holup_homies t;
insert into reset_scope_snapshot select 'notifications',md5(coalesce(string_agg(to_jsonb(t)::text,',' order by id),'')) from public.notifications t where not (kind in ('message','moment_reply') and exists (select 1 from public.conversations c where c.id=t.ref_id));
