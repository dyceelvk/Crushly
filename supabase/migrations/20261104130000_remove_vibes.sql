-- Vibes are gone.
--
-- The brief was to remove Vibes completely, not to hide them: the nav entry, the
-- discover row, the composer, the search tab, the Space tab, the notification
-- copy, the client, the endpoints — and the tables they were the only user of.
--
-- Three things had to move before anything could be dropped, and they are the
-- reason this file starts with three function bodies rather than a `drop table`:
--
--   * `media_upload_ticket` counts the last hour's uploads per member, and one
--     of the six terms it counted was `vibes`. Dropping the table under it would
--     have broken every upload in the app, not just Vibes.
--
--   * `search_all` returned a `vibes` array alongside members, posts and
--     Moments. The client no longer reads it, but a function that selects from a
--     dropped table cannot be left in place either.
--
--   * `can_manage_media` and `can_view_media` — the gates every private media
--     write and read passes through —
--     declared a `vibes` row variable and resolved `vibes/` paths against the
--     table. A plpgsql body is not validated when it is created, so this one
--     survived the drop and only failed the first time somebody opened a photo:
--     which is exactly how the Postgres smoke suite caught it, twice — the write
--     gate was hiding behind the read gate. Both are redefined below with their
--     Vibe branches removed and every other branch untouched.
--
-- What is dropped afterwards is Vibes and only Vibes: `vibes`, its two
-- children (`vibe_views`, `vibe_reactions`) and the seven functions that served
-- them. Moments, posts, Circles, sounds, reactions and profile data are not
-- touched, and no storage object is deleted — the clips already uploaded stay in
-- the bucket under `vibes/`, unreferenced, so nothing that is not ours is lost.
--
-- Written by Odoh chiagoziem isreal's team, on the existing schema.

/* ------------------------------------------------- uploads, search, media */
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

  v_limit := case when p_kind in ('messages', 'circles', 'posts') then 80 * 1024 * 1024 else 8 * 1024 * 1024 end;
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

create or replace function public.search_all(p_query text, p_limit int default 8)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me  bigint := public.me_id();
  q   text := btrim(coalesce(p_query, ''));
  n   int := least(greatest(coalesce(p_limit, 8), 1), 20);
  tsq tsquery;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  -- One letter would match nearly everything and tell nobody anything.
  if char_length(q) < 2 then
    return jsonb_build_object(
      'members', '[]'::jsonb,
      'posts', '[]'::jsonb,
      'moments', '[]'::jsonb
    );
  end if;

  -- websearch_to_tsquery, not to_tsquery: it never raises on odd punctuation,
  -- so a member typing a quote or a dash gets results instead of an error.
  tsq := websearch_to_tsquery('simple', q);

  return jsonb_build_object(
    'members', (
      select coalesce(jsonb_agg(x.member), '[]'::jsonb)
        from (
          select public.public_profile(me, p.id, false) as member
            from profiles p
            join privacy pr on pr.user_id = p.id
           where p.id <> me
             and p.onboarded
             and p.status = 'active'
             and pr.discoverable
             and not pr.incognito
             and not public.is_blocked_pair(me, p.id)
             -- Somebody who has made his Space Connections-only is still
             -- findable by the people he is connected to, and by nobody else.
             and (pr.profile_visibility = 'everyone' or public.is_connected_pair(me, p.id))
             and (
                  to_tsvector('simple', coalesce(p.name, '') || ' ' || coalesce(p.username, '') || ' ' || coalesce(p.city, '')) @@ tsq
               or coalesce(p.name, '')     ilike public.search_like(q)
               or coalesce(p.username, '') ilike public.search_like(q)
               or coalesce(p.city, '')     ilike public.search_like(q)
               or exists (
                    select 1 from jsonb_array_elements_text(
                      case when jsonb_typeof(p.interests) = 'array' then p.interests else '[]'::jsonb end
                    ) as i where i ilike public.search_like(q)
                  )
             )
           order by
             (coalesce(p.name, '') ilike q || '%') desc,
             (coalesce(p.username, '') ilike q || '%') desc,
             p.name
           limit n
        ) x
    ),

    -- Flows. A post written inside a Circle is not a post you can search for:
    -- it belongs to that room, and the room is the only door.
    'posts', (
      select coalesce(jsonb_agg(x.item), '[]'::jsonb)
        from (
          select jsonb_build_object(
                   'id', po.id,
                   'body', po.body,
                   'mediaUrl', po.media_url,
                   'audience', po.audience,
                   'createdAt', po.created_at,
                   'author', public.public_profile(me, po.author_id, false)
                 ) as item
            from posts po
           where po.circle_id is null
             and public.can_view_post(po, me)
             and (
                  to_tsvector('simple', coalesce(po.body, '')) @@ tsq
               or coalesce(po.body, '') ilike public.search_like(q)
             )
           order by po.created_at desc, po.id desc
           limit n
        ) x
    ),

    -- Moments: the same test visible_moments applies, so a Moment you cannot
    -- see is not searchable either.
    'moments', (
      select coalesce(jsonb_agg(x.item), '[]'::jsonb)
        from (
          select jsonb_build_object(
                   'id', m.id,
                   'kind', m.kind,
                   'body', m.body,
                   'mediaUrl', m.media_url,
                   'createdAt', m.created_at,
                   'author', public.public_profile(me, m.user_id, false)
                 ) as item
            from moments m
           where m.expires_at > public.now_ms()
             and public.can_view_moment(m, me)
             and (
                  to_tsvector('simple', coalesce(m.body, '')) @@ tsq
               or coalesce(m.body, '') ilike public.search_like(q)
             )
           order by m.created_at desc, m.id desc
           limit n
        ) x
    )
  );
end $$;

create or replace function public.can_manage_media(p_path text, p_url text default null::text)
returns boolean
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  me bigint := public.me_id();
  v_kind text := split_part(ltrim(coalesce(p_path, ''), '/'), '/', 1);
  v_folder text := split_part(ltrim(coalesce(p_path, ''), '/'), '/', 2);
begin
  if me is null or p_path is null or p_path = '' then return false; end if;

  -- Paths are minted server-side as `kind/<profile id>/…`. You may only ever
  -- touch your own folder, checked before anything else — otherwise passing
  -- your own path alongside somebody else's file URL would be enough to
  -- delete their photo.
  if v_kind not in ('photos', 'moments', 'messages', 'posts', 'circles') or v_folder <> me::text then
    return false;
  end if;

  -- The same guard on the URL form: both arguments must describe the same file
  -- in your own folder. Without this, your own path paired with somebody else's
  -- file URL would slip past the folder check above.
  if p_url is not null
     and public.media_object_path(p_url) <> p_path then
    return false;
  end if;

  -- Still referenced? Then only the owner of that row may remove it.
  if v_kind = 'photos' and exists (
    select 1 from photos where public.media_object_path(url) = p_path or (p_url is not null and url = p_url)
  ) then
    return exists (
      select 1 from photos where user_id = me
        and (public.media_object_path(url) = p_path or (p_url is not null and url = p_url))
    );
  end if;

  if v_kind = 'moments' and exists (
    select 1 from moments where public.media_object_path(media_url) = p_path or (p_url is not null and media_url = p_url)
  ) then
    return exists (
      select 1 from moments where user_id = me
        and (public.media_object_path(media_url) = p_path or (p_url is not null and media_url = p_url))
    );
  end if;

  if v_kind = 'messages' and exists (
    select 1 from messages where public.media_object_path(media_url) = p_path or (p_url is not null and media_url = p_url)
  ) then
    return exists (
      select 1 from messages where sender_id = me
        and (public.media_object_path(media_url) = p_path or (p_url is not null and media_url = p_url))
    );
  end if;

  if v_kind = 'posts' and exists (
    select 1 from posts where public.media_object_path(media_url) = p_path or (p_url is not null and media_url = p_url)
  ) then
    return exists (
      select 1 from posts where author_id = me
        and (public.media_object_path(media_url) = p_path or (p_url is not null and media_url = p_url))
    );
  end if;

  if v_kind = 'circles' then
    if exists (
      select 1 from circle_messages where public.media_object_path(media_url) = p_path or (p_url is not null and media_url = p_url)
    ) then
      return exists (
        select 1 from circle_messages where sender_id = me
          and (public.media_object_path(media_url) = p_path or (p_url is not null and media_url = p_url))
      );
    end if;
    -- The cover of a room you started, and nothing else.
    if exists (
      select 1 from circles where public.media_object_path(cover_url) = p_path or (p_url is not null and cover_url = p_url)
    ) then
      return exists (
        select 1 from circles where owner_id = me
          and (public.media_object_path(cover_url) = p_path or (p_url is not null and cover_url = p_url))
      );
    end if;
  end if;

  -- Nothing references it any more and it sits in your own folder: an orphan
  -- (a photo replaced before it was saved, say) you are allowed to clear.
  return true;
end $function$;

create or replace function public.can_view_media(p_path text, p_url text default null::text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  me bigint := public.me_id();
  v_kind text := split_part(ltrim(coalesce(p_path, ''), '/'), '/', 1);
  m public.moments;
  msg public.messages;
  post public.posts;
begin
  if me is null or p_path is null or p_path = ''
     or (p_url is not null and public.media_object_path(p_url) <> p_path) then
    return jsonb_build_object('allowed', false, 'cacheable', false);
  end if;

  if v_kind in ('photos', 'seed') then
    return jsonb_build_object('allowed', exists (
      select 1 from photos ph join profiles pf on pf.id = ph.user_id
        join privacy pr on pr.user_id = pf.id
       where public.media_object_path(ph.url) = p_path
         and (v_kind = 'seed' or split_part(p_path, '/', 2) = ph.user_id::text)
         and (ph.user_id = me or (
           pf.onboarded and pf.status = 'active'
           and not public.is_blocked_pair(me, ph.user_id)
           and (pr.profile_visibility = 'everyone' or public.is_connected_pair(me, ph.user_id))
           and (not pr.incognito or public.is_connected_pair(me, ph.user_id))
         ))
    ), 'cacheable', false);
  end if;

  if v_kind = 'moments' then
    select * into m from moments mo where public.media_object_path(mo.media_url) = p_path
      and split_part(p_path, '/', 2) = mo.user_id::text limit 1;
    if not found and p_url is not null then
      select * into m from moments mo where mo.media_url = p_url
        and split_part(p_path, '/', 2) = mo.user_id::text limit 1;
    end if;
    if not found then
      return jsonb_build_object('allowed', false, 'cacheable', false);
    end if;
    if m.expires_at <= public.now_ms() then
      return jsonb_build_object('allowed', false, 'cacheable', false);
    end if;
    if not public.can_view_moment(m, me) then
      return jsonb_build_object('allowed', false, 'cacheable', false);
    end if;
    return jsonb_build_object('allowed', true, 'cacheable', false);
  end if;

  if v_kind = 'messages' then
    select ms.* into msg from messages ms
      join conversations c on c.id = ms.conversation_id
      where public.media_object_path(ms.media_url) = p_path and (c.user_a = me or c.user_b = me)
        and split_part(p_path, '/', 2) = ms.sender_id::text
        and not public.is_blocked_pair(c.user_a, c.user_b)
      limit 1;
    if not found and p_url is not null then
      select ms.* into msg from messages ms
        join conversations c on c.id = ms.conversation_id
        where ms.media_url = p_url and (c.user_a = me or c.user_b = me)
          and split_part(p_path, '/', 2) = ms.sender_id::text
        and not public.is_blocked_pair(c.user_a, c.user_b)
        limit 1;
    end if;
    if not found then
      return jsonb_build_object('allowed', false, 'cacheable', false);
    end if;
    return jsonb_build_object('allowed', true, 'cacheable', false);
  end if;

  -- Media belongs to the original uploader's row, not an arbitrary row that
  -- copied its URL. Visibility is checked again on every request.
  if v_kind = 'posts' then
    select po.* into post from posts po
     where (public.media_object_path(po.media_url) = p_path or (p_url is not null and po.media_url = p_url))
       and split_part(p_path, '/', 2) = po.author_id::text
     limit 1;
    if not found then
      return jsonb_build_object('allowed', false, 'cacheable', false);
    end if;
    if not public.can_view_post(post, me) then
      return jsonb_build_object('allowed', false, 'cacheable', false);
    end if;
    return jsonb_build_object('allowed', true, 'cacheable', false);
  end if;

  -- Inside a Circle: the messages people sent, and the room's cover.
  if v_kind = 'circles' then
    if exists (
      select 1 from circle_messages m2
        join circle_members cm on cm.circle_id = m2.circle_id
       where cm.member_id = me
         and (public.media_object_path(m2.media_url) = p_path or (p_url is not null and m2.media_url = p_url))
         and split_part(p_path, '/', 2) = m2.sender_id::text
         and not public.is_blocked_pair(me, m2.sender_id)
    ) then
      return jsonb_build_object('allowed', true, 'cacheable', false);
    end if;
    if exists (
      select 1 from circles c
        join circle_members cm on cm.circle_id = c.id
       where cm.member_id = me
         and (public.media_object_path(c.cover_url) = p_path or (p_url is not null and c.cover_url = p_url))
         and split_part(p_path, '/', 2) = c.owner_id::text
    ) then
      return jsonb_build_object('allowed', true, 'cacheable', false);
    end if;
    return jsonb_build_object('allowed', false, 'cacheable', false);
  end if;

  return jsonb_build_object('allowed', false, 'cacheable', false);
end $function$;

/* ------------------------------------------------------------ dependents */

-- Redefined without Vibes. Everything else in both bodies is their previous
-- definition, character for character.

-- The functions that only existed to serve Vibes. Each is dropped from its exact
-- signature, including the older `create_vibe` overload, so nothing is left
-- behind that could still be granted or called.
drop function if exists public.vibes_feed(integer, bigint);
drop function if exists public.space_vibes(bigint, integer, bigint);
drop function if exists public.view_vibe(bigint);
drop function if exists public.delete_vibe(bigint);
drop function if exists public.react_to_vibe(bigint, boolean);
drop function if exists public.vibe_viewers(bigint);
drop function if exists public.cleanup_expired_vibes(integer);
drop function if exists public.create_vibe(text, text, text, text, integer);
drop function if exists public.create_vibe(text, text, text, text, integer, jsonb);
-- These two take a `vibes` row, so they must go before the table does.
drop function if exists public.can_view_vibe(public.vibes, bigint);
drop function if exists public.serialize_vibe(public.vibes, bigint);
drop function if exists public.vibe_lifetime_ms();

/* ---------------------------------------------------------------- tables */

-- Children first: both carry a foreign key to `vibes`.
drop table if exists public.vibe_reactions cascade;
drop table if exists public.vibe_views cascade;
drop table if exists public.vibes cascade;

/* --------------------------------------------------------------- outcome */

do $$
begin
  if exists (select 1 from information_schema.tables
              where table_schema = 'public' and table_name in ('vibes', 'vibe_views', 'vibe_reactions')) then
    raise exception 'a Vibes table survived the drop';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname ilike '%vibe%') then
    raise exception 'a Vibes function survived the drop';
  end if;
  -- The posts, Moments, Circles and sounds that were never Vibes are still here.
  perform 1 from public.posts;
  perform 1 from public.moments;
  perform 1 from public.circles;
end $$;
