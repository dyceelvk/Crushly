-- Let the poster register the marked copy of their own clip, without letting
-- anybody choose where a download points.
--
-- Why this is needed. `register_post_download` is service_role only, and it must
-- stay that way: it takes an object key, and an app that can name the key can
-- point a member's Save button at any file in the bucket. That was the right
-- call while the only writer was the scheduled job.
--
-- But it is also why the Save row appeared minutes after posting. The mark is
-- now produced on the phone, before the upload, so the row can exist immediately
-- — as long as the client can record it. The compromise here is the key: the
-- client cannot pass one. It is derived from the post's own media key, which the
-- database already holds, so the worst a modified app can do is register a
-- different file *inside that post's own folder* — a file it could have uploaded
-- as the post itself anyway.

/**
 * The bucket key of a post's original clip.
 *
 * `posts.media_url` is a full URL (`https://host/m/posts/<uid>/<ts>.mp4`); the
 * bucket key is everything after `/m/`. Mirrors `object_key()` in
 * `scripts/mark_pending_clips.py`, which must keep agreeing with it.
 */
create or replace function public.media_object_key(p_media_url text)
returns text
language sql
immutable
as $function$
  select case
    when p_media_url is null or p_media_url = '' then null
    when position('/m/' in p_media_url) = 0 then null
    else ltrim(split_part(p_media_url, '/m/', 2), '/')
  end;
$function$;

/** `posts/<uid>/<ts>.mp4` -> `posts/<uid>/<ts>-marked.mp4`, as the job does it. */
create or replace function public.marked_download_key(p_object_key text)
returns text
language sql
immutable
as $function$
  select case
    when p_object_key is null or p_object_key = '' then null
    when p_object_key ~ '\.[A-Za-z0-9]+$' then regexp_replace(p_object_key, '\.[A-Za-z0-9]+$', '-marked.mp4')
    else p_object_key || '-marked.mp4'
  end;
$function$;

create or replace function public.register_own_post_download(p_post_id bigint)
returns boolean
language plpgsql
volatile security definer
set search_path to 'public'
as $function$
declare
  me bigint := public.me_id();
  key text;
begin
  if me is null then
    return false;                      -- signed out: nothing to own
  end if;

  -- The post must be mine AND a clip. Kind is decided by extension because
  -- `posts` has no media_kind column; this is the same test the feed uses.
  select public.marked_download_key(public.media_object_key(media_url))
    into key
    from posts
   where id = p_post_id
     and author_id = me
     and media_url ~* '\.(mp4|mov|m4v|webm)([?#].*)?$';

  if key is null then
    return false;                      -- not mine, not a clip, or no file
  end if;

  insert into post_downloads (post_id, object_key, bytes)
  values (p_post_id, key, null)
  on conflict (post_id) do update
    set object_key = excluded.object_key,
        created_at = public.now_ms();

  return true;
end $function$;

revoke all on function public.register_own_post_download(bigint) from public, anon;
grant execute on function public.register_own_post_download(bigint) to authenticated;
revoke all on function public.marked_download_key(text) from public, anon;
grant execute on function public.marked_download_key(text) to authenticated, service_role;
revoke all on function public.media_object_key(text) from public, anon;
grant execute on function public.media_object_key(text) to authenticated, service_role;
