-- Whisper reactions take the seven, and every paged feed reports where it ends.
--
-- Two things, both of them bugs a member could see.
--
-- 1. A Whisper's reactions were capped at four kinds in the database. The app
--    started offering seven, so sad, angry and tired failed on a Whisper while
--    working on a post. The constraint is the only thing that refused them.
--
-- 2. `flow_feed`, `public_flow_feed`, `circle_feed` and `saved_posts` returned
--    `items` and nothing else. The client paged by "after this id" and had no way
--    to know whether one existed, so the four hooks in the app were written as a
--    plain query keyed on that id — which *replaces* the page instead of
--    extending it. Scrolling Home, a Circle or Picked therefore swapped the whole
--    list for the next page and looked exactly like everything vanishing. The
--    cursor is what lets the client append, so the cursor is what these return
--    now: the same shape `crush_posts_feed` and `space_posts` already had.

alter table public.message_reactions drop constraint if exists message_reactions_kind_check;
alter table public.message_reactions add constraint message_reactions_kind_check
  check (kind in ('crush', 'laugh', 'wow', 'fire', 'sad', 'angry', 'tired', 'clap'));

/* ------------------------------------------------------------- flow_feed */

create or replace function public.flow_feed(p_limit integer default 20, p_after bigint default null::bigint)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  me      bigint := public.me_id();
  lim     integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  items   jsonb := '[]'::jsonb;
  r       record;
  post    public.posts;
  last_id bigint;
  taken   integer := 0;
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
     limit lim
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
      last_id := r.id;
      taken := taken + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'items', items,
    'nextCursor', case when taken >= lim then last_id else null end
  );
end $function$;

/* ------------------------------------------------------ public_flow_feed */

create or replace function public.public_flow_feed(p_limit integer default 20, p_after bigint default null::bigint)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  me      bigint := public.me_id();
  lim     integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  items   jsonb := '[]'::jsonb;
  r       record;
  post    public.posts;
  last_id bigint;
  taken   integer := 0;
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
     limit lim
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
      last_id := r.id;
      taken := taken + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'items', items,
    'nextCursor', case when taken >= lim then last_id else null end
  );
end $function$;

/* ------------------------------------------------------------ circle_feed */

create or replace function public.circle_feed(p_circle_id bigint, p_limit integer default 20, p_after bigint default null::bigint)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  me      bigint := public.me_id();
  lim     integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  items   jsonb := '[]'::jsonb;
  r       record;
  post    public.posts;
  last_id bigint;
  taken   integer := 0;
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
     limit lim
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
      last_id := r.id;
      taken := taken + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'items', items,
    'nextCursor', case when taken >= lim then last_id else null end
  );
end $function$;

/* ------------------------------------------------------------ saved_posts */

create or replace function public.saved_posts(p_limit integer default 20, p_after bigint default null::bigint)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  me      bigint := public.me_id();
  lim     integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  items   jsonb := '[]'::jsonb;
  r       record;
  post    public.posts;
  last_id bigint;
  taken   integer := 0;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  -- Cursor is the save's own timestamp, not the post's: you want the things you
  -- kept most recently, whatever order they were posted in.
  for r in
    select po.* from post_saves s
      join posts po on po.id = s.post_id
     where s.user_id = me
       and (p_after is null
            or s.created_at < (select s2.created_at from post_saves s2
                                where s2.user_id = me and s2.post_id = p_after)
            or (s.created_at = (select s2.created_at from post_saves s2
                                 where s2.user_id = me and s2.post_id = p_after)
                and po.id < p_after))
     order by s.created_at desc, po.id desc
     limit lim
  loop
    select * into post from posts where id = r.id;
    if found and public.can_view_post(post, me) then
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
        ) || public.post_engagement(r.id, me) || jsonb_build_object('saved', true)
      );
      last_id := r.id;
      taken := taken + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'items', items,
    'nextCursor', case when taken >= lim then last_id else null end
  );
end $function$;

notify pgrst, 'reload schema';
