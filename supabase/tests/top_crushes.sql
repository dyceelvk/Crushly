-- Top Crushes This Week (1.0.69) — the rail must be what its name says, and a
-- video note must be ten seconds.
--
-- The whole file runs inside a transaction that is rolled back at the end, so it
-- can begin by clearing existing Crushes and comments: the point is to prove an
-- ordering, and an ordering is only provable when the numbers are yours. Nothing
-- it inserts outlives it.
--
-- What it proves:
--   1. A clip nobody crushed is not on a rail called Top Crushes.
--   2. A clip older than seven days is not "This Week", whatever it earned.
--   3. Ordering is Crushes first, comments as the tiebreak, newest after that.
--   4. One clip per author, and it is their most crushed clip — not their newest.
--   5. A video note longer than ten seconds (plus rounding) is refused at the
--      point it is stored, and a note that predates the rule can still be read.
begin;

do $$
declare
  daniel uuid := (select auth_user_id from public.profiles where name = 'Daniel');
  ryan   uuid := (select auth_user_id from public.profiles where name = 'Ryan');
  ryan_id bigint := (select id from public.profiles where name = 'Ryan');
  me_id  bigint := (select id from public.profiles where name = 'Daniel');
  marcus_id bigint := (select id from public.profiles where name = 'Marcus');
  -- Four more people, so each clip has an author of its own: the rail shows one
  -- clip per author, and a test that gave every clip to Daniel would be testing
  -- that rule instead of the ranking.
  other bigint[];
  cold bigint;
  hot bigint;
  warmer bigint;
  chatty bigint;
  marcus_new bigint;
  marcus_best bigint;
  ancient bigint;
  rail jsonb;
  ids bigint[];
  conv_id bigint;
  long_note bigint;
begin
  delete from public.post_reactions;
  delete from public.post_comments;

  select array_agg(id order by id) into other from (
    select id from public.profiles where id not in (me_id, marcus_id) order by id limit 4
  ) p;
  assert array_length(other, 1) = 4, 'this test needs four more members than Daniel and Marcus';

  -- Six clips, each earning exactly what its name says. Made here rather than
  -- taken from the seed so the arithmetic in the test is visible.
  insert into public.posts (author_id, body, media_url, audience, created_at)
    values (me_id, 'cold clip', 'media/cold.mp4', 'everyone', public.now_ms())
    returning id into cold;
  insert into public.posts (author_id, body, media_url, audience, created_at)
    values (other[1], 'hot clip', 'media/hot.mp4', 'everyone', public.now_ms() - 1000)
    returning id into hot;
  insert into public.posts (author_id, body, media_url, audience, created_at)
    values (other[2], 'warmer clip', 'media/warmer.mp4', 'everyone', public.now_ms() - 2000)
    returning id into warmer;
  insert into public.posts (author_id, body, media_url, audience, created_at)
    values (other[3], 'chatty clip', 'media/chatty.mp4', 'everyone', public.now_ms() - 3000)
    returning id into chatty;
  insert into public.posts (author_id, body, media_url, audience, created_at)
    values (marcus_id, 'marcus newest, ignored', 'media/newest.mp4', 'everyone', public.now_ms() - 4000)
    returning id into marcus_new;
  insert into public.posts (author_id, body, media_url, audience, created_at)
    values (marcus_id, 'marcus best', 'media/best.mp4', 'everyone', public.now_ms() - 5000)
    returning id into marcus_best;
  insert into public.posts (author_id, body, media_url, audience, created_at)
    values (other[4], 'ancient but beloved', 'media/ancient.mp4', 'everyone', public.now_ms() - 2592000000::bigint)
    returning id into ancient;

  -- hot: 5 Crushes. warmer: 2 Crushes and 3 comments. chatty: 1 Crush and 4
  -- comments — the case the old weighting made look bigger and the new one does
  -- not, because the rail is called Crushes and comments are the tiebreak.
  insert into public.post_reactions (post_id, user_id)
    select hot, u from unnest(array[marcus_id, other[2], other[3], other[4], me_id]) u
    on conflict do nothing;
  insert into public.post_reactions (post_id, user_id)
    select warmer, u from unnest(array[marcus_id, other[1]]) u on conflict do nothing;
  insert into public.post_comments (post_id, author_id, body)
    select warmer, u, 'a comment' from unnest(array[marcus_id, other[1], other[3]]) u;
  insert into public.post_reactions (post_id, user_id)
    values (chatty, marcus_id) on conflict do nothing;
  insert into public.post_comments (post_id, author_id, body)
    select chatty, u, 'another comment' from unnest(array[marcus_id, other[1], other[2], me_id]) u;
  -- Marcus's older clip earns more than the one he posted later.
  insert into public.post_reactions (post_id, user_id)
    select marcus_best, id from public.profiles where id <> marcus_id
    on conflict do nothing;
  insert into public.post_reactions (post_id, user_id)
    values (marcus_new, me_id) on conflict do nothing;
  -- ancient: the most beloved clip in the database, and a month old.
  insert into public.post_reactions (post_id, user_id)
    select ancient, u from unnest(array[me_id, marcus_id, other[1], other[2], other[3]]) u
    on conflict do nothing;

  perform set_config('request.jwt.claim.sub', daniel::text, false);
  rail := public.trending_clips(24);
  select array_agg((it ->> 'id')::bigint order by ord) into ids
    from jsonb_array_elements(rail) with ordinality as t(it, ord);

  -- 1 · nothing without a Crush, nothing from last month.
  assert not (cold = any(ids)), 'a clip with no Crushes must not be on a Top Crushes rail';
  assert not (ancient = any(ids)), 'a month-old clip is not This Week, however beloved';
  assert not (marcus_new = any(ids)), 'an author is represented once, by their most crushed clip';
  assert (select count(*) from jsonb_array_elements(rail) it where (it ->> 'likeCount')::int = 0) = 0,
    'no tile may report zero Crushes on this rail';

  -- 2 · the order is the title's order: Crushes, then comments, then newest.
  assert ids[1] = marcus_best, 'the most crushed clip of the week leads';
  assert ids[2] = hot, 'five Crushes is second';
  assert ids[3] = warmer, 'two Crushes and three comments beats one Crush and four comments';
  assert ids[4] = chatty, 'one Crush and four comments is last of the four';
  assert array_length(ids, 1) = 4, 'and the rail holds exactly the four clips that earned a place';

  -- ------------------------------------------------ a video note is ten seconds
  -- Daniel and Ryan are connected in the seed, which is what a Whisper needs.
  if not public.is_connected_pair(me_id, ryan_id) then
    insert into public.connections (user_a, user_b)
      values (least(me_id, ryan_id), greatest(me_id, ryan_id))
      on conflict do nothing;
  end if;
  perform set_config('request.jwt.claim.sub', daniel::text, false);
  conv_id := (public.open_conversation(ryan_id) ->> 'id')::bigint;
  assert conv_id is not null, 'the two members need a Whisper between them';

  begin
    perform public.send_message(conv_id, 'video', '', 'media/note.mp4', '{"duration": 45}'::jsonb);
    raise exception 'a 45-second video note must be refused';
  exception
    when others then
      if position('10 seconds' in sqlerrm) = 0 then raise; end if;
  end;

  -- Ten seconds — and the rounding a duration goes through — is fine.
  perform public.send_message(conv_id, 'video', '', 'media/note.mp4', '{"duration": 10}'::jsonb);
  perform public.send_message(conv_id, 'video', '', 'media/note.mp4', '{"duration": 11}'::jsonb);

  -- A note that predates the rule can still be read: the check is on insert, so
  -- an old minute-long note is not made unreadable by a rule about storage. The
  -- row is planted with the trigger off, which is exactly what it was before
  -- this migration existed.
  alter table public.messages disable trigger validate_video_note_length;
  insert into public.messages (conversation_id, sender_id, kind, body, media_url, meta)
    values (conv_id, me_id, 'video', '', 'media/old.mp4', '{"duration": 60}'::jsonb)
    returning id into long_note;
  alter table public.messages enable trigger validate_video_note_length;
  update public.messages set read_at = public.now_ms() where id = long_note;
  assert (select read_at from public.messages where id = long_note) is not null,
    'an old video note must still be markable as read';

  raise notice 'Top Crushes: ranked by Crushes, this week, earned only — and a video note is ten seconds.';
end $$;

rollback;
