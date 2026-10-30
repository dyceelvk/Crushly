-- 20261030000045 media_upload_reservations
--
-- RECONSTRUCTED 2026-10-30 from the live production catalog (columns,
-- pg_constraint, pg_indexes, pg_policy, pg_get_functiondef). Idempotent.
--
-- What this migration owns: the upload ticket.
--   * media_upload_ticket(kind, content_type, bytes) - mints the object path
--     server-side and reserves it, so the client never invents a path and the
--     per-hour rate limit cannot be sidestepped by uploading first and
--     declaring afterwards.
--   * media_upload_reservations table + indexes
--   * cleanup_expired_media() - the janitor entry point
--
-- RLS is deliberately ON with NO policies: reservations are an internal ledger.
-- Nothing may read or write them through PostgREST; media_upload_ticket() is
-- SECURITY DEFINER and runs as the owner. Adding a policy here would expose
-- other users' paths and byte counts for no product reason.
--
-- Two overlapping indexes on (user_id, created_at) exist in production —
-- media_upload_reservations_recent (desc) and _user_time (asc). Both are
-- reproduced rather than tidied away, because the goal of this file is to make
-- a rebuild match production exactly; dropping the redundant one is a separate,
-- reviewable change.

create table if not exists public.media_upload_reservations (
  path       text primary key,
  user_id    bigint not null references public.profiles(id) on delete cascade,
  bytes      integer not null check (bytes > 0),
  created_at bigint not null default public.now_ms()
);

create index if not exists media_upload_reservations_recent
  on public.media_upload_reservations (user_id, created_at desc);

create index if not exists media_upload_reservations_user_time
  on public.media_upload_reservations (user_id, created_at);

alter table public.media_upload_reservations enable row level security;

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
  if p_kind is null or p_kind not in ('photos', 'moments', 'messages', 'posts', 'circles', 'vibes') then
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
      when p_kind = 'vibes' then 'Vibes are short video clips, with a still for the cover.'
      else 'That file type is not supported.' end);
  end if;
  if p_kind = 'messages' and v_ext not in ('jpg', 'png', 'webp', 'm4a', 'mp3', 'mp4', 'webm', 'mov') then
    perform public.crushly_fail(415, '', 'That file type is not supported.');
  end if;

  v_limit := case when p_kind in ('messages', 'circles', 'vibes', 'posts') then 80 * 1024 * 1024 else 8 * 1024 * 1024 end;
  if coalesce(p_bytes, 0) <= 0 then
    perform public.crushly_fail(400, '', 'That file looks empty - try picking it again.');
  elsif p_bytes > v_limit then
    perform public.crushly_fail(413, '', 'That file is too large to send.');
  end if;

  -- Serialise per user so two concurrent uploads cannot both read the same
  -- count and slip past the hourly ceiling.
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
end $function$;

create or replace function public.cleanup_expired_media()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  return jsonb_build_object(
    'moments', public.cleanup_expired_moments(),
    'vibes', public.cleanup_expired_vibes()
  );
end $function$;

-- Execution grants, matching production pg_proc.proacl.
revoke all on function public.media_upload_ticket(text, text, integer) from public, anon, authenticated;
grant execute on function public.media_upload_ticket(text, text, integer) to authenticated, service_role;

notify pgrst, 'reload schema';

-- Execution grants, matching production pg_proc.proacl.
revoke all on function public.cleanup_expired_media() from public, anon, authenticated;
grant execute on function public.cleanup_expired_media() to service_role;

notify pgrst, 'reload schema';
