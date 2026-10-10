-- Search: members, and what they have shared.
--
-- The rule is the whole design: search finds you nothing you could not already
-- have reached by scrolling. Every result is put through the same test the feed
-- puts it through, so the search box is never a way round an audience choice,
-- a block, or a profile somebody has made private. A Flow post written for one
-- Circle does not appear here; a Vibe you were never shown is not indexed for
-- you; a member who has hidden himself from Discover is not findable by name.
--
-- Two ways of matching, because they answer different needs:
--
--   * Postgres full-text search (to_tsvector @@ websearch_to_tsquery) for
--     words — it understands word boundaries, several words, quoted phrases
--     and "or", and it is what the indexes below are built for.
--   * A plain substring match for the half-typed word, so results appear while
--     somebody is still typing "ali" on the way to "Alice".
--
-- Like patterns are escaped, because a member searching for "100%" should find
-- that text, not every post in the app.

-- Escapes a user's search text for use inside ILIKE: % and _ stop being
-- wildcards, and the escape character itself is escaped first.
create or replace function public.search_like(p_query text)
returns text
language sql immutable as $$
  select '%' || replace(replace(replace(coalesce(p_query, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
$$;

-- Word indexes for the three kinds of sharing. Expression indexes, so they
-- only ever serve the exact expression the search uses.
create index if not exists posts_body_fts_idx on public.posts using gin (to_tsvector('simple', body));
create index if not exists vibes_body_fts_idx on public.vibes using gin (to_tsvector('simple', body));
create index if not exists moments_body_fts_idx on public.moments using gin (to_tsvector('simple', body));
create index if not exists profiles_fts_idx on public.profiles
  using gin (to_tsvector('simple', name || ' ' || username || ' ' || city));

-- One call, four lists: members, Flows, Vibes, Moments. Returns at most
-- `p_limit` of each (1–20), newest first for content.
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
      'vibes', '[]'::jsonb,
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

    -- Vibes: only the ones still inside their fortnight, and only where the
    -- audience already let you watch.
    'vibes', (
      select coalesce(jsonb_agg(x.item), '[]'::jsonb)
        from (
          select jsonb_build_object(
                   'id', v.id,
                   'body', v.body,
                   'mediaUrl', v.media_url,
                   'coverUrl', v.cover_url,
                   'durationMs', v.duration_ms,
                   'createdAt', v.created_at,
                   'expiresAt', v.expires_at,
                   'author', public.public_profile(me, v.author_id, false)
                 ) as item
            from vibes v
           where v.expires_at > public.now_ms()
             and public.can_view_vibe(v, me)
             and (
                  to_tsvector('simple', coalesce(v.body, '')) @@ tsq
               or coalesce(v.body, '') ilike public.search_like(q)
             )
           order by v.created_at desc, v.id desc
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

revoke all on function public.search_like(text) from public, anon, authenticated;
grant execute on function public.search_like(text) to authenticated, service_role;
revoke all on function public.search_all(text, int) from public, anon, authenticated;
grant execute on function public.search_all(text, int) to authenticated, service_role;
