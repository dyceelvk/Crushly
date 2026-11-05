-- Clips are back, and Discover has a rail of them.
--
-- The rail is a public surface with a ranking, which is exactly the kind of
-- thing that quietly leaks: a clip written into a Circle, a clip from someone
-- this member is blocked with, a clip the member may not see. So this asserts
-- what the rail is *for* — public clips, one per author, newest-and-most-Crushed
-- first — and what it is never allowed to be.
do $$
declare
  viewer_uuid uuid;
  a_uuid      uuid;
  b_uuid      uuid;
  viewer_id   bigint;
  a_id        bigint;
  b_id        bigint;
  clip_a      bigint;
  clip_b      bigint;
  clip_a2     bigint;
  photo_a     bigint;
  circle_clip bigint;
  circle_id   bigint;
  rail        jsonb;
  ids         bigint[];
begin
  select id into viewer_uuid from auth.users where email = 'daniel@crushly.app';
  select id into a_uuid from auth.users where email = 'marcus@crushly.app';
  select id into b_uuid from auth.users where email = 'jayden@crushly.app';
  select id into viewer_id from profiles where name = 'Daniel';
  select id into a_id from profiles where name = 'Marcus';
  select id into b_id from profiles where name = 'Jayden';

  insert into public.circles (owner_id, name, about, discoverable, join_policy)
    values (a_id, 'Clips Room', 'a room', false, 'invite')
    returning id into circle_id;

  -- As the schema owner: these fixtures are not what is being tested, the
  -- ranking and the visibility are.
  insert into public.posts (author_id, body, media_url, audience)
    values (a_id, 'first clip', 'https://cdn.example.com/a/one.mp4', 'everyone')
    returning id into clip_a;
  insert into public.posts (author_id, body, media_url, audience)
    values (a_id, 'same author, newer', 'https://cdn.example.com/a/two.mp4', 'everyone')
    returning id into clip_a2;
  insert into public.posts (author_id, body, media_url, audience)
    values (b_id, 'another clip', 'https://cdn.example.com/b/one.mov', 'everyone')
    returning id into clip_b;
  insert into public.posts (author_id, body, media_url, audience)
    values (a_id, 'just a photo', 'https://cdn.example.com/a/one.jpg', 'everyone')
    returning id into photo_a;
  insert into public.posts (author_id, body, media_url, audience, circle_id)
    values (a_id, 'a clip for the room', 'https://cdn.example.com/a/circle.mp4', 'connections', circle_id)
    returning id into circle_clip;
  insert into public.circle_members (circle_id, member_id, role) values (circle_id, a_id, 'owner');

  perform set_config('request.jwt.claim.sub', viewer_uuid::text, false);
  set role authenticated;

  rail := public.trending_clips(12);
  select array_agg((e->>'id')::bigint) into ids from jsonb_array_elements(rail) e;

  assert ids is not null, 'the rail came back as nothing at all';

  /* Only clips: a photograph is not a clip, however recent. */
  assert not (photo_a = any(ids)), 'a photo must never be in the clips rail';

  /* A Circle's clip is not public surface. */
  assert not (circle_clip = any(ids)), 'a Circle clip must never be in the public rail';

  /* One per author: Marcus has two clips, and only one may appear. */
  assert (select count(*) from jsonb_array_elements(rail) e
           where (e->>'author'->>'id')::bigint = a_id) = 1,
    'the rail should carry one clip per author';

  /* And the one it carries is his newest, because same author means same score. */
  assert (clip_a2 = any(ids)) and not (clip_a = any(ids)),
    'the newest clip of an author is the one the rail keeps';

  /* Everything on the rail is a clip, by the field the client reads. */
  assert (select bool_and(e->>'mediaKind' = 'video') from jsonb_array_elements(rail) e),
    'every rail item must be mediaKind video';

  /* The number under a tile is the number the feed would show. */
  assert (select bool_and((e->>'likeCount') is not null and (e->>'commentCount') is not null)
            from jsonb_array_elements(rail) e),
    'a rail item must carry its Crushes and comments, or the tile has nothing to say';

  /* Crushes raise a clip. Written as the schema owner: a reaction is the
     fixture here, the counting is the thing under test. */
  reset role;
  insert into public.post_reactions (post_id, user_id) values (clip_b, viewer_id), (clip_b, a_id);
  set role authenticated;

  assert (select (e->>'likeCount')::int from jsonb_array_elements(public.trending_clips(12)) e
           where (e->>'id')::bigint = clip_b) = 2,
    'Crushes should be counted on the rail';

  /* A blocked pair never sees each other's clips. */
  reset role;
  insert into public.blocks (blocker_id, blocked_id) values (b_id, viewer_id);
  set role authenticated;
  rail := public.trending_clips(12);
  select array_agg((e->>'id')::bigint) into ids from jsonb_array_elements(rail) e;
  assert not (clip_b = any(ids)), 'a clip from someone who blocked you is not yours to see';

  /* The limit is honoured, and it is not a way to ask for a thousand rows. */
  assert jsonb_array_length(public.trending_clips(1)) <= 1, 'the limit is not honoured';
  assert jsonb_array_length(public.trending_clips(1000)) <= 24, 'the limit is not capped';
end $$;
reset role;
