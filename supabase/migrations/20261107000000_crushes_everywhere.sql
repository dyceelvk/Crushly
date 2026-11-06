-- Crushes reads the posts table, not your Add up list.
--
-- The report: "users publish posts inside their Spaces; the posts appear on
-- their profiles but not on the Crushes page." The posts were never the
-- problem — they were in `posts` the whole time, and `space_posts` returned
-- them. `crush_posts_feed` returned them too, but only when a row existed in
-- `crushes` between the reader and the author:
--
--     and exists (select 1 from crushes c
--                  where (c.from_id = me and c.to_id = po.author_id)
--                     or (c.to_id = me and c.from_id = po.author_id))
--
-- So Crushes was a list of who you had added up with, rendered as posts. A
-- member with no Add ups — which is every member on their first day — saw an
-- empty page over a full table, and a member who added up with one person saw
-- one person's posts and reasonably concluded their own feed was broken.
--
-- Crushes is the discovery surface. What decides whether a post belongs here is
-- whether the reader may see it at all, and that question already has exactly
-- one answer in this database: can_view_post(). It applies the audience
-- ('everyone' vs 'connections'), the author's own visibility and incognito
-- settings, blocks in either direction, and Circle membership. Reading through
-- it means Crushes cannot drift from the rules the rest of the product enforces
-- — and it means a private post cannot become public by being in a feed query.
--
-- Three things are deliberately unchanged:
--
--   * A Circle post stays in its room. Circles are places with a door;
--     `circle_id is null` keeps them out of a feed that everyone reads.
--   * The post is the same row the Space returns — same id, same author, same
--     media, same counts through post_engagement(). There is no Crushes copy of
--     anything, so a post cannot appear twice or drift out of date.
--   * Paging is keyset on (created_at, id) and hands back a cursor.
--
-- One thing changes with the division of labour: a clip is a post. It used to
-- be filtered out here ("a clip belongs to Flow"), which meant a member who
-- posted a clip saw it on their Space and never on Crushes. Flow still ranks
-- clips for the surface built for them; Crushes does not pretend they do not
-- exist.

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
       -- A room is a room, not a square.
       and po.circle_id is null
       and (
         p_after is null
         or po.created_at < after_created
         or (po.created_at = after_created and po.id < p_after)
       )
     order by po.created_at desc, po.id desc
     limit lim
  loop
    -- Judged before the page was cut, and judged again here: a row that stopped
    -- being visible between the two reads is dropped rather than handed out.
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

  -- A full page might have more behind it; a short page is the end.
  return jsonb_build_object(
    'items', items,
    'nextCursor', case when taken >= lim then last_id else null end
  );
end $function$;

revoke all on function public.crush_posts_feed(integer, bigint) from public, anon, authenticated;
grant execute on function public.crush_posts_feed(integer, bigint) to authenticated, service_role;
