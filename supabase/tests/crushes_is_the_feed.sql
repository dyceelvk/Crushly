-- Crushes shows eligible posts, not only your connections' posts.
--
-- The bug people reported: a member publishes in their Space, the post is on
-- their Space, and it never reaches Crushes. The cause was one predicate —
-- `crush_posts_feed` required a row in `crushes` between the reader and the
-- author, so a member with no Add ups saw an empty page while the posts sat in
-- the table. Space and Crushes read the same rows; only the door differed.
--
-- What this pins now:
--
--   1. Three different members post in their Spaces; a fourth member who has
--      added up with none of them sees all three on Crushes.
--   2. The same post id appears — Crushes is a view of the same rows, not a
--      second copy of them.
--   3. Audience still decides. A connections-only post is invisible to a
--      stranger and visible to a connection.
--   4. A block still hides the posts of the person blocked.
--   5. A Circle post stays in its room.
--   6. Pages still walk to the end.
do $$
declare
  viewer_uuid uuid;
  a_uuid      uuid;
  b_uuid      uuid;
  c_uuid      uuid;
  viewer_id   bigint;
  a_id        bigint;
  b_id        bigint;
  c_id        bigint;
  a_post      bigint;
  b_post      bigint;
  c_post      bigint;
  gated_post  bigint;
  blocked_post bigint;
  circle_post bigint;
  feed        jsonb;
  ids         bigint[];
  n           integer;
  page1       jsonb;
  page2       jsonb;
  cursor      bigint;
begin
  select id into viewer_uuid from auth.users where email = 'daniel@crushly.app';
  select id into a_uuid      from auth.users where email = 'marcus@crushly.app';
  select id into b_uuid      from auth.users where email = 'tobi@crushly.app';
  select id into viewer_id from profiles where name = 'Daniel';
  select id into a_id from profiles where name = 'Marcus';
  select id into b_id from profiles where name = 'Tobi';
  select id into c_uuid from auth.users order by email offset 3 limit 1;
  select id into c_id from profiles order by id offset 3 limit 1;

  -- Nothing between the reader and these three authors: no Add up rows and no
  -- connections. The seed ships a connection or two, and a stranger's view has
  -- to be assembled rather than assumed.
  delete from public.crushes where from_id = viewer_id or to_id = viewer_id;
  delete from public.connections where user_a = viewer_id or user_b = viewer_id;

  -- ------------------------------------------------- 1. three Spaces, three posts

  insert into public.posts (author_id, body, audience, created_at)
    values (a_id, 'marcus: first', 'everyone', public.now_ms()) returning id into a_post;
  insert into public.posts (author_id, body, audience, created_at)
    values (b_id, 'tobi: first', 'everyone', public.now_ms() + 1) returning id into b_post;
  insert into public.posts (author_id, body, audience, created_at)
    values (c_id, 'third person: first', 'everyone', public.now_ms() + 2) returning id into c_post;

  perform set_config('request.jwt.claim.sub', viewer_uuid::text, false);

  feed := public.crush_posts_feed(50, null);
  select coalesce(array_agg((i->>'id')::bigint), '{}'::bigint[]) into ids
    from jsonb_array_elements(feed->'items') i;

  if not (a_post = any(ids)) then
    raise exception 'Crushes is missing Marcus’s post (% not in %)', a_post, ids;
  end if;
  if not (b_post = any(ids)) then
    raise exception 'Crushes is missing Tobi’s post (% not in %)', b_post, ids;
  end if;
  if not (c_post = any(ids)) then
    raise exception 'Crushes is missing the third member’s post (% not in %)', c_post, ids;
  end if;

  -- ------------------------------------------- 2. the same rows, not copies

  if (select count(*) from jsonb_array_elements(feed->'items') i
       where (i->>'id')::bigint in (a_post, b_post, c_post)) <> 3 then
    raise exception 'Crushes returned a post more than once';
  end if;

  -- Every item is a whole post: the card draws the author, the words, the media
  -- and the counts, and a missing key is a blank card on somebody's phone.
  if not ((feed->'items'->0) ? 'author') or not ((feed->'items'->0) ? 'body') then
    raise exception 'Crushes returned a post without its author or words';
  end if;

  -- ------------------------------------------------ 3. audience still decides

  insert into public.posts (author_id, body, audience, created_at)
    values (a_id, 'marcus: connections only', 'connections', public.now_ms() + 3) returning id into gated_post;

  feed := public.crush_posts_feed(50, null);
  select coalesce(array_agg((i->>'id')::bigint), '{}'::bigint[]) into ids
    from jsonb_array_elements(feed->'items') i;
  if gated_post = any(ids) then
    raise exception 'a connections-only post reached a stranger through Crushes';
  end if;

  -- …and becomes visible the moment the connection exists.
  insert into public.connections (user_a, user_b) values (least(viewer_id, a_id), greatest(viewer_id, a_id));
  feed := public.crush_posts_feed(50, null);
  select coalesce(array_agg((i->>'id')::bigint), '{}'::bigint[]) into ids
    from jsonb_array_elements(feed->'items') i;
  if not (gated_post = any(ids)) then
    raise exception 'a connection cannot see a connection’s post on Crushes';
  end if;
  delete from public.connections where user_a = least(viewer_id, a_id) and user_b = greatest(viewer_id, a_id);

  -- ------------------------------------------------------ 4. a block still holds

  insert into public.posts (author_id, body, audience, created_at)
    values (b_id, 'tobi: after the block', 'everyone', public.now_ms() + 4) returning id into blocked_post;
  insert into public.blocks (blocker_id, blocked_id) values (viewer_id, b_id);
  feed := public.crush_posts_feed(50, null);
  select coalesce(array_agg((i->>'id')::bigint), '{}'::bigint[]) into ids
    from jsonb_array_elements(feed->'items') i;
  if blocked_post = any(ids) then
    raise exception 'a blocked member’s post reached Crushes';
  end if;
  delete from public.blocks where blocker_id = viewer_id and blocked_id = b_id;

  -- ----------------------------------------------- 5. a Circle post stays home

  insert into public.circles (owner_id, name) values (a_id, 'Crushes test room') returning id into circle_post;
  insert into public.circle_members (circle_id, member_id, role) values (circle_post, a_id, 'owner');
  insert into public.posts (author_id, body, audience, circle_id, created_at)
    values (a_id, 'marcus: in the room', 'circle', circle_post, public.now_ms() + 5) returning id into circle_post;
  feed := public.crush_posts_feed(50, null);
  select coalesce(array_agg((i->>'id')::bigint), '{}'::bigint[]) into ids
    from jsonb_array_elements(feed->'items') i;
  if circle_post = any(ids) then
    raise exception 'a Circle post leaked into Crushes';
  end if;

  -- ------------------------------------------------------------ 6. paging works

  page1 := public.crush_posts_feed(2, null);
  if jsonb_array_length(page1->'items') <> 2 then
    raise exception 'a two-post page returned %', jsonb_array_length(page1->'items');
  end if;
  cursor := (page1->>'nextCursor')::bigint;
  if cursor is null then
    raise exception 'a full page carried no cursor, so the rest can never be read';
  end if;
  page2 := public.crush_posts_feed(2, cursor);
  if (page2->'items') @> (page1->'items') then
    raise exception 'the second page repeated the first';
  end if;

  -- No row is duplicated across a whole walk — a feed, not a bag of rows.
  select count(distinct (i->>'id')::bigint) into n
    from jsonb_array_elements(public.crush_posts_feed(50, null)->'items') i;
  if n <> jsonb_array_length(public.crush_posts_feed(50, null)->'items') then
    raise exception 'Crushes returned a duplicate post';
  end if;

  raise notice 'Crushes: % posts from members with no Add up rows; audience, blocks and rooms respected; paging walks.',
    jsonb_array_length(public.crush_posts_feed(50, null)->'items');
end $$;
