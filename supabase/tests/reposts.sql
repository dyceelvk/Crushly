-- Native repost relationship tests. Runs against the throwaway migrated/seeded DB.
begin;
do $test$
declare
  author_uuid   uuid;
  reposter_uuid uuid;
  other_uuid    uuid;
  viewer_uuid   uuid;
  author_id     bigint;
  reposter_id   bigint;
  other_id      bigint;
  viewer_id     bigint;
  post_id       bigint;
  r             jsonb;
  item          jsonb;
  n             integer;
  failed        boolean;
begin
  select id into author_uuid from auth.users where email = 'daniel@crushly.app';
  select id into reposter_uuid from auth.users where email = 'marcus@crushly.app';
  select id into other_uuid from auth.users where email = 'ade@crushly.app';
  select id into viewer_uuid from auth.users where email = 'ryan@crushly.app';
  select id into author_id from profiles where auth_user_id = author_uuid;
  select id into reposter_id from profiles where auth_user_id = reposter_uuid;
  select id into other_id from profiles where auth_user_id = other_uuid;
  select id into viewer_id from profiles where auth_user_id = viewer_uuid;
  assert author_id is not null and reposter_id is not null and other_id is not null and viewer_id is not null;

  update profiles set onboarded = true, status = 'active' where id in (author_id, reposter_id, other_id, viewer_id);
  update privacy set profile_visibility = 'everyone', incognito = false, allow_reposts = true
   where user_id in (author_id, reposter_id, other_id, viewer_id);
  update notification_settings set reposts = true where user_id = author_id;
  delete from blocks where (blocker_id in (author_id, reposter_id, other_id, viewer_id)
                         and blocked_id in (author_id, reposter_id, other_id, viewer_id));
  delete from notifications where user_id = author_id and kind = 'post_repost';

  insert into posts (author_id, body, audience, moderation_state)
    values (author_id, 'canonical repost fixture', 'everyone', 'visible')
    returning id into post_id;

  -- First repost is persisted, canonical, and announces the original creator.
  perform set_config('request.jwt.claim.sub', reposter_uuid::text, false);
  set local role authenticated;
  r := public.repost_post(post_id, true);
  reset role;
  assert (r->>'originalPostId')::bigint = post_id, 'repost did not reference original id';
  assert (r->>'reposted')::boolean and (r->>'repostCount')::integer = 1, 'first repost state/count wrong';
  assert (select count(*) from post_reposts pr where pr.original_post_id = post_id and pr.reposter_id = (select p.id from profiles p where p.auth_user_id = reposter_uuid)) = 1, 'relationship was not persisted';
  assert (select count(*) from posts where id = post_id) = 1, 'repost copied/replaced the post';
  assert (select count(*) from notifications where user_id = author_id and kind = 'post_repost' and actor_id = reposter_id and ref_id = post_id) = 1, 'creator was not notified once';

  -- Repeating the same server mutation is idempotent: the primary key prevents
  -- duplicate active relationships and the unread notification remains one row.
  perform set_config('request.jwt.claim.sub', reposter_uuid::text, false);
  set local role authenticated;
  r := public.repost_post(post_id, true);
  reset role;
  assert (r->>'repostCount')::integer = 1, 'duplicate repost inflated count';
  assert (select count(*) from post_reposts pr where pr.original_post_id = post_id and pr.reposter_id = (select p.id from profiles p where p.auth_user_id = reposter_uuid)) = 1, 'duplicate repost row exists';
  assert (select count(*) from notifications where user_id = author_id and kind = 'post_repost' and actor_id = reposter_id and ref_id = post_id) = 1, 'duplicate repost notification exists';

  -- A second member gets an independent relationship but the original remains
  -- one feed item with canonical author/timestamp/media and one canonical count.
  perform set_config('request.jwt.claim.sub', other_uuid::text, false);
  set local role authenticated;
  r := public.repost_post(post_id, true);
  reset role;
  assert (r->>'repostCount')::integer = 2, 'multiple reposters were not counted';
  assert (select count(*) from notifications where user_id = author_id and kind = 'post_repost' and ref_id = post_id) = 2, 'multiple reposters did not notify independently';

  perform set_config('request.jwt.claim.sub', viewer_uuid::text, false);
  r := public.flow_feed(50, null);
  select value into item from jsonb_array_elements(r->'items') value where (value->>'id')::bigint = post_id limit 1;
  assert item is not null, 'reposted original missing from Flow';
  assert (item->'author'->>'id')::bigint = author_id, 'reposter replaced canonical author';
  assert (item->>'createdAt')::bigint = (select created_at from posts where id = post_id), 'original timestamp changed';
  assert (item->>'repostCount')::integer = 2, 'feed repost count is not canonical';
  assert (item->'repostedBy'->>'id')::bigint in (reposter_id, other_id), 'feed attribution missing';

  -- The reposter's profile/grid contains the same original exactly once, with a
  -- profile-specific repost attribution and the original author's identity.
  r := public.space_posts(reposter_id, 50, null);
  select count(*) into n from jsonb_array_elements(r->'items') value where (value->>'id')::bigint = post_id;
  assert n = 1, 'profile grid duplicated the canonical original';
  select value into item from jsonb_array_elements(r->'items') value where (value->>'id')::bigint = post_id limit 1;
  assert (item->'author'->>'id')::bigint = author_id, 'profile grid made reposter the author';
  assert (item->'repostedBy'->>'id')::bigint = reposter_id, 'profile grid lacks subtle repost attribution';

  -- Undo removes only the relationship and distribution; it does not remove the
  -- original post or change its engagement.
  perform set_config('request.jwt.claim.sub', reposter_uuid::text, false);
  set local role authenticated;
  r := public.repost_post(post_id, false);
  reset role;
  assert not (r->>'reposted')::boolean and (r->>'repostCount')::integer = 1, 'undo did not remove only caller relationship';
  assert (select count(*) from post_reposts pr where pr.original_post_id = post_id and pr.reposter_id = (select p.id from profiles p where p.auth_user_id = reposter_uuid)) = 0, 'undo left relationship';
  assert (select count(*) from posts where id = post_id) = 1, 'undo removed original post';

  -- Creator permission is enforced server-side and can be changed without
  -- bypassing the canonical post's own visibility.
  update privacy set allow_reposts = false where user_id = author_id;
  perform set_config('request.jwt.claim.sub', reposter_uuid::text, false);
  failed := false;
  begin
    set local role authenticated;
    perform public.repost_post(post_id, true);
    reset role;
  exception when others then
    failed := true;
    reset role;
  end;
  assert failed, 'creator repost setting was bypassed';
  update privacy set allow_reposts = true where user_id = author_id;

  -- A blocked reposter is not exposed as attribution/count to the viewer.
  perform set_config('request.jwt.claim.sub', reposter_uuid::text, false);
  set local role authenticated;
  perform public.repost_post(post_id, true);
  reset role;
  insert into blocks(blocker_id, blocked_id) values (viewer_id, reposter_id) on conflict do nothing;
  perform set_config('request.jwt.claim.sub', viewer_uuid::text, false);
  r := public.load_post(post_id);
  assert coalesce((r->>'repostCount')::integer, 0) = 1, 'blocked reposter leaked into count';
  assert (r->'repostedBy'->>'id')::bigint = other_id, 'blocked reposter leaked into attribution';
  delete from blocks where blocker_id = viewer_id and blocked_id = reposter_id;

  -- Moderated/unavailable originals cannot be newly reposted or distributed.
  update posts set moderation_state = 'review' where id = post_id;
  perform set_config('request.jwt.claim.sub', viewer_uuid::text, false);
  failed := false;
  begin
    set local role authenticated;
    perform public.repost_post(post_id, true);
    reset role;
  exception when others then
    failed := true;
    reset role;
  end;
  assert failed, 'moderated post was repostable';
  r := public.flow_feed(50, null);
  assert not exists (select 1 from jsonb_array_elements(r->'items') value where (value->>'id')::bigint = post_id), 'moderated post reached Flow';

  -- Preference-off notifications do not create duplicate/surprise rows.
  update posts set moderation_state = 'visible' where id = post_id;
  delete from notifications where user_id = author_id and kind = 'post_repost';
  update notification_settings set reposts = false where user_id = author_id;
  perform set_config('request.jwt.claim.sub', other_uuid::text, false);
  set local role authenticated;
  perform public.repost_post(post_id, false);
  perform public.repost_post(post_id, true);
  reset role;
  assert not exists (select 1 from notifications where user_id = author_id and kind = 'post_repost'), 'repost notification preference was ignored';

  raise notice 'native repost relationship, privacy, profile, feed and notification tests passed';
end $test$;
rollback;
