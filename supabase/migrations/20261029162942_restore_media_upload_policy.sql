-- Put the upload policy back, and let a real clip through.
--
-- "Post not shared / new row violates row-level security policy" is not the app
-- talking: it is Supabase Storage. `client.ts` uploads to the media Worker
-- first and falls back to Storage when that fails, and the fallback was denied
-- because the storage policies were rewritten at some point (media_private_read,
-- can_manage_media, can_view_media) and the INSERT policy was not carried over.
-- Only verification_self_insert survived, so a member could not write to the
-- media bucket at all — every fallback failed, and deleting a file would have
-- failed with it if the DELETE policy had not been replaced.
--
-- Two things were wrong and both are fixed here.

/* ------------------------------------------------------------ 1. the policy */

-- Paths are minted server-side by media_upload_ticket as kind/<profile id>/file,
-- so the folder is not something a member can choose. Rebuilding the check from
-- can_manage_media keeps it in one place: that function already knows which
-- folders you own and which kinds are yours to write.
drop policy if exists "media_insert_own" on storage.objects;
create policy "media_insert_own" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'media' and public.can_manage_media(name)
  );

/* -------------------------------------------------------- 2. the size limit */

-- 25 MB is a generous ceiling for a twenty-second clip and an easy one to pass
-- for a phone's ordinary camera output, and the app had no room to complain:
-- posting a normal video failed the ticket, fell back to Storage, and died on
-- the policy above. 80 MB is still small enough to protect the bucket and large
-- enough that the limit is not part of a member's day.
create or replace function public.media_upload_ticket(
  p_kind text, p_content_type text, p_bytes int default 0
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  v_ext text;
  v_limit int;
  v_path text;
  n int;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  if p_kind is null or p_kind not in ('photos', 'moments', 'messages', 'posts', 'circles', 'vibes') then
    perform public.crushly_fail(400, '', 'Unsupported media kind.');
  end if;

  v_ext := public.media_extension(p_content_type);
  if v_ext is null then
    perform public.crushly_fail(415, '', 'That file type isn’t supported.');
  end if;
  if p_kind = 'photos' and v_ext not in ('jpg', 'png', 'webp') then
    perform public.crushly_fail(415, '', 'Photos must be JPEG, PNG or WebP.');
  end if;
  if p_kind in ('moments', 'posts') and v_ext not in ('jpg', 'png', 'webp', 'mp4', 'webm') then
    perform public.crushly_fail(415, '', 'That takes a photo or a short clip.');
  end if;
  if p_kind = 'circles' and v_ext not in ('jpg', 'png', 'webp', 'm4a', 'mp3', 'mp4', 'webm') then
    perform public.crushly_fail(415, '', 'Circles take photos, voice notes and clips.');
  end if;
  if p_kind = 'vibes' and v_ext not in ('mp4', 'webm', 'jpg', 'png', 'webp') then
    perform public.crushly_fail(415, '', 'Vibes are short video clips, with a still for the cover.');
  end if;

  -- Clips get room; a voice note does not.
  v_limit := case
    when p_kind in ('messages', 'circles', 'vibes', 'posts') then 80 * 1024 * 1024
    else 8 * 1024 * 1024
  end;
  if coalesce(p_bytes, 0) <= 0 then
    perform public.crushly_fail(400, '', 'That file looks empty — try picking it again.');
  elsif p_bytes > v_limit then
    perform public.crushly_fail(413, '', 'That file is too large to send.');
  end if;

  perform 1 from profiles where id = me for update;
  -- The ceiling counts what was actually published in the last hour, across
  -- every kind, not the tickets handed out: a ticket that is never used to
  -- upload should not eat into someone's hour.
  select (select count(*) from photos where user_id = me and created_at > public.now_ms() - 3600 * 1000)
       + (select count(*) from moments where user_id = me and created_at > public.now_ms() - 3600 * 1000)
       + (select count(*) from messages where sender_id = me and created_at > public.now_ms() - 3600 * 1000)
       + (select count(*) from posts where author_id = me and created_at > public.now_ms() - 3600 * 1000)
       + (select count(*) from circle_messages where sender_id = me and created_at > public.now_ms() - 3600 * 1000)
       + (select count(*) from vibes where author_id = me and created_at > public.now_ms() - 3600 * 1000)
    into n;
  if n >= 40 then
    perform public.crushly_fail(429, '', 'That’s a lot of uploading — try again in a little while.');
  end if;

  if p_kind = 'photos' and (select count(*) from photos where user_id = me) >= 6 then
    perform public.crushly_fail(400, '', 'You can show up to 6 photos.');
  end if;

  v_path := p_kind || '/' || me::text || '/' || public.now_ms()::text || '-'
    || substr(md5(random()::text || me::text || public.now_ms()::text), 1, 10) || '.' || v_ext;

  insert into media_upload_reservations(path, user_id, bytes) values (v_path, me, p_bytes);

  return jsonb_build_object('path', v_path, 'maxBytes', v_limit, 'extension', v_ext);
end $$;

revoke all on function public.media_upload_ticket(text, text, int) from public, anon;
grant execute on function public.media_upload_ticket(text, text, int) to authenticated, service_role;

-- The bucket's own ceiling, so a direct-to-Storage fallback is bounded by the
-- same number the ticket promises.
--
-- Guarded: the migration test harness builds a minimal stand-in for the storage
-- schema and has no buckets table at all, and older Supabase images have no
-- file_size_limit column. The ticket above is the limit that actually applies
-- to members; this line only keeps the bucket from contradicting it.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit'
  ) then
    update storage.buckets set file_size_limit = 80 * 1024 * 1024 where id = 'media';
  end if;
end $$;
