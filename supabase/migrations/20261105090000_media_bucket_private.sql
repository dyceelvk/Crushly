-- The media bucket is private. This is the file that says so.
--
-- The live project has been private for a while, but no migration ever said so:
-- `20261008000003_storage.sql` inserts the bucket with `public = true` and
-- creates
--
--     create policy "media_public_read" on storage.objects
--       for select to public using (bucket_id = 'media');
--
-- — whole bucket, every prefix, no token, forever. Reading the 55 migrations in
-- order, nothing afterwards flips `public` back or drops that policy. The fix
-- that closed it was made in the dashboard, and a fix made in a dashboard is a
-- fix that exists in exactly one place.
--
-- That matters beyond tidiness. This chain is how a second environment comes
-- into being: a Supabase branch, a restore, staging, a rebuild after a disaster.
-- Every one of those would have come up with a world-readable bucket containing
-- `messages/` — which is where Whisper photos and voice notes live, and which
-- outlives the message.
--
-- Two statements, both idempotent, both no-ops on the live project:
--
--   1. the bucket is private at the bucket level, which is what governs
--      `/storage/v1/object/public/...`;
--   2. the blanket read policy is gone, so reads go through `media_private_read`
--      → `can_view_media(name)`, which is where blocks, connections, Moment
--      expiry and Circles already live.
--
-- `supabase/tests/storage_privacy.sql` asserts both, so this cannot quietly
-- come back.

update storage.buckets set public = false where id = 'media';

drop policy if exists "media_public_read" on storage.objects;
