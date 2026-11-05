-- Your own post is a post, and a page is not the whole feed.
--
-- Three things people asked for, and none of them is a new idea — each is a
-- place where the product was stricter than it needed to be:
--
--   1. You can Crush your own post. The rule that stopped it ("You can't like
--      your own post") was there to keep a like meaningful, but on this product
--      a Crush is how you keep a post — your own pictures belong in your own
--      Crushes the same way anyone else's do, and a post with no count looks
--      broken from the inside. The obvious guard stays: reacting to yourself
--      notifies nobody.
--
--   2. Crushes carries your own posts too. It used to say `author_id <> me`
--      with the reasoning that "your own posts are what your Space is", which
--      left a member looking at a feed from everyone except themselves. Now the
--      feed is: the people you share a Crush with, and you.
--
--   3. Both feeds hand back a cursor. `crush_posts_feed` and `space_posts`
--      returned `items` and nothing else, so the client could never ask for the
--      next page — Crushes held one page of 20 and a Space held one page of 20,
--      and scrolling past the end looked like the posts had been taken away.
--      The cursor is the id of the last row returned, null on a short page, so
--      a caller can page until it is null and stop.

-- ------------------------------------------------------- 1. Crushing your own

create or replace function public.react_to_post(
  p_post_id bigint,
  p_liked   boolean default true,
  p_kind    text    default 'crush'
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me    bigint := public.me_id();
  po    public.posts;
  had   boolean;
  clean text := lower(btrim(coalesce(p_kind, 'crush')));
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  select * into po from posts p where p.id = p_post_id;
  if not found or not public.can_view_post(po, me) then
    perform public.crushly_fail(404, '', 'That post isn’t available.');
  end if;

  if clean not in ('crush', 'fire', 'laugh', 'wow', 'clap') then
    clean := 'crush';
  end if;

  select exists (select 1 from post_reactions r where r.post_id = po.id and r.user_id = me) into had;

  if coalesce(p_liked, true) then
    insert into post_reactions (post_id, user_id, kind)
      values (po.id, me, clean)
    on conflict (post_id, user_id) do update set kind = excluded.kind;
    -- Only the first reaction is news, and never to yourself: a notification
    -- that says you liked your own picture is noise with your own name on it.
    if not had and po.author_id <> me then
      perform public.notify_to(po.author_id, 'post_reaction', me, po.id, '');
    end if;
  else
    delete from post_reactions r where r.post_id = po.id and r.user_id = me;
  end if;

  return jsonb_build_object(
    'liked', coalesce(p_liked, true),
    'myReaction', case when coalesce(p_liked, true) then clean else null end,
    'likeCount', (select count(*) from post_reactions r where r.post_id = po.id),
    'reactionKinds', coalesce((
      select jsonb_object_agg(s.kind, s.n)
        from (select r.kind, count(*) as n
                from post_reactions r
               where r.post_id = po.id
               group by r.kind) s
    ), '{}'::jsonb)
  );
end $$;

revoke all on function public.react_to_post(bigint, boolean, text) from public, anon, authenticated;
grant execute on function public.react_to_post(bigint, boolean, text) to authenticated, service_role;

-- ------------------------------------------- 2 & 3. Crushes, with you in it

create or replace function public.crush_posts_feed(p_limit integer default 20, p_after bigint default null::bigint)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  me        bigint := public.me_id();
  lim       integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  items     jsonb := '[]'::jsonb;
  r         record;
  post      public.posts;
  after_created bigint;
  last_id   bigint;
  taken     integer := 0;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  if p_after is not null then
    select p2.created_at into after_created from posts p2 where p2.id = p_after;
  end if;

  for r in
    select po.* from posts po
     where public.can_view_post(po, me)
       and po.circle_id is null
       -- A clip belongs to Flow.
       and (po.media_url is null or po.media_url !~ '\.(mp4|webm|mov|m4v)(\?|$)')
       -- A Crush in either direction — or your own post. Crushes is what the
       -- people you are here for are sharing, and you are one of them.
       and (
         po.author_id = me
         or exists (
           select 1 from crushes c
            where (c.from_id = me and c.to_id = po.author_id)
               or (c.to_id = me and c.from_id = po.author_id)
         )
       )
       and (
         p_after is null
         or po.created_at < after_created
         or (po.created_at = after_created and po.id < p_after)
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

  -- A full page might have more behind it; a short page is the end. The client
  -- stops when this is null, so an empty feed costs one request, not two.
  return jsonb_build_object(
    'items', items,
    'nextCursor', case when taken >= lim then last_id else null end
  );
end $function$;

grant execute on function public.crush_posts_feed(integer, bigint) to authenticated, service_role;

-- --------------------------------------------------- a Space pages too

create or replace function public.space_posts(p_author_id bigint, p_limit integer default 20, p_after bigint default null::bigint)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  me        bigint := public.me_id();
  lim       integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  items     jsonb := '[]'::jsonb;
  r         record;
  post      public.posts;
  after_created bigint;
  last_id   bigint;
  taken     integer := 0;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  if p_after is not null then
    select p2.created_at into after_created from posts p2 where p2.id = p_after;
  end if;

  for r in
    select po.* from posts po
     where po.author_id = p_author_id
       -- Visibility belongs in the WHERE, not in a check after the LIMIT: a row
       -- dropped after the page was cut leaves the page short with no cursor,
       -- and the walk stops there for good.
       and public.can_view_post(po, me)
       and (
         p_after is null
         or po.created_at < after_created
         or (po.created_at = after_created and po.id < p_after)
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

grant execute on function public.space_posts(bigint, integer, bigint) to authenticated, service_role;
