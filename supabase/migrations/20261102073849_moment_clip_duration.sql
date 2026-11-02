-- Moment video duration and one-minute limit.
-- Existing Moments remain readable; new video Moments report their selected
-- playback length so the viewer can pace its progress line. The old RPC overload
-- stays available for existing clients; it had a 15-second client-side cap.

alter table public.moments
  add column if not exists duration_ms bigint;

alter table public.moments
  drop constraint if exists moments_video_duration_ms_check;
alter table public.moments
  add constraint moments_video_duration_ms_check
  check (
    kind <> 'video'
    or duration_ms is null
    or duration_ms between 100 and 60000
  );

create or replace function public.serialize_moment(m public.moments, p_viewer bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  mine boolean := m.user_id = p_viewer;
  result jsonb;
begin
  result := jsonb_build_object(
    'id', m.id,
    'userId', m.user_id,
    'kind', m.kind,
    'body', m.body,
    'mediaUrl', m.media_url,
    'style', m.style,
    'audience', m.audience,
    'createdAt', m.created_at,
    'expiresAt', m.expires_at,
    'edit', m.edit,
    'durationMs', m.duration_ms,
    'seen', exists (select 1 from moment_views mv where mv.moment_id = m.id and mv.user_id = p_viewer),
    'myReaction', (select r.kind from moment_reactions r where r.moment_id = m.id and r.user_id = p_viewer),
    'author', (
      select jsonb_build_object(
        'id', pf.id,
        'name', pf.name,
        'verified', pf.verification = 'verified',
        'photo', public.photos_of(pf.id) -> 0 ->> 'url',
        'mutual', pf.id <> p_viewer and public.is_connected_pair(p_viewer, pf.id)
      ) from profiles pf where pf.id = m.user_id
    )
  );
  if mine then
    result := result || jsonb_build_object(
      'viewCount', (select count(*)::int from moment_views mv where mv.moment_id = m.id and mv.user_id <> p_viewer),
      'reactions', coalesce((
        select jsonb_agg(jsonb_build_object('kind', r.kind, 'userId', r.user_id, 'name', p.name)
                         order by r.created_at desc)
          from moment_reactions r join profiles p on p.id = r.user_id
         where r.moment_id = m.id
      ), '[]'::jsonb)
    );
  end if;
  return result;
end $$;

-- `p_duration_ms` is required and comes before the optional p_edit. Keeping it
-- required gives PostgREST a unique match for new video clients while the older
-- six-argument RPC remains compatible with clients that do not send duration.
create or replace function public.create_moment(
  p_kind text,
  p_body text,
  p_media_url text,
  p_style text,
  p_audience text,
  p_duration_ms bigint,
  p_edit jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  clean_kind text := coalesce(p_kind, 'text');
  clean_body text := coalesce(p_body, '');
  clean_style text := coalesce(p_style, 'noir');
  clean_audience text := coalesce(p_audience, 'everyone');
  clean_edit jsonb := public.clean_video_edit(p_edit);
  new_id bigint;
  m public.moments;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  if clean_kind not in ('text', 'photo', 'video') then
    perform public.crushly_fail(400, '', 'Moments are words, a photo or a short clip.');
  end if;
  if clean_style not in ('noir', 'champagne', 'crimson', 'midnight', 'emerald') then
    clean_style := 'noir';
  end if;
  if clean_audience not in ('everyone', 'connections') then
    clean_audience := 'everyone';
  end if;
  if clean_kind = 'text' and btrim(clean_body) = '' then
    perform public.crushly_fail(400, '', 'Say something in your Moment.');
  end if;
  if clean_kind = 'video' and (p_duration_ms is null or p_duration_ms < 100 or p_duration_ms > 60000) then
    perform public.crushly_fail(400, 'moment_too_long', 'Choose a clip that is no longer than 1 minute.');
  end if;
  clean_body := left(clean_body, case when clean_kind = 'text' then 280 else 200 end);

  if clean_kind in ('photo', 'video') and nullif(coalesce(p_media_url, ''), '') is null then
    perform public.crushly_fail(400, '', clean_kind || ' Moments need a file.');
  end if;

  insert into moments (user_id, kind, body, media_url, style, audience, expires_at, edit, duration_ms)
  values (me, clean_kind, clean_body, nullif(coalesce(p_media_url, ''), ''), clean_style, clean_audience,
          public.now_ms() + 24 * 60 * 60 * 1000, clean_edit,
          case when clean_kind = 'video' then p_duration_ms else null end)
  returning id into new_id;
  select * into m from moments mo where mo.id = new_id;
  return public.serialize_moment(m, me);
end $$;

revoke all on function public.create_moment(text, text, text, text, text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.create_moment(text, text, text, text, text, bigint, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
