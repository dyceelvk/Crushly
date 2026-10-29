-- Two things the app has been asking for and the database could not answer.
--
-- 1. A SPACE NEEDS ITS OWN POSTS.
--    A Space is a person. It showed their photos, their words, their
--    lifestyle, and nothing they had ever actually shared. The Flow is
--    viewer-relative — it is built out of people you are connected to — so
--    there was no way to ask for one member's posts. `space_posts` asks that
--    question directly, and answers it with exactly the posts that member
--    could see, because it leans on the same `can_view_post` test every other
--    feed uses. A private Space, a paused Space, a block, a Circle post: all
--    still hold.
--
-- 2. THE RING NEEDS A FACT, NOT A GUESS.
--    The blue ring around a profile photo means "this person has a Moment
--    right now". Every screen that wanted to draw it had to fetch the moments
--    themselves to find out. `load_profile` already returns a `moments` array,
--    but an array is the wrong shape for a yes/no question — it is capped at
--    six, it carries media URLs nobody asked for, and on a list it is six
--    rows of work per person. `hasMoment` is that boolean, computed once,
--    next to the profile it describes.
--
-- Also restores `flow_feed` to the sum of its migrations. The version on disk
-- lost the `circle_id is null` guard that `20261010000019_public_flow.sql` put
-- there, so replaying the migrations in order would have started leaking
-- Circle posts into the public Flow. The live database was corrected by hand;
-- this is the correction, in the file, where it belongs.

/* ------------------------------------------------------------------ indexes */

-- Moments are read one member at a time from here on (every Space, every
-- avatar that draws a ring). `moments_expires_idx` answers "what is live
-- everywhere"; this one answers "what is live for this person".
create index if not exists moments_user_created_idx
  on public.moments (user_id, created_at desc);

-- Same shape for the two space feeds: one author, newest first, and the
-- keyset cursor reads created_at and id together.
create index if not exists posts_author_created_idx
  on public.posts (author_id, created_at desc, id desc);

create index if not exists vibes_author_created_idx
  on public.vibes (author_id, created_at desc, id desc);

/* -------------------------------------------------------------- flow_feed */

create or replace function public.flow_feed(p_limit integer default 20, p_after bigint default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
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
       -- A post written into a Circle belongs to that room. The Flow is not
       -- the room. Without this the whole private side of the app leaks.
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
end $$;

revoke all on function public.flow_feed(integer, bigint) from public, anon, authenticated;
grant execute on function public.flow_feed(integer, bigint) to authenticated, service_role;

/* -------------------------------------------------------------- space_posts */

-- One member's posts, newest first.
--
-- Fan-out cannot help here: a feed of everybody is the wrong tool for a feed
-- of one person. This walks the author's own posts and keeps the ones the
-- viewer is allowed to see, which is the same rule the Flow applies — so a
-- post hidden from the Flow is hidden from the Space too, and the two feeds
-- can never disagree about who may see what.
create or replace function public.space_posts(
  p_author_id bigint,
  p_limit integer default 20,
  p_after bigint default null
)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
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
     where po.author_id = p_author_id
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
end $$;

revoke all on function public.space_posts(bigint, integer, bigint) from public, anon, authenticated;
grant execute on function public.space_posts(bigint, integer, bigint) to authenticated, service_role;

/* ------------------------------------------------------------- space_vibes */

-- One member's Vibes, same shape and same reasoning. `can_view_vibe` already
-- knows about expiry, audience, blocks and a private profile.
create or replace function public.space_vibes(
  p_author_id bigint,
  p_limit integer default 30,
  p_after bigint default null
)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me    bigint := public.me_id();
  items jsonb := '[]'::jsonb;
  r     record;
  vibe  public.vibes;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  for r in
    select v.* from vibes v
     where v.author_id = p_author_id
       and v.expires_at > public.now_ms()
       and (p_after is null or v.created_at < (select v2.created_at from vibes v2 where v2.id = p_after)
                             or (v.created_at = (select v2.created_at from vibes v2 where v2.id = p_after) and v.id < p_after))
     order by v.created_at desc, v.id desc
     limit least(greatest(coalesce(p_limit, 30), 1), 60)
  loop
    select * into vibe from vibes where id = r.id;
    if public.can_view_vibe(vibe, me) then
      items := items || jsonb_build_array(public.serialize_vibe(vibe, me));
    end if;
  end loop;

  return jsonb_build_object('items', items);
end $$;

revoke all on function public.space_vibes(bigint, integer, bigint) from public, anon, authenticated;
grant execute on function public.space_vibes(bigint, integer, bigint) to authenticated, service_role;

/* -------------------------------------------------------------- load_profile */

-- `hasMoment` is the ring. `moments` stays as it was so nothing that already
-- reads it breaks; the boolean is what a 120px avatar can actually use.
create or replace function public.load_profile(p_target_id bigint)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me      bigint := public.me_id();
  profile jsonb;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  profile := public.load_visible_profile(me, p_target_id, true);
  if profile is null then
    return null;
  end if;
  return profile || jsonb_build_object(
    'moments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'kind', t.kind, 'body', t.body, 'mediaUrl', t.media_url,
        'style', t.style, 'createdAt', t.created_at
      ) order by t.id desc)
        from (
          select id, kind, body, media_url, style, created_at
            from moments
           where user_id = p_target_id and expires_at > public.now_ms()
             and (audience = 'everyone' or public.is_connected_pair(me, p_target_id))
           order by id desc limit 6
        ) t
    ), '[]'::jsonb),
    -- Judged one row at a time by the same rule the viewer used, so the ring
    -- cannot say "Moment" about a Moment the viewer is not allowed to open.
    'hasMoment', exists (
      select 1 from moments m
       where m.user_id = p_target_id
         and m.expires_at > public.now_ms()
         and public.can_view_moment(m, me)
    )
  );
end $$;

revoke all on function public.load_profile(bigint) from public, anon, authenticated;
grant execute on function public.load_profile(bigint) to authenticated, service_role;
