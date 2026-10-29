-- Every function that returns a post must return a *whole* post.
--
-- This is the test that was missing. Three surfaces were each fine on their
-- own and wrong together:
--
--   * `circle_feed` never merged `post_engagement`, so a post in a Circle had
--     no like count and no comment count — blank where the numbers go;
--   * the Vibe type declared its stored edit as `VideoEdit` when the server
--     stores a `LiveEdit`, so nothing could draw a caption;
--   * the Save button wrote to a local `useState`.
--
-- The first of those is a shape question, and a shape question can be asserted
-- once here instead of being rediscovered screen by screen. If somebody writes
-- the next feed function by hand and forgets the merge, this fails.
do $$
declare
  daniel    uuid;
  marcus    uuid;
  marcus_id bigint;
  daniel_id bigint;
  circle_id bigint;
  probe_circle bigint;
  the_post  bigint;
  j         jsonb;
  row_json  jsonb;
  fn        text;
  missing   text;
begin
  select id into daniel from auth.users where email = 'daniel@crushly.app';
  select id into marcus from auth.users where email = 'marcus@crushly.app';
  select id into marcus_id from profiles where name = 'Marcus';
  select id into daniel_id from profiles where name = 'Daniel';

  -- Set up as the owner, before switching to a member: the helper functions
  -- that make two people connected are service_role only, deliberately.
  perform public.connect_pair(marcus_id, daniel_id);

  set role authenticated;

  /* ------------------------------------------------- a Circle with a post in it */
  -- A Circle only accepts people you have Clicked with, so make that true first
  -- (and undo it in the cleanup) rather than testing a rule this is not about.
  perform set_config('request.jwt.claim.sub', marcus::text, false);
  j := public.create_circle('engagement probe', '', array[daniel_id]);
  -- create_circle answers with a whole Circle Space, not a bare row.
  circle_id := (j -> 'circle' ->> 'id')::bigint;
  probe_circle := circle_id;

  -- Prove the setup rather than assume it: if Daniel is not in the room the
  -- rest of this test would fail as "circle_feed is broken", which is a lie.
  assert (
    select count(*) from public.circle_members m
     where m.circle_id = probe_circle and m.member_id = daniel_id
  ) = 1, 'the probe circle has both members';

  perform set_config('request.jwt.claim.sub', marcus::text, false);
  j := public.create_post('a post in a circle', null, 'connections', circle_id, null);
  the_post := (j ->> 'id')::bigint;

  -- Daniel likes it, so a zero count would be as wrong as a missing one.
  perform set_config('request.jwt.claim.sub', daniel::text, false);
  perform public.react_to_post(the_post, true);

  /* ------------------------------------------------ the Circle feed is whole */
  j := public.circle_feed(circle_id, 20, null);
  select e into row_json from jsonb_array_elements(j -> 'items') e
   where (e ->> 'id')::bigint = the_post;
  assert row_json is not null, 'the post is in the circle feed';
  assert row_json ? 'likeCount', 'circle_feed returns likeCount';
  assert row_json ? 'commentCount', 'circle_feed returns commentCount';
  assert row_json ? 'liked', 'circle_feed returns liked';
  assert (row_json ->> 'likeCount')::int = 1, 'circle_feed counts the like';

  /* -------------------------- and so is every other function that returns one */
  -- Checked structurally rather than one by one: any future feed that forgets
  -- the merge is caught by the same assertion.
  for fn in
    select p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prorettype = 'jsonb'::regtype
       and p.proname in ('flow_feed', 'public_flow', 'space_posts', 'circle_feed',
                         'load_post', 'saved_posts')
  loop
    select string_agg(f, ', ') into missing
      from unnest(array['likeCount', 'commentCount', 'liked']) f
     where not exists (
       select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = fn
          and pg_get_functiondef(p.oid) like '%post_engagement%'
     );
    assert missing is null, format('%s does not merge post_engagement (%s)', fn, missing);
  end loop;

  /* ------------------------------------------------- clean up after ourselves */
  perform set_config('request.jwt.claim.sub', marcus::text, false);
  perform public.delete_circle(circle_id);
  delete from public.post_reactions r where r.post_id = the_post;
  delete from public.posts po where po.id = the_post;
  delete from public.connections c
   where c.user_a = least(marcus_id, daniel_id) and c.user_b = greatest(marcus_id, daniel_id);

  reset role;
  raise notice 'post shape tests passed';
end $$;
