-- 20261013000027 feed_pagination
--
-- RECONSTRUCTED 2026-10-30 from the live production catalog (pg_get_functiondef).
-- The file was never committed; this body is the current production definition.
-- Idempotent (create or replace), so it is safe to replay.
--
-- What this migration owns: keyset pagination for every paged feed.
--   * flow_feed(p_limit, p_after)          - the home Flow (non-circle posts)
--   * public_flow_feed(p_limit, p_after)   - the "everyone" tab
--   * circle_feed(id, p_limit, p_after)    - posts inside one Circle
--   * discover_feed(p_limit, p_offset)     - the scored people deck
--
-- The cursor is (created_at, id) descending rather than an offset, so a post
-- that arrives while you are scrolling cannot push the page you are already
-- looking at one row sideways. discover_feed stays offset-based because its
-- order is a live relevance score, not a stable column.

create or replace function public.flow_feed(p_limit integer default 20, p_after bigint default null::bigint)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  me    bigint := public.me_id();
  items jsonb := '[]'::jsonb;
  r     record;
  post  public.posts;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  for r in
    select po.* from posts po
     where public.can_view_post(po, me)
       and po.circle_id is null
       and (p_after is null or po.created_at < (select p2.created_at from posts p2 where p2.id = p_after)
                             or (po.created_at = (select p2.created_at from posts p2 where p2.id = p_after) and po.id < p_after))
     order by po.created_at desc, po.id desc
     limit least(greatest(coalesce(p_limit, 20), 1), 50)
  loop
    select * into post from posts where id = r.id;
    if public.can_view_post(post, me) then
      items := items || jsonb_build_array(
        jsonb_build_object(
          'id', r.id,
          'body', r.body,
          'mediaUrl', r.media_url,
          'mediaKind', case
            when r.media_url is null then null
            when r.media_url ~ '\.(mp4|webm|mov|m4v)(\?|$)' then 'video'
            else 'photo'
          end,
          'edit', r.edit,
          'audience', r.audience,
          'circleId', r.circle_id,
          'createdAt', r.created_at,
          'author', public.public_profile(me, r.author_id, false),
          'mine', r.author_id = me
        ) || public.post_engagement(r.id, me)
      );
    end if;
  end loop;

  return jsonb_build_object('items', items);
end $function$;

create or replace function public.public_flow_feed(p_limit integer default 20, p_after bigint default null::bigint)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  me    bigint := public.me_id();
  items jsonb := '[]'::jsonb;
  r     record;
  post  public.posts;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  for r in
    select po.* from posts po
     where public.can_view_post(po, me)
       and po.audience = 'everyone'
       and po.circle_id is null
       and po.author_id <> me
       and (
         p_after is null
         or po.created_at < (select p2.created_at from posts p2 where p2.id = p_after)
         or (
           po.created_at = (select p2.created_at from posts p2 where p2.id = p_after)
           and po.id < p_after
         )
       )
     order by po.created_at desc, po.id desc
     limit least(greatest(coalesce(p_limit, 20), 1), 50)
  loop
    select * into post from posts where id = r.id;
    if public.can_view_post(post, me) then
      items := items || jsonb_build_array(
        jsonb_build_object(
          'id', r.id,
          'body', r.body,
          'mediaUrl', r.media_url,
          'mediaKind', case
            when r.media_url is null then null
            when r.media_url ~ '\.(mp4|webm|mov|m4v)(\?|$)' then 'video'
            else 'photo'
          end,
          'edit', r.edit,
          'audience', r.audience,
          'createdAt', r.created_at,
          'author', public.public_profile(me, r.author_id, false),
          'mine', false
        ) || public.post_engagement(r.id, me)
      );
    end if;
  end loop;

  return jsonb_build_object('items', items);
end $function$;

create or replace function public.circle_feed(p_circle_id bigint, p_limit integer default 20, p_after bigint default null::bigint)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  me    bigint := public.me_id();
  items jsonb := '[]'::jsonb;
  r     record;
  post  public.posts;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  if not public.is_circle_member(p_circle_id, me) then
    perform public.crushly_fail(404, '', 'Circle not found.');
  end if;

  for r in
    select po.* from posts po
     where public.can_view_post(po, me)
       and po.circle_id = p_circle_id
       and (p_after is null or po.created_at < (select p2.created_at from posts p2 where p2.id = p_after)
                             or (po.created_at = (select p2.created_at from posts p2 where p2.id = p_after) and po.id < p_after))
     order by po.created_at desc, po.id desc
     limit least(greatest(coalesce(p_limit, 20), 1), 50)
  loop
    select * into post from posts where id = r.id;
    if public.can_view_post(post, me) then
      items := items || jsonb_build_array(
        jsonb_build_object(
          'id', r.id,
          'body', r.body,
          'mediaUrl', r.media_url,
          'mediaKind', case
            when r.media_url is null then null
            when r.media_url ~ '\.(mp4|webm|mov|m4v)(\?|$)' then 'video'
            else 'photo'
          end,
          'edit', r.edit,
          'audience', r.audience,
          'circleId', r.circle_id,
          'createdAt', r.created_at,
          'author', public.public_profile(me, r.author_id, false),
          'mine', r.author_id = me
        ) || public.post_engagement(r.id, me)
      );
    end if;
  end loop;

  return jsonb_build_object('items', items);
end $function$;

create or replace function public.discover_feed(p_limit integer default 24, p_offset integer default 0)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  me bigint := public.me_id();
  v record;
  prefs record;
  scored jsonb := '[]'::jsonb;
  total int := 0;
  items jsonb := '[]'::jsonb;
  r record;
  age int;
  km double precision;
  shared int;
  shared_intent int;
  score numeric;
  overlap boolean;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  select p.lat, p.lng, p.interests, p.intentions into v from profiles p where p.id = me;
  select * into prefs from preferences where user_id = me;

  for r in
    select p.*, pr.show_distance, pr.show_online, pr.discoverable, pr.profile_visibility,
           pr.who_can_message, pr.who_can_crush, pr.show_age, pr.show_city, pr.incognito
      from profiles p join privacy pr on pr.user_id = p.id
     where p.id <> me and p.onboarded and p.status = 'active'
       and pr.discoverable and not pr.incognito and pr.profile_visibility = 'everyone'
       and (not prefs.verified_only or p.verification = 'verified')
       and not public.is_blocked_pair(me, p.id)
       and not exists (select 1 from crushes c where c.from_id = me and c.to_id = p.id)
       and not exists (select 1 from passes x where x.from_id = me and x.to_id = p.id)
       and not public.is_connected_pair(me, p.id)
  loop
    age := public.age_of(r.birthdate);
    if age is null or age < prefs.age_min or age > prefs.age_max then
      continue;
    end if;
    km := public.distance_km(v.lat, v.lng, r.lat, r.lng);
    if prefs.max_distance > 0 and km is not null and km > prefs.max_distance then
      continue;
    end if;

    -- Preference filters require some overlap when set.
    if jsonb_array_length(coalesce(prefs.intentions, '[]'::jsonb)) > 0 then
      select exists (
        select 1 from jsonb_array_elements_text(coalesce(r.intentions, '[]'::jsonb)) i
         where i in (select jsonb_array_elements_text(coalesce(prefs.intentions, '[]'::jsonb)))
      ) into overlap;
      if not overlap then continue; end if;
    end if;
    if jsonb_array_length(coalesce(prefs.interests, '[]'::jsonb)) > 0 then
      select exists (
        select 1 from jsonb_array_elements_text(coalesce(r.interests, '[]'::jsonb)) i
         where i in (select jsonb_array_elements_text(coalesce(prefs.interests, '[]'::jsonb)))
      ) into overlap;
      if not overlap then continue; end if;
    end if;

    select count(*)::int into shared from jsonb_array_elements_text(coalesce(r.interests, '[]'::jsonb)) i
     where i in (select jsonb_array_elements_text(coalesce(v.interests, '[]'::jsonb)));
    select count(*)::int into shared_intent from jsonb_array_elements_text(coalesce(r.intentions, '[]'::jsonb)) i
     where i in (select jsonb_array_elements_text(coalesce(v.intentions, '[]'::jsonb)));

    score := shared * 3 + shared_intent * 2;
    if r.verification = 'verified' then score := score + 2; end if;
    if public.is_online_at(r.last_active_at) then score := score + 3; end if;
    if km is not null then score := score + greatest(0, 4 - km / 10); end if;
    if exists (select 1 from crushes c where c.from_id = r.id and c.to_id = me) then
      score := score + 1; -- gently surface people already into you
    end if;

    scored := scored || jsonb_build_array(jsonb_build_object(
      'id', r.id, 'score', score, 'last', r.last_active_at,
      'profile', public.public_profile(me, r.id, false)
    ));
  end loop;

  total := jsonb_array_length(scored);

  with ordered as (
    select value as item, row_number() over (
      order by (value ->> 'score')::numeric desc, (value ->> 'last')::bigint desc
    ) as rn
      from jsonb_array_elements(scored)
  )
  select coalesce(jsonb_agg(item -> 'profile' order by rn), '[]'::jsonb) into items
    from ordered where rn > p_offset and rn <= p_offset + greatest(coalesce(p_limit, 24), 1);

  return jsonb_build_object(
    'items', items,
    'nextOffset', case
      when p_offset + greatest(coalesce(p_limit, 24), 1) < total
        then p_offset + greatest(coalesce(p_limit, 24), 1)
      else null end,
    'total', total,
    'viewerHasLocation', v.lat is not null
  );
end $function$;

-- Execution grants, matching production pg_proc.proacl.
revoke all on function public.flow_feed(integer, bigint) from public, anon, authenticated;
grant execute on function public.flow_feed(integer, bigint) to authenticated, service_role;
revoke all on function public.public_flow_feed(integer, bigint) from public, anon, authenticated;
grant execute on function public.public_flow_feed(integer, bigint) to authenticated, service_role;
revoke all on function public.circle_feed(bigint, integer, bigint) from public, anon, authenticated;
grant execute on function public.circle_feed(bigint, integer, bigint) to authenticated, service_role;
revoke all on function public.discover_feed(integer, integer) from public, anon, authenticated;
grant execute on function public.discover_feed(integer, integer) to authenticated, service_role;

notify pgrst, 'reload schema';
