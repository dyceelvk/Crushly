-- 20261029162942 restore_media_upload_policy
--
-- RECONSTRUCTED 2026-10-30 from the live production catalog (pg_policy on
-- storage.objects). Idempotent, safe to replay.
--
-- What this migration owns: the INSERT policy on the private `media` bucket.
-- It had been lost — most likely a hand-run `drop policy` while debugging an
-- upload failure was never replaced — so every upload started failing with a
-- bare 403 from Storage while reads kept working. This restores it and keeps
-- the read/delete/update policies in the same place so they cannot drift apart
-- again.
--
-- can_manage_media(name) is the whole authorisation: the object path is
-- `kind/<profile id>/…` and the caller may only write inside their own folder.

drop policy if exists media_insert_own on storage.objects;
create policy media_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media' and can_manage_media(name));

-- Re-assert the companions; create policy has no "if not exists" form, hence
-- the drops. These are the same definitions as 20261013000026_media_security.
drop policy if exists media_private_read on storage.objects;
create policy media_private_read on storage.objects
  for select to authenticated
  using (bucket_id = 'media' and (can_view_media(name) ->> 'allowed')::boolean);

drop policy if exists media_update_own on storage.objects;
create policy media_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'media' and can_manage_media(name))
  with check (bucket_id = 'media' and can_manage_media(name));

drop policy if exists media_delete_own on storage.objects;
create policy media_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'media' and can_manage_media(name));
