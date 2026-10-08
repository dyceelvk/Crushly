-- Storage: one public bucket for everything the app shows (profile photos,
-- chat media, Moment media, demo seed photos) and one private bucket for
-- verification selfies (only the member themself — and moderators via the
-- service role — can read them).
--
-- Path convention for user media: <kind>/<profile id>/<file>
--   photos/123/abc.jpg  moments/123/xyz.jpg  messages/123/clip.m4a
-- Demo seed photos live under seed/<name>.jpg (uploaded by
-- supabase/scripts/seed-storage.mjs with the service role).

insert into storage.buckets (id, name, public)
values ('media', 'media', true), ('verification', 'verification', false)
on conflict (id) do nothing;

create policy "media_public_read" on storage.objects
  for select to public using (bucket_id = 'media');

create policy "media_insert_own" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] in ('photos', 'moments', 'messages')
    and (storage.foldername(name))[2] = public.me_id()::text
  );

create policy "media_delete_own" on storage.objects
  for delete to authenticated using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] in ('photos', 'moments', 'messages')
    and (storage.foldername(name))[2] = public.me_id()::text
  );

create policy "verification_self_read" on storage.objects
  for select to authenticated using (
    bucket_id = 'verification'
    and (storage.foldername(name))[1] = 'selfies'
    and (storage.foldername(name))[2] = public.me_id()::text
  );

create policy "verification_self_insert" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'verification'
    and (storage.foldername(name))[1] = 'selfies'
    and (storage.foldername(name))[2] = public.me_id()::text
  );
