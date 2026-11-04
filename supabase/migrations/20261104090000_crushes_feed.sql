-- crush_posts_feed: the posts Crushes shows.
--
-- (Named this way, not `crushes_feed`: that name is already the people side of
-- Crushes, `crushes_feed()` with no arguments, and adding a second function of
-- the same name with defaults made every call to the first one ambiguous —
-- "function public.crushes_feed() is not unique". The suite caught it before
-- anyone's Space did.)
--
-- Crushes is a post feed, not a directory of people. It carries the posts of
-- the people you have a Crush with — you on them, them on you, or both — and it
-- carries what a feed on this surface should: pictures and words. Clips are
-- Flow's (see flow_ranked_feed); a clip on the Crushes page would make the two
-- surfaces the same page with two names.
--
-- Every rule the other feeds apply still applies, because this reads through the
-- same door: can_view_post() decides who may see a post at all (audience,
-- blocks, Circles), and post_engagement() supplies `saved`, `liked` and the
-- counts so Pick and Crush work here exactly as they do on Flow.
--
-- Paging is keyset (created_at, id), the same shape flow_feed uses, so a post
-- arriving while someone scrolls cannot make them see a row twice.

create or replace function public.crush_posts_feed(p_limit integer default 20, p_after bigint default null::bigint)
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
  after_created bigint;
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
       -- A Crush in either direction, and never yourself: your own posts are
       -- what your Space is.
       and po.author_id <> me
       and exists (
         select 1 from crushes c
          where (c.from_id = me and c.to_id = po.author_id)
             or (c.to_id = me and c.from_id = po.author_id)
       )
       and (
         p_after is null
         or po.created_at < after_created
         or (po.created_at = after_created and po.id < p_after)
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
          'circleId', r.circle_id,
          'createdAt', r.created_at,
          'author', public.public_profile(me, r.author_id, false),
          'mine', false
        ) || public.post_engagement(r.id, me)
      );
    end if;
  end loop;

  return jsonb_build_object('items', items);
end $function$;

grant execute on function public.crush_posts_feed(integer, bigint) to authenticated, service_role;

-- Belt and braces: if this migration is replayed over a database that ran the
-- earlier draft, the ambiguous overload goes.
drop function if exists public.crushes_feed(integer, bigint);

-- Picked is saved content, not a public shelf: the picks_of() draft that made
-- someone's Picks readable from their Space is gone, and this removes it from a
-- database that ran it.
drop function if exists public.picks_of(bigint, integer, bigint);
