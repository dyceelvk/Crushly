-- Media is not public. This checks the two things that decide it, rather than
-- trusting that somebody closed it in the dashboard once.
--
-- The bucket flag and the read policy are separate doors and both have to be
-- shut:
--
--   * `storage.buckets.public = true` serves any object through
--     `/storage/v1/object/public/...` — no token, no policy consulted;
--   * a `for select to public` policy on `storage.objects` serves the same
--     object through the authenticated endpoint to callers who are not members.
--
-- The chain used to come up with both open. `messages/` is the prefix that made
-- that serious: chat photos and voice notes live there, and a link to one
-- outlives the message it was sent in.
do $$
declare
  is_public boolean;
  blanket   text;
  readers   text;
begin
  /* --------------------------------------------------------------- bucket */
  select b.public into is_public from storage.buckets b where b.id = 'media';
  if is_public is null then
    raise exception 'the media bucket does not exist — 20261008000003_storage.sql did not run';
  end if;
  if is_public then
    raise exception 'the media bucket is public: any object is readable by URL with no token';
  end if;

  /* --------------------------------------------------------------- policy */
  select string_agg(p.policyname, ', ') into blanket
    from pg_policies p
   where p.schemaname = 'storage'
     and p.tablename = 'objects'
     and p.cmd = 'SELECT'
     and 'public' = any (p.roles);
  if blanket is not null then
    raise exception 'a SELECT policy on storage.objects still applies to public: %', blanket;
  end if;

  /* ------------------------------------------------- what reads media now */
  select string_agg(p.policyname, ', ') into readers
    from pg_policies p
   where p.schemaname = 'storage'
     and p.tablename = 'objects'
     and p.cmd = 'SELECT'
     and p.qual ilike '%media%';
  if readers is null then
    raise exception 'nothing reads the media bucket any more — a private bucket needs media_private_read';
  end if;
  if readers not like '%media_private_read%' then
    raise exception 'the policy that reads media is not media_private_read: %', readers;
  end if;

  raise notice 'media is private: bucket flag off, no public SELECT policy, reads via %', readers;
end $$;
