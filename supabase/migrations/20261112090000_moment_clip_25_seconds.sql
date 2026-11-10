-- A Moment clip is 25 seconds, not a minute.
--
-- The app enforced the old limit in four places and the database in one, which
-- is the right shape — but the limit itself was wrong: a Moment is a glimpse,
-- and a minute of glimpse is a post. This raises nothing; it lowers the ceiling
-- and restates it in the one place every client has to agree with.
--
-- Existing clips longer than 25 seconds are left alone. They expire within a
-- day, and shortening somebody's live Moment would be a stranger change than the
-- one being made here: new clips are capped, old ones run out.

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
  if clean_kind = 'video' and (p_duration_ms is null or p_duration_ms < 100 or p_duration_ms > 25000) then
    perform public.crushly_fail(400, 'moment_too_long', 'Choose a clip that is no longer than 25 seconds.');
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
