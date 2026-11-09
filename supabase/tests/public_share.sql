begin;
do $test$
declare au uuid; aid bigint; pid bigint; r jsonb;
begin
  select id into au from auth.users where email='marcus@crushly.app';
  select id into aid from profiles where auth_user_id=au;
  update profiles set status='active',onboarded=true where id=aid;
  update privacy set profile_visibility='everyone',incognito=false where user_id=aid;
  insert into posts(author_id,body,media_url,audience) values(aid,'public share fixture','posts/'||aid||'/secret.jpg','everyone') returning id into pid;
  set local role anon;
  r:=public_post_preview(pid);
  assert r->>'body'='public share fixture' and not (r ? 'mediaUrl'), 'public preview wrong or exposed protected media';
  reset role;
  update posts set audience='connections' where id=pid;
  set local role anon; assert public_post_preview(pid) is null, 'connections post exposed'; reset role;
  update posts set audience='private' where id=pid;
  set local role anon; assert public_post_preview(pid) is null, 'private post exposed'; reset role;
  update posts set audience='everyone' where id=pid;
  update privacy set incognito=true where user_id=aid;
  set local role anon; assert public_post_preview(pid) is null, 'incognito author exposed'; reset role;
  update privacy set incognito=false,profile_visibility='connections' where user_id=aid;
  set local role anon; assert public_post_preview(pid) is null, 'restricted profile exposed'; reset role;
  raise notice 'public share privacy tests passed';
end $test$;
rollback;
