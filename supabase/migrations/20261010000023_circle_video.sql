-- Circles can carry a clip.
--
-- A room of about twelve people talks in text, photos and voice notes. It can
-- now send a short clip, edited with the same editor every other surface uses,
-- capped at a minute — long enough to say something to a room, short enough
-- that it never becomes a broadcast inside a private space.
--
-- The `edit` column arrived for every surface in 021.

alter table public.circle_messages drop constraint if exists circle_messages_kind_check;
alter table public.circle_messages
  add constraint circle_messages_kind_check
  check (kind in ('text', 'photo', 'voice', 'video'));

-- Circles take photos, voice notes and now clips.
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
  if p_kind not in ('photos', 'moments', 'messages', 'posts', 'circles', 'vibes') then
    perform public.crushly_fail(400, '', 'Unsupported media kind.');
  end if;

  v_ext := public.media_extension(p_content_type);
  if v_ext is null then
    perform public.crushly_fail(415, '', 'That file type isn’t supported.');
  end if;
  if p_kind = 'photos' and v_ext not in ('jpg', 'png', 'webp') then
    perform public.crushly_fail(415, '', 'Photos must be JPEG, PNG or WebP.');
  end if;
  -- A Moment or a Flow may carry a photo or a clip. Moments are capped far
  -- tighter in the app (fifteen seconds), because they are a glance.
  if p_kind in ('moments', 'posts') and v_ext not in ('jpg', 'png', 'webp', 'mp4', 'webm') then
    perform public.crushly_fail(415, '', 'That takes a photo or a short clip.');
  end if;
  if p_kind = 'circles' and v_ext not in ('jpg', 'png', 'webp', 'm4a', 'mp3', 'mp4', 'webm') then
    perform public.crushly_fail(415, '', 'Circles take photos, voice notes and clips.');
  end if;
  if p_kind = 'vibes' and v_ext not in ('mp4', 'webm', 'jpg', 'png', 'webp') then
    perform public.crushly_fail(415, '', 'Vibes are short video clips, with a still for the cover.');
  end if;

  v_limit := case when p_kind in ('messages', 'circles', 'vibes', 'posts') then 25 * 1024 * 1024
                  else 8 * 1024 * 1024 end;
  if coalesce(p_bytes, 0) <= 0 then
    perform public.crushly_fail(400, '', 'That file looks empty — try picking it again.');
  elsif p_bytes > v_limit then
    perform public.crushly_fail(413, '', 'That file is too large to send.');
  end if;

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

  return jsonb_build_object('path', v_path, 'maxBytes', v_limit, 'extension', v_ext);
end $$;

-- The live half goes out with every message, so a caption drawn over a clip in
-- a room looks the same to all twelve people in it.
create or replace function public.circle_messages(
  p_circle_id bigint, p_limit integer default 30, p_before bigint default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me bigint := public.me_id();
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  if not public.is_circle_member(p_circle_id, me) then
    perform public.crushly_fail(404, '', 'Circle not found.');
  end if;

  return (
    select jsonb_build_object('items', coalesce(jsonb_agg(t.item order by t.created_at, t.id), '[]'::jsonb))
    from (
      select jsonb_build_object(
        'id', m.id, 'circleId', m.circle_id, 'senderId', m.sender_id, 'mine', m.sender_id = me,
        'kind', m.kind, 'body', m.body, 'mediaUrl', m.media_url, 'createdAt', m.created_at,
        'edit', m.edit
      ) as item, m.created_at, m.id
      from circle_messages m
      where m.circle_id = p_circle_id
        and (p_before is null or m.id < p_before)
        and not public.is_blocked_pair(me, m.sender_id)
      order by m.id desc
      limit least(greatest(coalesce(p_limit, 30), 1), 100)
    ) t
  );
end $$;

create or replace function public.send_circle_message(
  p_circle_id bigint, p_body text default '', p_media_url text default null,
  p_kind text default 'text', p_edit jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  clean_body text := left(coalesce(p_body, ''), 2000);
  clean_media text := nullif(coalesce(p_media_url, ''), '');
  clean_edit jsonb := public.clean_video_edit(p_edit);
  v_kind text := coalesce(p_kind, 'text');
  new_id bigint;
  n int;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  if not public.is_circle_member(p_circle_id, me) then
    perform public.crushly_fail(404, '', 'Circle not found.');
  end if;
  if v_kind not in ('text', 'photo', 'voice', 'video') then
    perform public.crushly_fail(400, '', 'That message type isn’t supported here.');
  end if;
  if v_kind = 'text' and btrim(clean_body) = '' then
    perform public.crushly_fail(400, '', 'Write something first.');
  end if;
  if v_kind <> 'text' and clean_media is null then
    perform public.crushly_fail(400, '', 'That attachment didn’t come through — try again.');
  end if;

  -- Sixty an hour: a busy room, not a firehose.
  select count(*) into n from circle_messages m
   where m.sender_id = me and m.created_at > public.now_ms() - 3600 * 1000;
  if n >= 60 then
    perform public.crushly_fail(429, '', 'That room is moving fast — give it a moment.');
  end if;

  insert into circle_messages (circle_id, sender_id, kind, body, media_url, edit)
  values (p_circle_id, me, v_kind, clean_body, clean_media, clean_edit)
  returning id into new_id;

  return jsonb_build_object(
    'id', new_id, 'circleId', p_circle_id, 'senderId', me, 'mine', true,
    'kind', v_kind, 'body', clean_body, 'mediaUrl', clean_media,
    'createdAt', public.now_ms(), 'edit', clean_edit
  );
end $$;

revoke all on function public.media_upload_ticket(text, text, int) from public, anon, authenticated;
grant execute on function public.media_upload_ticket(text, text, int) to authenticated, service_role;

revoke all on function public.circle_messages(bigint, integer, bigint) from public, anon, authenticated;
grant execute on function public.circle_messages(bigint, integer, bigint) to authenticated, service_role;

revoke all on function public.send_circle_message(bigint, text, text, text) from public, anon, authenticated;
revoke all on function public.send_circle_message(bigint, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.send_circle_message(bigint, text, text, text, jsonb) to authenticated, service_role;
