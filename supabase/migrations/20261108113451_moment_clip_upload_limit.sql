-- Keep photo limits intact but let one-minute Moment clips upload.
create or replace function public.media_upload_ticket(p_kind text, p_content_type text, p_bytes integer default 0)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  if p_kind is null or p_kind not in ('photos', 'moments', 'messages', 'posts', 'circles') then
    perform public.crushly_fail(400, '', 'Unsupported media kind.');
  end if;

  v_ext := public.media_extension(p_content_type);
  if v_ext is null then
    perform public.crushly_fail(415, '', 'That file type is not supported.');
  end if;
  if not public.media_kind_allows(p_kind, v_ext) then
    perform public.crushly_fail(415, '', case
      when p_kind = 'photos' then 'Photos must be JPEG, PNG or WebP.'
      when p_kind in ('moments', 'posts') then 'That takes a photo or a short clip.'
      when p_kind = 'circles' then 'Circles take photos, voice notes and clips.'
      else 'That file type is not supported.' end);
  end if;

  -- A Moment clip can be up to one minute: give video the same 80 MiB ceiling
  -- as other clips while retaining the 8 MiB ceiling for Moment photos.
  v_limit := case when p_kind in ('messages', 'circles', 'posts')
    or (p_kind = 'moments' and v_ext in ('mp4', 'webm', 'mov'))
    then 80 * 1024 * 1024 else 8 * 1024 * 1024 end;
  if coalesce(p_bytes, 0) <= 0 then
    perform public.crushly_fail(400, '', 'That file looks empty - try picking it again.');
  elsif p_bytes > v_limit then
    perform public.crushly_fail(413, '', 'That file is too large to send.');
  end if;

  perform 1 from profiles where id = me for update;
  select (select count(*) from photos where user_id = me and created_at > public.now_ms() - 3600 * 1000)
       + (select count(*) from moments where user_id = me and created_at > public.now_ms() - 3600 * 1000)
       + (select count(*) from messages where sender_id = me and created_at > public.now_ms() - 3600 * 1000)
       + (select count(*) from posts where author_id = me and created_at > public.now_ms() - 3600 * 1000)
       + (select count(*) from circle_messages where sender_id = me and created_at > public.now_ms() - 3600 * 1000)
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
end $function$;

