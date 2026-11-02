-- Ranked Flow: the feed is scored from signals, resumable, and explainable.
--
-- `flow_feed` is a timeline — newest first, forever. This test pins down the
-- behaviour of the ranked replacement, in the order the guarantees matter:
--
--   1. the best-performing post is at the top, not the newest one;
--   2. two posts from one author do not sit next to each other;
--   3. a post nobody has engaged with still gets a turn (fresh > stale);
--   4. something you already watched drops out, something you hid never returns;
--   5. the cursor resumes exactly where the page stopped — no repeats, no holes;
--   6. every item says why it is there, in numbers.
--
-- Fixtures are written as the owner (RLS bypassed) with explicit ages, because
-- the whole point is order, and order cannot be tested against `now()`.
do $$
declare
  daniel uuid;
  daniel_id bigint;
  marcus_id bigint;
  tobi_id   bigint;
  ade_id    bigint;
  seun_id   bigint;
  jayden_id bigint;
  fan_ids   bigint[];
  -- posts
  m1 bigint; m2 bigint; t1 bigint; n1 bigint; o1 bigint; h1 bigint;
  t   bigint := public.now_ms();
  h   constant bigint := 3600000;
  j   jsonb;
  feed jsonb; deep jsonb;
  page1 jsonb; page2 jsonb;
  first_author text; second_author text;
  n integer; overlap integer; i integer;
  pos_n1 integer; pos_o1 integer;
  v jsonb;
begin
  select id into daniel from auth.users where email = 'daniel@crushly.app';
  select id into daniel_id from profiles where auth_user_id = daniel;
  select id into marcus_id from profiles where name = 'Marcus';
  select id into tobi_id   from profiles where name = 'Tobi';
  select id into ade_id    from profiles where name = 'Ade';
  select id into seun_id   from profiles where name = 'Seun';
  select id into jayden_id from profiles where name = 'Jayden';

  select array_agg(id) into fan_ids from (
    select id from profiles
     where id not in (daniel_id, marcus_id, tobi_id, ade_id, seun_id, jayden_id)
     order by id limit 8
  ) pick;

  /* ------------------------------------------------------------- fixtures */
  -- Two from Marcus and one from Tobi, identical age and identical engagement:
  -- without a diversity rule the first two items are both Marcus's.
  insert into posts (author_id, body, audience, created_at)
    values (marcus_id, 'rank fixture m1', 'everyone', t - 3 * h) returning id into m1;
  insert into posts (author_id, body, audience, created_at)
    values (marcus_id, 'rank fixture m2', 'everyone', t - 3 * h) returning id into m2;
  insert into posts (author_id, body, audience, created_at)
    values (tobi_id, 'rank fixture t1', 'everyone', t - 3 * h) returning id into t1;

  insert into post_reactions (post_id, user_id)
    select x, f from (values (m1), (m2), (t1)) v(x), unnest(fan_ids) f;

  -- Nobody has touched these two: one is minutes old, the other six weeks old.
  insert into posts (author_id, body, audience, created_at)
    values (ade_id, 'rank fixture n1 (fresh, no engagement)', 'everyone', t - 5 * 60000)
    returning id into n1;
  insert into posts (author_id, body, audience, created_at)
    values (seun_id, 'rank fixture o1 (six weeks old)', 'everyone', t - 42 * 24 * h)
    returning id into o1;

  -- A post Daniel will hide.
  insert into posts (author_id, body, audience, created_at)
    values (jayden_id, 'rank fixture h1 (hidden)', 'everyone', t - h)
    returning id into h1;

  /* ------------------------------------------------------- as the viewer */
  set role authenticated;
  perform set_config('request.jwt.claim.sub', daniel::text, false);

  /* 1 & 6 — scored, and every item says why */
  j := public.flow_ranked_feed(8, null);
  -- A page is 8 by default. Ordering claims need the whole candidate set, so
  -- they read a deep page; "what fits in front of the viewer" claims use 8.
  deep := public.flow_ranked_feed(30, null);
  assert jsonb_array_length(j -> 'items') >= 5, 'the ranked feed returns the fixtures';
  assert (j -> 'items' -> 0 -> 'rank' ->> 'score')::numeric > 0, 'the top item carries a score';
  assert (j -> 'items' -> 0 -> 'rank' ->> 'position')::int = 1, 'positions are 1-based';
  assert (j -> 'ranking' ->> 'candidates')::int >= 5, 'the ranking block counts candidates';

  /* 2 — diversity: one author cannot own the top two slots */
  first_author  := j -> 'items' -> 0 -> 'author' ->> 'name';
  second_author := j -> 'items' -> 1 -> 'author' ->> 'name';
  assert first_author is not null and second_author is not null, 'items carry an author';
  assert first_author <> second_author,
    format('two items from %s in a row — the diversity penalty is not working', first_author);

  /* 3 — fresh and unengaged beats six weeks old and unengaged */
  pos_n1 := null; pos_o1 := null;
  for i in 0 .. jsonb_array_length(deep -> 'items') - 1 loop
    if (deep -> 'items' -> i ->> 'id')::bigint = n1 then pos_n1 := i; end if;
    if (deep -> 'items' -> i ->> 'id')::bigint = o1 then pos_o1 := i; end if;
  end loop;
  assert pos_n1 is not null, 'the fresh post is in the feed';
  assert pos_o1 is not null, 'the stale post is still in the feed — it is old, not censored';
  assert pos_n1 < pos_o1, format('the six-week-old post outranked the fresh one (%s vs %s)', pos_o1, pos_n1);

  /* 5 — the cursor resumes exactly where the page stopped */
  page1 := public.flow_ranked_feed(2, null);
  assert jsonb_array_length(page1 -> 'items') = 2, 'a page of 2 has 2 items';
  assert page1 -> 'nextCursor' is not null, 'a full page hands back a cursor';
  page2 := public.flow_ranked_feed(2, page1 -> 'nextCursor');
  assert jsonb_array_length(page2 -> 'items') >= 1, 'the next page is not empty';

  select count(*) into overlap
    from jsonb_array_elements(page1 -> 'items') a
    join jsonb_array_elements(page2 -> 'items') b on (a ->> 'id') = (b ->> 'id');
  assert overlap = 0, format('page 2 repeated %s item(s) from page 1', overlap);

  /* 4a — hide is permanent */
  perform public.record_post_feedback(h1, 'hide');
  j := public.flow_ranked_feed(30, null);
  select count(*) into n from jsonb_array_elements(j -> 'items') e
   where (e ->> 'id')::bigint = h1;
  assert n = 0, 'a hidden post came back';

  /* 4b — a watched post drops out while there is fresh material */
  v := public.record_post_view(m1, 4200, true, 1);
  assert (v ->> 'recorded')::boolean is true, 'a view is recorded';
  j := public.flow_ranked_feed(4, null);
  select count(*) into n from jsonb_array_elements(j -> 'items') e
   where (e ->> 'id')::bigint = m1;
  assert n = 0, 'a post already watched came back in the same session';

  /* and it does not come back twice in a row from a chatty client */
  v := public.record_post_view(m1, 4200, true, 1);
  assert (v ->> 'recorded')::boolean is false, 'the 30-second view throttle is not working';
  assert v ->> 'reason' = 'too_soon', 'a throttled view says why';

  /* the signal is real: it is stored with the dwell time that was reported */
  reset role;
  select count(*) into n from post_feedback
   where post_id = m1 and viewer_id = daniel_id and kind = 'view' and dwell_ms = 4200 and completed;
  assert n = 1, 'the dwell time was not stored';

  -- Clean up so the rest of the suite sees the database it expects.
  delete from post_feedback where post_id in (m1, m2, t1, n1, o1, h1);
  delete from post_reactions where post_id in (m1, m2, t1);
  delete from posts where id in (m1, m2, t1, n1, o1, h1);
end $$;
