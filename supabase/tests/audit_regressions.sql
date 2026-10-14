-- Security/integration regressions from the 2026-10-13 audit.
-- Fixture writes use the migration owner; assertions explicitly switch to
-- authenticated/anon. Roll back everything so the existing smoke suite runs
-- against an unchanged seed.
begin;
do $$
declare
  uid uuid;
  peer_uid uuid;
  me bigint;
  peer bigint;
  own_path text;
  peer_path text;
  pid bigint;
  cid bigint;
  j jsonb;
  n integer;
begin
  select auth_user_id, id into uid, me from profiles where name = 'Daniel';
  select auth_user_id, id into peer_uid, peer from profiles where name = 'Marcus';
  own_path := 'photos/' || me || '/audit.jpg';
  peer_path := 'photos/' || peer || '/audit.jpg';
  insert into photos(user_id,url) values (me, 'https://worker.example/m/' || own_path), (peer, peer_path);
  insert into storage.objects(bucket_id,name) values ('media', peer_path);
  assert not (select public from storage.buckets where id = 'media'), 'legacy bucket must be private';

  perform set_config('request.jwt.claim.sub', uid::text, true);
  set local role authenticated;
  begin
    update profiles set username = 'support' where id = me;
    raise exception 'direct reserved handle update accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    update profiles set username_updated_at = 0 where id = me;
    raise exception 'direct cooldown reset accepted';
  exception when insufficient_privilege then null;
  end;
  update profiles set bio = 'Ordinary profile edits still work' where id = me;
  assert (select bio from profiles where id = me) = 'Ordinary profile edits still work';
  begin
    perform set_username('support');
    raise exception 'RPC reserved handle accepted';
  exception when others then
    if sqlerrm not like '%reserved%' or sqlerrm = 'RPC reserved handle accepted' then raise; end if;
  end;
  perform set_username('audit_member');
  begin
    perform set_username('audit_member_two');
    raise exception 'RPC cooldown bypassed';
  exception when others then
    if sqlerrm not like '%once a day%' then raise; end if;
  end;

  -- /m/ URL parsing preserves ownership and exact object identity.
  assert can_manage_media(own_path, 'https://worker.example/m/' || own_path);
  assert can_manage_media(own_path);
  assert not can_manage_media(own_path, 'https://worker.example/m/' || peer_path);
  assert not can_manage_media(own_path, 'https://worker.example/m/photos/' || me || '/different.jpg');
  assert not can_manage_media(peer_path, 'https://worker.example/m/' || peer_path);
  assert not can_manage_media(null);
  assert (can_view_media(own_path)->>'allowed')::boolean;
  assert not (can_view_media(own_path)->>'cacheable')::boolean;
  assert not (can_view_media('photos/' || me || '/missing.jpg')->>'allowed')::boolean;
  assert not (can_view_media(own_path, 'https://worker.example/m/' || peer_path)->>'allowed')::boolean;
  assert (can_view_media(peer_path)->>'allowed')::boolean;
  assert (select count(*) from storage.objects where name=peer_path) = 1, 'authorized legacy read';

  reset role;
  insert into blocks(blocker_id,blocked_id) values (me,peer);
  set local role authenticated;
  assert not (can_view_media(peer_path)->>'allowed')::boolean, 'saved URL must respect blocks';
  assert (select count(*) from storage.objects where name=peer_path) = 0, 'legacy RLS must respect blocks';
  reset role;
  delete from blocks where blocker_id=me and blocked_id=peer;
  delete from connections where user_a=least(me,peer) and user_b=greatest(me,peer);
  update privacy set profile_visibility='connections' where user_id=peer;
  set local role authenticated;
  assert not (can_view_media(peer_path)->>'allowed')::boolean, 'private non-connection photo';
  reset role;
  insert into connections(user_a,user_b) values (least(me,peer), greatest(me,peer));
  set local role authenticated;
  assert (can_view_media(peer_path)->>'allowed')::boolean, 'connection can see private photo';
  delete from photos where user_id=me and url='https://worker.example/m/' || own_path;
  assert not (can_view_media(own_path)->>'allowed')::boolean, 'deleted photo row revokes saved URL';
  assert can_manage_media(own_path, 'https://worker.example/m/' || own_path), 'owner may clean orphan';

  -- No direct legacy upload route, even when the Worker is unavailable.
  begin
    insert into storage.objects(bucket_id,name) values ('media','messages/' || me || '/fallback.jpg');
    raise exception 'legacy fallback upload accepted';
  exception when insufficient_privilege then null;
  end;
  reset role;
  set local role anon;
  assert (select count(*) from storage.objects where bucket_id='media')=0, 'anonymous media is private';
  reset role;
  set local role authenticated;

  -- A copied URL in a new public post cannot grant access to someone else's
  -- private file. Resolve only rows owned by the original upload folder.
  reset role;
  insert into blocks(blocker_id,blocked_id) values (me,peer);
  insert into posts(author_id,body,audience,media_url)
    values (me,'forged reference','everyone','https://worker.example/m/posts/' || peer || '/private.jpg');
  set local role authenticated;
  assert not (can_view_media('posts/' || peer || '/private.jpg')->>'allowed')::boolean;
  reset role;
  delete from blocks where blocker_id=me and blocked_id=peer;
  set local role authenticated;

  -- Reservations, not text activity or published rows, consume the quota.
  for i in 1..40 loop
    j := media_upload_ticket('vibes', 'video/mp4', 1024);
    assert j->>'path' like 'vibes/' || me || '/%';
  end loop;
  begin
    perform media_upload_ticket('messages', 'image/jpeg', 1024);
    raise exception '41st upload accepted';
  exception when others then
    if sqlerrm not like '%429%' then raise; end if;
  end;
  begin
    delete from media_upload_reservations where user_id=me;
    raise exception 'member erased upload quota';
  exception when insufficient_privilege then null;
  end;
  reset role;
  assert (select count(*) from media_upload_reservations where user_id=me)=40;
  update media_upload_reservations set created_at=public.now_ms()-3601*1000 where user_id=me;
  -- A large amount of unrelated text activity must not block new uploads.
  insert into moments(user_id,kind,body,style,audience,expires_at)
    select me,'text','busy conversation','noir','everyone',public.now_ms()+3600000 from generate_series(1,45);
  set local role authenticated;
  perform media_upload_ticket('moments', 'image/jpeg', 1024);
  reset role;

  -- Visibility before LIMIT: blocked new rows cannot hide older visible ones.
  delete from posts;
  update privacy set profile_visibility='everyone' where user_id=peer;
  insert into posts(author_id,body,audience,created_at) values (me,'visible older','everyone',1) returning id into pid;
  insert into posts(author_id,body,audience,created_at) values (peer,'blocked newer','everyone',2);
  insert into blocks(blocker_id,blocked_id) values (me,peer);
  set local role authenticated;
  j := flow_feed(1);
  assert jsonb_array_length(j->'items')=1;
  assert (j->'items'->0->>'id')::bigint=pid;
  reset role;

  -- Public feed skips blocked authors too (own posts are deliberately excluded).
  insert into posts(author_id,body,audience,created_at)
    select id,'public older','everyone',0 from profiles where name='Jayden' returning id into pid;
  set local role authenticated;
  j := public_flow_feed(1);
  assert jsonb_array_length(j->'items')=1;
  assert (j->'items'->0->>'id')::bigint=pid;
  reset role;

  insert into circles(owner_id,name) values (me,'Audit circle') returning id into cid;
  insert into circle_members(circle_id,member_id) values (cid,me),(cid,peer);
  insert into posts(author_id,body,audience,circle_id,created_at)
    values (me,'circle visible','circle',cid,1) returning id into pid;
  insert into posts(author_id,body,audience,circle_id,created_at)
    values (peer,'circle blocked','circle',cid,2);
  set local role authenticated;
  j := circle_feed(cid,1);
  assert jsonb_array_length(j->'items')=1;
  assert (j->'items'->0->>'id')::bigint=pid;
  reset role;

  -- Aggregate only the limited subset, preserving oldest-first order.
  insert into post_comments(post_id,author_id,body,created_at)
    select pid,me,'comment ' || i,i from generate_series(1,3) i;
  set local role authenticated;
  j := post_comments_feed(pid,1);
  assert jsonb_array_length(j->'items')=1;
  assert j->'items'->0->>'body'='comment 1';
  assert jsonb_array_length(post_comments_feed(pid,2)->'items')=2;
  reset role;
end $$;
rollback;
