/*
 * Top Crushes This Week — the clips rail Discover needed.
 *
 * Video is back, and a rail of the week's most-Crushed clips is the first thing
 * that makes its return visible: nine-by-sixteen tiles that open the post, with
 * a real number under each one.
 *
 * Ranking is deliberately boring and legible:
 *
 *   1. clips from the last seven days first, then older ones if the week is
 *      quiet — a rail that empties itself on a Monday is worse than one that
 *      reaches back a little;
 *   2. within a window, Crushes count, with a comment worth three of them and a
 *      recent clip beating an older one at the same score;
 *   3. one clip per author, so a single person cannot own the whole rail.
 *
 * Everything goes through `can_view_post` and `post_engagement`, so the rail can
 * only ever show what this member is allowed to see, counted the same way the
 * feed counts it. A Circle's clips never appear: the rail is public surface.
 */
create or replace function public.trending_clips(p_limit integer default 12)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  me     bigint := public.me_id();
  cap    int := least(greatest(coalesce(p_limit, 12), 1), 24);
  items  jsonb := '[]'::jsonb;
  r      record;
  post   public.posts;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  for r in
    with clip as (
      select po.*,
             case
               when po.media_url ~ '\.(mp4|webm|mov|m4v)(\?|$)' then 'video'
               else 'photo'
             end as media_kind,
             coalesce((select count(*) from post_reactions re where re.post_id = po.id), 0) as crushes,
             coalesce((select count(*) from post_comments pc where pc.post_id = po.id), 0) as comments,
             row_number() over (partition by po.author_id
                                order by po.created_at desc) as per_author
        from posts po
       where po.media_url is not null
         and po.circle_id is null
         and po.audience = 'everyone'
    )
    select c.* from clip c
     where c.media_kind = 'video'
       and c.per_author = 1
       and public.can_view_post(c, me)
     order by
       (c.created_at > public.now_ms() - 7 * 86400000) desc,
       (c.crushes + 3 * c.comments) desc,
       c.created_at desc,
       c.id desc
     limit cap
  loop
    select * into post from posts where id = r.id;
    if public.can_view_post(post, me) then
      items := items || jsonb_build_array(
        jsonb_build_object(
          'id', r.id,
          'body', r.body,
          'mediaUrl', r.media_url,
          'mediaKind', 'video',
          'edit', r.edit,
          'audience', r.audience,
          'createdAt', r.created_at,
          'author', public.public_profile(me, r.author_id, false),
          'mine', r.author_id = me
        ) || public.post_engagement(r.id, me)
      );
    end if;
  end loop;

  return items;
end $function$;

grant execute on function public.trending_clips(integer) to authenticated, service_role;
