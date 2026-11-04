-- Vibes were removed from the product. This checks the removal instead of
-- trusting it, and — just as important — that what shared a screen with them
-- still works.
--
-- The thing to be careful about is the difference between "no row mentions a
-- Vibe" and "the feature is gone". A table can be dropped while a plpgsql body
-- still names it: Postgres does not validate plpgsql at creation, so the
-- function is created happily and then fails the first time it runs. That is
-- how `can_view_media` broke every photo in the app the first time this was
-- attempted, so every remaining function is checked by its source, not by
-- whether it could be created.
do $$
declare
  leftover text;
begin
  /* ------------------------------------------------------------- tables */
  select string_agg(table_name, ', ') into leftover
    from information_schema.tables
   where table_schema = 'public'
     and table_name in ('vibes', 'vibe_views', 'vibe_reactions');
  if leftover is not null then
    raise exception 'Vibes tables survived the removal: %', leftover;
  end if;

  /* ---------------------------------------------------------- functions */
  select string_agg(p.proname, ', ' order by p.proname) into leftover
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname ilike '%vibe%';
  if leftover is not null then
    raise exception 'Vibes functions survived the removal: %', leftover;
  end if;

  -- The three that had to keep working, checked by source.
  select string_agg(fn, ', ') into leftover
    from (values ('public.can_view_media(text, text)'),
                 ('public.search_all(text, integer)'),
                 ('public.media_upload_ticket(text, text, integer)')) as t(fn)
   where pg_get_functiondef(t.fn::regprocedure) ilike '%vibe%';
  if leftover is not null then
    raise exception 'a surviving function still names Vibes: %', leftover;
  end if;

  /* ------------------------------------------- what must still be here */
  -- Not Vibes, and not colliding with them either.
  perform 1 from public.posts;
  perform 1 from public.moments;
  perform 1 from public.circles;
  perform 1 from public.sounds;
end $$;
