-- Your own post is a post.
--
-- Three things this pins, each of them a rule that used to be stricter than the
-- product needed to be:
--
--   1. You may Crush your own post, and doing it notifies nobody — not you.
--   2. Crushes carries your own posts alongside the people you share a Crush
--      with, and says which is which.
--   3. Both feeds hand back a cursor and can be walked to the end, so a feed is
--      never silently one page long.
do $$
declare
  viewer_uuid uuid;
  a_uuid      uuid;
  viewer_id   bigint;
  a_id        bigint;
  mine        bigint;
  theirs      bigint;
  oldest      bigint;
  i           integer;
  page1       jsonb;
  page2       jsonb;
  cursor      bigint;
  walked      bigint[];
  ids         bigint[];
  stranger_id bigint;
  before_rows bigint;
begin
  select id into viewer_uuid from auth.users where email = 'daniel@crushly.app';
  select id into a_uuid from auth.users where email = 'marcus@crushly.app';
  select id into viewer_id from profiles where name = 'Daniel';
  select id into a_id from profiles where name = 'Marcus';

  -- ------------------------------------------------- 1. your own post, Crushed

  insert into public.posts (author_id, body, audience, created_at)
    values (viewer_id, 'my own picture', 'everyone', public.now_ms())
    returning id into mine;

  perform set_config('request.jwt.claim.sub', viewer_uuid::text, false);
  set local role authenticated;

  perform public.react_to_post(mine, true, 'crush');

  assert (select exists (select 1 from public.post_reactions r
                          where r.post_id = mine and r.user_id = viewer_id)),
    'you should be able to Crush your own post';
  assert (select (public.post_engagement(mine, viewer_id)->>'likeCount')::int) = 1,
    'your own Crush counts on your own post';
  assert (select (public.post_engagement(mine, viewer_id)->>'liked')::boolean),
    'the post you Crushed must come back liked';

  /* And it is quiet: a notification addressed to yourself is noise, not news. */
  assert not (select exists (select 1 from public.notifications n
                              where n.user_id = viewer_id and n.kind = 'post_reaction'
                                and n.ref_id = mine)),
    'Crushing your own post must not notify you';

  /* Taking it back works like any other post. */
  perform public.react_to_post(mine, false);
  assert (select (public.post_engagement(mine, viewer_id)->>'likeCount')::int) = 0,
    'a Crush on your own post must be reversible';

  -- ------------------------------------- 2. your own post in the Crushes feed

  /* The relation is a fixture, written as the owner: what is under test is the
     feed, not the Crush. */
  reset role;
  insert into public.crushes (from_id, to_id, created_at)
    values (viewer_id, a_id, public.now_ms())
    on conflict do nothing;

  insert into public.posts (author_id, body, audience, created_at)
    values (a_id, 'their picture', 'everyone', public.now_ms() + 10)
    returning id into theirs;

  perform set_config('request.jwt.claim.sub', viewer_uuid::text, false);
  set local role authenticated;

  page1 := public.crush_posts_feed(20, null);
  select array_agg((e->>'id')::bigint) into ids from jsonb_array_elements(page1->'items') e;

  assert mine = any(ids), 'your own post belongs in Crushes';
  assert theirs = any(ids), 'a Crush''s post belongs in Crushes';

  assert (select (e->>'mine')::boolean from jsonb_array_elements(page1->'items') e
           where (e->>'id')::bigint = mine),
    'your own post must be marked as yours in Crushes';
  assert not (select (e->>'mine')::boolean from jsonb_array_elements(page1->'items') e
               where (e->>'id')::bigint = theirs),
    'somebody else''s post must not be marked as yours';

  /* Someone you share no Add up with.
   *
   * This used to assert the opposite — "Crushes is not a firehose: no Crush, no
   * post" — and that rule is what broke the page: a member published in their
   * Space and the post never reached Crushes, because the feed was really a list
   * of the people you had added up with, drawn as posts. Crushes is the
   * discovery surface now, so a member you share nothing with is in it, and what
   * keeps a post out is the audience the author chose, not the absence of a
   * relationship. Both halves are asserted here so neither can drift back:
   *   - their public post belongs in the feed;
   *   - their connections-only post does not.
   *
   * The stranger is found by asking the tables rather than assuming a name: the
   * seed already has Crushes between most of the demo community. */
  reset role;
  select p.id into stranger_id from public.profiles p
   where p.id <> viewer_id
     and not exists (
       select 1 from public.crushes c
        where (c.from_id = viewer_id and c.to_id = p.id)
           or (c.to_id = viewer_id and c.from_id = p.id)
     )
     and not exists (
       select 1 from public.connections cn
        where cn.user_a = least(viewer_id, p.id) and cn.user_b = greatest(viewer_id, p.id)
     )
   order by p.id
   limit 1;

  if stranger_id is not null then
    insert into public.posts (author_id, body, audience, created_at)
      values (stranger_id, 'a stranger', 'everyone', public.now_ms() + 20);
    insert into public.posts (author_id, body, audience, created_at)
      values (stranger_id, 'a stranger, quietly', 'connections', public.now_ms() + 21);

    perform set_config('request.jwt.claim.sub', viewer_uuid::text, false);
    set local role authenticated;
    page1 := public.crush_posts_feed(50, null);
    assert exists (
      select 1 from jsonb_array_elements(page1->'items') e
       where e->>'body' = 'a stranger'
    ), 'Crushes is the discovery feed: a public post belongs in it whoever wrote it';
    assert not exists (
      select 1 from jsonb_array_elements(page1->'items') e
       where e->>'body' = 'a stranger, quietly'
    ), 'a connections-only post must not reach a member who is not a connection';
    reset role;
  end if;

  -- ------------------------------------------------- 3. the feed has an end

  /* Forty posts from a Crush, written as the owner so the times are a fact. */
  reset role;
  for i in 1..40 loop
    insert into public.posts (author_id, body, audience, created_at)
      values (a_id, 'page test ' || i, 'everyone', public.now_ms() - (i * 1000));
  end loop;
  /* The oldest of the forty, not the oldest of everything: a Circle post or a
     clip from the same author is not in this feed and never will be. */
  select id into oldest from public.posts
   where author_id = a_id and body like 'page test %'
   order by created_at asc, id asc limit 1;

  perform set_config('request.jwt.claim.sub', viewer_uuid::text, false);
  set local role authenticated;

  page1 := public.crush_posts_feed(20, null);
  assert jsonb_array_length(page1->'items') = 20, 'a page of 20 should hold 20';
  assert (page1->>'nextCursor') is not null, 'a full page must hand back a cursor';

  cursor := (page1->>'nextCursor')::bigint;
  page2 := public.crush_posts_feed(20, cursor);
  assert jsonb_array_length(page2->'items') = 20, 'the second page should hold the next 20';

  select array_agg((e->>'id')::bigint) into ids from jsonb_array_elements(page1->'items') e;
  assert not exists (
    select 1 from jsonb_array_elements(page2->'items') e
     where (e->>'id')::bigint = any(ids)
  ), 'page two must not repeat page one';

  /* Walk it to the end the way the client does: stop when the cursor is null. */
  walked := array[]::bigint[];
  select array_agg((e->>'id')::bigint) into ids from jsonb_array_elements(page1->'items') e;
  walked := walked || ids;
  cursor := (page1->>'nextCursor')::bigint;
  while cursor is not null loop
    page2 := public.crush_posts_feed(20, cursor);
    select array_agg((e->>'id')::bigint) into ids from jsonb_array_elements(page2->'items') e;
    walked := walked || coalesce(ids, array[]::bigint[]);
    cursor := nullif(page2->>'nextCursor', '')::bigint;
    exit when jsonb_array_length(page2->'items') = 0;
  end loop;

  /* Paging has to be worth something: walked page by page, the feed must hold
     exactly what one unhurried request would have returned. Comparing against a
     single big page rather than against a hand-written visibility query keeps
     this test about the cursor instead of re-implementing the feed in the test. */
  /* Crushes can hold more posts than one request may return — the cap is 50 —
     so "the walk equals one big page" is only true on a small feed. What has to
     hold on any feed: the walk reaches every post the first big page holds, and
     it never hands the same post back twice. */
  assert not exists (
    select 1 from jsonb_array_elements(public.crush_posts_feed(50, null)->'items') e
     where (e->>'id')::bigint <> all(walked)
  ), 'walking the cursor must reach every post one big page would return';
  assert (select count(*) from unnest(walked) w) = (select count(distinct w) from unnest(walked) w),
    'a walk must not hand the same post back twice';
  assert (select count(distinct w) from unnest(walked) w) > 20,
    'the fixture must be longer than a single page, or paging is not being tested';
  assert oldest = any(walked), 'the last post of a Space must be reachable by paging';

  -- ------------------------------------------------- and a Space pages too

  page1 := public.space_posts(a_id, 20, null);
  assert jsonb_array_length(page1->'items') = 20, 'a Space page of 20 should hold 20';
  assert (page1->>'nextCursor') is not null, 'a full Space page must hand back a cursor';

  cursor := (page1->>'nextCursor')::bigint;
  page2 := public.space_posts(a_id, 20, cursor);
  select array_agg((e->>'id')::bigint) into ids from jsonb_array_elements(page1->'items') e;
  assert not exists (
    select 1 from jsonb_array_elements(page2->'items') e
     where (e->>'id')::bigint = any(ids)
  ), 'the second Space page must not repeat the first';

  /* A short page is the end, and says so. */
  page1 := public.space_posts(viewer_id, 50, null);
  assert (page1->>'nextCursor') is null,
    'a page that returned everything must not pretend there is more';
end $$;
reset role;
