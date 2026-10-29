-- storage.objects has INSERT and DELETE policies for members, but no UPDATE.
--
-- PostgREST and supabase-js read an upload with `upsert: true` as "replace this
-- object", and storage answers that with an UPDATE against storage.objects
-- first. With no UPDATE policy the whole request is refused — and the error a
-- member sees is `new row violates row-level security policy`, which reads like
-- the post itself was blocked. That is exactly what it looked like, and the
-- refused insert was the file.
--
-- The rule is the same one the insert policy already states: a member may only
-- ever touch their own folder. Re-stating it here means an overwrite is allowed
-- for the person who owns the path and refused for everybody else, which is
-- also what makes `upsert: true` safe to use.

drop policy if exists media_update_own on storage.objects;
create policy media_update_own on storage.objects
  for update
  to authenticated
  using (bucket_id = 'media' and public.can_manage_media(name))
  with check (bucket_id = 'media' and public.can_manage_media(name));

-- Verification selfies get the same treatment, on the same folder rule.
drop policy if exists verification_self_update on storage.objects;
create policy verification_self_update on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'verification'
    and (storage.foldername(name))[1] = 'selfies'
    and (storage.foldername(name))[2] = (public.me_id())::text
  )
  with check (
    bucket_id = 'verification'
    and (storage.foldername(name))[1] = 'selfies'
    and (storage.foldername(name))[2] = (public.me_id())::text
  );
