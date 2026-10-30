-- 20261029195516 video_container_support
--
-- RECONSTRUCTED 2026-10-30 from the live production catalog (pg_get_functiondef).
-- Idempotent (create or replace), safe to replay.
--
-- What this migration owns: the single table of "which container may this kind
-- of upload be", plus the content-type → extension map that feeds it.
--   * media_extension(content_type) -> extension | null
--   * media_kind_allows(kind, ext)  -> boolean
--
-- Before this, the checks lived inline in the upload paths and had drifted:
-- QuickTime and WebM clips were rejected by posts but accepted by messages, so
-- the same phone produced "that takes a photo or a short clip" on one screen
-- and uploaded fine on another. Both functions are IMMUTABLE, so the answer is
-- identical everywhere and cheap enough to call per row.

create or replace function public.media_extension(p_content_type text)
returns text
language sql
immutable
as $function$
  select case lower(split_part(coalesce(p_content_type, ''), ';', 1))
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
    when 'image/heic' then 'heic'
    when 'audio/mpeg' then 'mp3'
    when 'audio/mp4' then 'm4a'
    when 'audio/aac' then 'm4a'
    when 'audio/x-m4a' then 'm4a'
    when 'video/mp4' then 'mp4'
    when 'video/webm' then 'webm'
    when 'video/quicktime' then 'mov'
    when 'video/x-m4v' then 'mp4'
    else null
  end
$function$;

create or replace function public.media_kind_allows(p_kind text, p_ext text)
returns boolean
language sql
immutable
as $function$
  select case
    when p_kind = 'photos' then p_ext in ('jpg', 'png', 'webp')
    when p_kind in ('moments', 'posts') then p_ext in ('jpg', 'png', 'webp', 'mp4', 'webm', 'mov')
    when p_kind in ('circles', 'messages') then p_ext in ('jpg', 'png', 'webp', 'm4a', 'mp3', 'mp4', 'webm', 'mov')
    when p_kind = 'vibes' then p_ext in ('mp4', 'webm', 'mov', 'jpg', 'png', 'webp')
    else false
  end
$function$;

-- Execution grants, matching production pg_proc.proacl.
revoke all on function public.media_extension(text) from public, anon, authenticated;
grant execute on function public.media_extension(text) to service_role;

notify pgrst, 'reload schema';
