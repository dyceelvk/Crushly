-- The saved copy must be the file that was actually uploaded.
--
-- The report this comes from: every Save on a clip answered
--
--   {"error":"The saved copy of this clip isn't ready yet. Try again in a minute."}
--
-- and never stopped. The app registered `posts/<uid>/<ts>-marked.mp4` — a key it
-- had guessed from `posts.media_url` — while the upload wrote the file under a
-- key the server had minted. The row and the object never met, and because the
-- row existed the marking job never went back to fix it.
--
-- These assertions pin the four things that make that impossible now:
--
--   1. no address, no row — a guess is refused rather than stored;
--   2. an address outside this member's own folder is refused;
--   3. the post's own original is refused (a copy that is not marked);
--   4. an address that really was uploaded is stored exactly as given, and the
--      row is left unconfirmed so the job verifies it;
--   5. the job is given unconfirmed rows back, and only those.
begin;
do $test$
declare
  au uuid; aid bigint; other_id bigint;
  pid bigint; pid2 bigint;
  orig text; marked text; foreign_url text; ok boolean;
  queue jsonb; n integer;
begin
  select id into au from auth.users where email='marcus@crushly.app';
  select id into aid from profiles where auth_user_id=au;
  select id into other_id from profiles where auth_user_id=(select id from auth.users where email='daniel@crushly.app');
  assert aid is not null and other_id is not null;
  assert aid <> other_id;

  orig := 'posts/' || aid || '/1794700000000-aaaaaaaaaa.mp4';
  marked := 'posts/' || aid || '/1794700000001-bbbbbbbbbb.mp4';
  foreign_url := 'https://crushly-media.dyceelvk.workers.dev/m/posts/' || other_id || '/1794700000002-cccccccccc.mp4';

  insert into posts(author_id, body, media_url, audience)
    values (aid, 'marked copy fixture', 'https://crushly-media.dyceelvk.workers.dev/m/' || orig, 'everyone')
    returning id into pid;

  perform set_config('request.jwt.claim.sub', au::text, true);
  set local role authenticated;

  -- 1. A guessed copy: no address means no row.
  ok := register_own_post_download(pid);
  assert ok is false, 'registered a copy without being told where it is';
  assert public.post_download(pid) is null, 'a row was written anyway';

  -- 1b. An explicit null is the same answer.
  ok := register_own_post_download(pid, null);
  assert ok is false, 'null address accepted';

  -- 2. Somebody else's media is not this post's marked copy.
  ok := register_own_post_download(pid, foreign_url);
  assert ok is false, 'accepted a key outside this member''s own folder';
  assert public.post_download(pid) is null, 'foreign row was written';

  -- 3. The original is not a marked copy.
  ok := register_own_post_download(pid, 'https://crushly-media.dyceelvk.workers.dev/m/' || orig);
  assert ok is false, 'accepted the post''s own original as a marked copy';

  -- 4. The address the upload really returned: stored verbatim.
  ok := register_own_post_download(pid, 'https://crushly-media.dyceelvk.workers.dev/m/' || marked);
  assert ok is true, 'refused a real address in the member''s own folder';
  assert public.post_download(pid)->>'path' = marked, 'stored a different key than the one given';

  reset role;
  -- The job runs with no member on the session; say so explicitly, because this
  -- transaction still carries the claim the member's calls set.
  perform set_config('request.jwt.claim.sub', '', true);

  -- Unconfirmed: nobody has looked at the object. That is what gets the job's
  -- attention back.
  assert (select bytes from post_downloads where post_id = pid) is null, 'claimed a size nobody measured';

  -- 5. The job is handed the unconfirmed row, and a confirmed one is left alone.
  queue := public.posts_needing_download(100);
  select count(*) into n from jsonb_array_elements(queue) e where (e->>'id')::bigint = pid;
  assert n = 1, 'an unconfirmed copy is not in the job queue';

  perform public.register_post_download(pid, marked, 123456);
  queue := public.posts_needing_download(100);
  select count(*) into n from jsonb_array_elements(queue) e where (e->>'id')::bigint = pid;
  assert n = 0, 'a confirmed copy is still queued';

  -- A post with no row at all is still queued, exactly as before.
  insert into posts(author_id, body, media_url, audience)
    values (aid, 'no copy fixture', 'https://crushly-media.dyceelvk.workers.dev/m/posts/' || aid || '/1794700000003-dddddddddd.mp4', 'everyone')
    returning id into pid2;
  queue := public.posts_needing_download(100);
  select count(*) into n from jsonb_array_elements(queue) e where (e->>'id')::bigint = pid2;
  assert n = 1, 'a clip with no copy is not queued';

  -- The job's own writes still have to be service-role; a member cannot register
  -- an arbitrary key (that rule predates this change and must survive it).
  perform set_config('request.jwt.claim.sub', au::text, true);
  set local role authenticated;
  begin
    ok := public.register_post_download(pid, 'posts/' || aid || '/stolen.mp4', 1);
    assert ok is false, 'a member could name an object key';
  exception when insufficient_privilege then
    null;   -- refused at the door, which is the strongest form of the answer
  end;
  reset role;

  raise notice 'marked copy contract holds';
end $test$;
rollback;
