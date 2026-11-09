-- Runs on a throwaway migrated database only.
begin;
do $test$
declare au uuid; vu uuid; ou uuid; aid bigint; vid bigint; oid bigint; pid bigint; mid bigint; r jsonb; denied boolean;
begin
  select id into au from auth.users where email='marcus@crushly.app';
  select id into vu from auth.users where email='daniel@crushly.app';
  select id into aid from profiles where auth_user_id=au;
  select id into vid from profiles where auth_user_id=vu;
  select auth_user_id,id into ou,oid from profiles where id not in (aid,vid) and auth_user_id is not null limit 1;
  assert au is not null and vu is not null and ou is not null;
  update privacy set profile_visibility='everyone',incognito=false where user_id in (aid,vid,oid);
  delete from blocks where (blocker_id in (aid,vid,oid) and blocked_id in (aid,vid,oid));
  insert into posts(author_id,body,audience) values(aid,'viewstest','everyone') returning id into pid;
  insert into moments(user_id,kind,body,audience,created_at,expires_at) values(aid,'text','viewstest','everyone',now_ms(),now_ms()+3600000) returning id into mid;
  perform set_config('request.jwt.claim.sub',vu::text,true);
  set local role authenticated;
  perform record_post_view(pid,2000,false,null);
  denied:=false; begin insert into moment_views(moment_id,user_id) values(mid,vid); exception when others then denied:=true; end;
  assert denied, 'direct moment-view writes allowed';
  perform view_moment(mid);
  r:=load_post(pid);
  assert (r->>'viewCount')::int=1 and not (r ? 'viewers'), 'post viewer gets count without identities';
  denied:=false; begin perform post_viewers(pid); exception when others then denied:=true; end;
  assert denied, 'post viewer identities leaked to non-owner';
  denied:=false; begin perform moment_viewers(mid); exception when others then denied:=true; end;
  assert denied, 'moment count or identities leaked to non-owner';
  r:=(select x from visible_moments() x where (x->>'id')::bigint=mid);
  assert r is not null and not (r ? 'viewCount') and not (r ? 'viewers'), 'moment payload leaked counts or list';
  reset role;
  -- Simulate repeat qualifying views; unique accounts rather than events count.
  insert into post_feedback(post_id,viewer_id,kind,dwell_ms) values(pid,vid,'view',2000),(pid,aid,'view',2000);
  perform set_config('request.jwt.claim.sub',au::text,true);
  set local role authenticated;
  r:=load_post(pid);
  assert (r->>'viewCount')::int=1, 'repeats or owner views inflated count';
  r:=post_viewers(pid); assert jsonb_array_length(r->'items')=1 and (r->'items'->0->'profile'->>'id')::bigint=vid, 'owner post viewer list incorrect';
  r:=moment_viewers(mid); assert (r->>'count')::int=1 and (r->'items'->0->'profile'->>'id')::bigint=vid, 'owner moment viewer list incorrect';
  perform edit_post(pid,null,'private',null);
  perform set_config('request.jwt.claim.sub',ou::text,true);
  assert post_engagement(pid,aid)->'viewCount'='null'::jsonb, 'forged viewer parameter leaked private count';
  denied:=false; begin perform post_viewers(pid); exception when others then denied:=true; end;
  assert denied, 'private post list leaked to stranger';
  denied:=false; begin perform moment_viewers(mid); exception when others then denied:=true; end;
  assert denied, 'moment list leaked to stranger';
  reset role;
  raise notice 'viewer privacy tests passed';
end $test$;
rollback;
