-- Reconciliation, not a change. This file exists so git and the live database
-- agree about what has been applied.
--
-- The live project recorded a migration under this version stamp, named
-- `crushes_feed_and_picks_of`, that exists in no commit of this repository. It
-- created two functions, and both were then dealt with again on purpose:
--
--   * `public.crushes_feed(p_limit integer, p_after bigint)` — a *second*
--     function called `crushes_feed`, alongside the people list `crushes_feed()`
--     that Crushes had always used. It was the post feed. It is gone from the
--     live database, and the feature it was written for now lives in
--     `20261104090000_crushes_feed.sql` under a name that cannot collide:
--     `crush_posts_feed` (see the note at the top of that file — the two-argument
--     overload is deliberately dropped there, "if this migration is replayed
--     over a database that ran the earlier draft").
--
--   * `public.picks_of(p_user_id, p_limit, p_after)` — a draft that made
--     somebody's Picked readable from their Space. Deliberately removed: Picked
--     is private, not a public shelf, and `20261104090000_crushes_feed.sql`
--     drops it for any database that ran the draft.
--
-- So there is nothing to create here, and creating anything would undo
-- `20261104090000` two versions later.
--
-- Why the file exists at all: `supabase db push` decides what to apply by
-- reading `supabase_migrations.schema_migrations` and comparing it to the files
-- in this directory. A version in the database with no file here is a hard stop
-- — the CLI refuses with "Remote migration versions not found in local
-- migrations directory" and pushes *nothing*, not even the migrations that are
-- genuinely missing. That is what the 1.0.53 push did. Recording this version in
-- the repository lets the three migrations that never reached production
-- (`20261104090000`, `20261104130000`, `20261104140000`) finally land, and lets
-- the drift check in `.github/workflows/db-migrations.yml` compare the two lists
-- from now on.

do $$
begin
  raise notice 'reconciliation only: see the comment at the top of this file';
end $$;
