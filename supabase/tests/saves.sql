-- Saved posts: the drawer is private, survives a reload, and forgets cleanly.
--
-- The Save button used to be a lie — a local flag that said "Post saved" and
-- remembered nothing. These assertions make the opposite claim testable:
--
--   1. saving survives being read back (post_saved + saved_posts),
--   2. saving twice is not an error, unsaving twice is not an error,
--   3. nobody but you can see your drawer, including the post's author,
--   4. a post you may no longer see never appears in it,
--   5. deleting a post takes its saves with it.
do $$
declare
  daniel    uuid;
  marcus    uuid;
  daniel_id bigint;
  marcus_id bigint;
  saved_id  bigint;
  gone_id   bigint;
  j         jsonb;
  s         jsonb;
  n         integer;
  b         boolean;
begin
  select id into daniel from auth.users where email = 'daniel@crushly.app';
  select id into marcus from auth.users where email = 'marcus@crushly.app';
  select id into daniel_id from profiles where name = 'Daniel';
  select id into marcus_id from profiles where name = 'Marcus';

  set role authenticated;

  /* ------------------------------------- a post of Marcus's, saved by Daniel */
  perform set_config('request.jwt.claim.sub', marcus::text, false);
  j := public.create_post('save probe', null, 'everyone', null, null);
  saved_id := (j ->> 'id')::bigint;

  perform set_config('request.jwt.claim.sub', daniel::text, false);

  -- Nothing is saved before anybody saves it.
  b := public.post_saved(saved_id);
  assert b is false, 'a post starts unsaved';

  s := public.save_post(saved_id, true);
  assert (s ->> 'saved')::boolean is true, 'save_post reports saved';

  -- It is still saved when read back through a different call, which is the
  -- whole point: the old button only remembered inside one mounted view.
  b := public.post_saved(saved_id);
  assert b is true, 'the save survives being read back';

  j := public.saved_posts(20, null);
  select count(*) into n from jsonb_array_elements(j -> 'items') e
   where (e ->> 'id')::bigint = saved_id;
  assert n = 1, 'the saved post is in the drawer';

  select e into j from jsonb_array_elements(j -> 'items') e
   where (e ->> 'id')::bigint = saved_id;
  assert (j ->> 'saved')::boolean is true, 'a row in the drawer is marked saved';
  assert (j ->> 'body') = 'save probe', 'the drawer row is the real post';

  /* --------------------------------------------------------- idempotent */
  s := public.save_post(saved_id, true);
  assert (s ->> 'saved')::boolean is true, 'saving twice still saved';

  s := public.save_post(saved_id, false);
  assert (s ->> 'saved')::boolean is false, 'unsave reports unsaved';
  b := public.post_saved(saved_id);
  assert b is false, 'the unsave survives being read back';

  s := public.save_post(saved_id, false);
  assert (s ->> 'saved')::boolean is false, 'unsaving twice is not an error';

  /* --------------------------------------- private from everyone, even authors */
  perform public.save_post(saved_id, true);

  -- The author of the post cannot read Daniel's drawer, and cannot see the row.
  perform set_config('request.jwt.claim.sub', marcus::text, false);
  begin
    perform set_config('role', 'authenticated', false);
    insert into public.post_saves (user_id, post_id) values (daniel_id, saved_id);
    raise exception 'one member could write another member''s save';
  exception
    when insufficient_privilege or check_violation then null;
    when others then
      if sqlerrm not like '%row-level security%' then raise; end if;
  end;

  select count(*) into n from public.post_saves where user_id = daniel_id;
  assert n = 0, 'the author cannot sweep another member''s saves';
  assert public.post_saved(saved_id) is false, 'another member''s drawer is empty';

  j := public.saved_posts(20, null);
  select count(*) into n from jsonb_array_elements(j -> 'items') e
   where (e ->> 'id')::bigint = saved_id;
  assert n = 0, 'another member''s drawer does not show it';

  /* ------------------------------- a post you can no longer see is not in it */
  perform set_config('request.jwt.claim.sub', marcus::text, false);
  j := public.create_post('visible until we fall out', null, 'everyone', null, null);
  gone_id := (j ->> 'id')::bigint;
  perform set_config('request.jwt.claim.sub', daniel::text, false);

  perform public.save_post(gone_id, true);
  j := public.saved_posts(20, null);
  select count(*) into n from jsonb_array_elements(j -> 'items') e
   where (e ->> 'id')::bigint = gone_id;
  assert n = 1, 'a post you can see can be saved';

  -- Cut him off. The post is still in the table, but it is no longer Daniel's
  -- to see — so it must leave the drawer, and saving it must fail rather than
  -- silently bookmark something he cannot open.
  insert into public.blocks (blocker_id, blocked_id) values (daniel_id, marcus_id);

  j := public.saved_posts(20, null);
  select count(*) into n from jsonb_array_elements(j -> 'items') e
   where (e ->> 'id')::bigint = gone_id;
  assert n = 0, 'a post you can no longer see leaves the drawer';

  begin
    perform public.save_post(gone_id, true);
    raise exception 'a post outside your audience was saved';
  exception when others then
    if sqlerrm not like '%isn%available%' then raise; end if;
  end;

  delete from public.blocks where blocker_id = daniel_id and blocked_id = marcus_id;

  -- Unblocking is not an un-save: the row was there all along, it was only
  -- hidden while the post was out of reach.
  j := public.saved_posts(20, null);
  select count(*) into n from jsonb_array_elements(j -> 'items') e
   where (e ->> 'id')::bigint = gone_id;
  assert n = 1, 'unblocking brings the saved post back';
  perform public.save_post(gone_id, false);

  /* ------------------------------------------ deleting a post takes the save */
  perform set_config('request.jwt.claim.sub', marcus::text, false);
  j := public.create_post('deleted while saved', null, 'everyone', null, null);
  gone_id := (j ->> 'id')::bigint;

  perform set_config('request.jwt.claim.sub', daniel::text, false);
  perform public.save_post(gone_id, true);
  j := public.saved_posts(20, null);
  select count(*) into n from jsonb_array_elements(j -> 'items') e
   where (e ->> 'id')::bigint = gone_id;
  assert n = 1, 'the doomed post is in the drawer to begin with';

  perform set_config('request.jwt.claim.sub', marcus::text, false);
  perform public.delete_post(gone_id);

  perform set_config('request.jwt.claim.sub', daniel::text, false);
  j := public.saved_posts(20, null);
  select count(*) into n from jsonb_array_elements(j -> 'items') e
   where (e ->> 'id')::bigint = gone_id;
  assert n = 0, 'a deleted post leaves the drawer';

  select count(*) into n from public.post_saves s where s.post_id = gone_id;
  assert n = 0, 'a deleted post takes its save row with it';

  -- And the one that is still alive is untouched by that delete.
  assert public.post_saved(saved_id) is true, 'other saves are unaffected';

  /* --------------------------------------------------------------- cleanup */
  perform public.save_post(saved_id, false);
  select count(*) into n from public.post_saves s where s.user_id = daniel_id and s.post_id = saved_id;
  assert n = 0, 'unsave removes the row';

  reset role;
  raise notice 'saved post tests passed';
end $$;
