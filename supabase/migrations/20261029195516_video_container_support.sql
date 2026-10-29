-- Accept the video containers a phone actually produces.
--
-- `media_extension` is the only gate between a chosen clip and storage, and it
-- knew two video types: video/mp4 and video/webm. A `.mov` — what an iPhone and
-- a Samsung gallery hand over, labelled `video/quicktime` — was refused with a
-- 415 before a byte was written. That is the whole of "That file type is not
-- supported." for a file the member could see playing on their own phone.
--
-- The client now remuxes such a clip into MP4 on the device, which is the
-- preferred path because every player in the app reads MP4. This is the belt to
-- that pair of braces: MP4 and WebM stay the first-class types, and QuickTime is
-- accepted so a remux that cannot run (no native module, an unusual codec)
-- still results in a stored file rather than a lost post. Serving is given an
-- explicit `video/quicktime` by the Worker for `.mov`, so nothing downstream has
-- to guess from a byte stream.
--
-- Nothing here widens what a member may upload beyond video: no MIME type is
-- added that a browser will treat as executable or as a document.

create or replace function public.media_extension(p_content_type text)
returns text
language sql
immutable
as $$
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
$$;

-- `posts` and `moments` already permit mp4/webm; let them hold a remux that
-- arrived as QuickTime without a second round trip.
create or replace function public.media_kind_allows(p_kind text, p_ext text)
returns boolean
language sql
immutable
as $$
  select case
    when p_kind = 'photos' then p_ext in ('jpg', 'png', 'webp')
    when p_kind in ('moments', 'posts') then p_ext in ('jpg', 'png', 'webp', 'mp4', 'webm', 'mov')
    when p_kind = 'circles' then p_ext in ('jpg', 'png', 'webp', 'm4a', 'mp3', 'mp4', 'webm', 'mov')
    when p_kind = 'vibes' then p_ext in ('mp4', 'webm', 'mov', 'jpg', 'png', 'webp')
    else false
  end
$$;

-- The ticket is where the 415 actually came from, so it is rewritten to use the
-- rule above rather than keeping its own copy of the same four sentences. Same
-- signatures, same ceilings, same rate limit, same booking of the path.
create or replace function public.media_upload_ticket(
  p_kind text,
  p_content_type text,
  p_bytes integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
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
    perform public.crushly_fail(415, '', 'That file type is not supported.');
  end if;
  if not public.media_kind_allows(p_kind, v_ext) then
    perform public.crushly_fail(
      415,
      '',
      case
        when p_kind = 'photos' then 'Photos must be JPEG, PNG or WebP.'
        when p_kind in ('moments', 'posts') then 'That takes a photo or a short clip.'
        when p_kind = 'circles' then 'Circles take photos, voice notes and clips.'
        when p_kind = 'vibes' then 'Vibes are short video clips, with a still for the cover.'
        else 'That file type is not supported.'
      end
    );
  end if;
  -- A clip has to be a clip. Attaching an audio file to a post used to be
  -- refused by the extension list doing double duty; say it plainly instead.
  if p_kind = 'messages' and v_ext not in ('jpg', 'png', 'webp', 'm4a', 'mp3', 'mp4', 'webm', 'mov') then
    perform public.crushly_fail(415, '', 'That file type is not supported.');
  end if;

  v_limit := case
    when p_kind in ('messages', 'circles', 'vibes', 'posts') then 80 * 1024 * 1024
    else 8 * 1024 * 1024
  end;
  if coalesce(p_bytes, 0) <= 0 then
    perform public.crushly_fail(400, '', 'That file looks empty - try picking it again.');
  elsif p_bytes > v_limit then
    perform public.crushly_fail(413, '', 'That file is too large to send.');
  end if;

  -- The ceiling counts what was actually published in the last hour, across
  -- every kind — not just the ones that reached this function. Counting
  -- reservations alone let a member publish 40 moments and then keep uploading,
  -- because a moment created without a file books no reservation. This is the
  -- rule the ticket has always enforced and it is reproduced here unchanged.
  perform 1 from profiles where id = me for update;
  select (select count(*) from photos where user_id = me and created_at > public.now_ms() - 3600 * 1000)
       + (select count(*) from moments where user_id = me and created_at > public.now_ms() - 3600 * 1000)
       + (select count(*) from messages where sender_id = me and created_at > public.now_ms() - 3600 * 1000)
       + (select count(*) from posts where author_id = me and created_at > public.now_ms() - 3600 * 1000)
       + (select count(*) from circle_messages where sender_id = me and created_at > public.now_ms() - 3600 * 1000)
       + (select count(*) from vibes where author_id = me and created_at > public.now_ms() - 3600 * 1000)
    into n;
  if n >= 40 then
    perform public.crushly_fail(429, '', 'That is a lot of uploading - try again in a little while.');
  end if;

  if p_kind = 'photos' and (select count(*) from photos where user_id = me) >= 6 then
    perform public.crushly_fail(400, '', 'You can show up to 6 photos.');
  end if;

  v_path := p_kind || '/' || me::text || '/' || public.now_ms()::text || '-'
    || substr(md5(random()::text || me::text || public.now_ms()::text), 1, 10) || '.' || v_ext;

  insert into media_upload_reservations(path, user_id, bytes) values (v_path, me, p_bytes);

  return jsonb_build_object('path', v_path, 'maxBytes', v_limit, 'extension', v_ext);
end $$;
