/*
 * Top Crushes This Week — the function Discover actually calls.
 *
 * This replaces `20261105140000_trending_clips.sql`, which could not run. Two
 * mistakes, both found by running it against a real Postgres instead of reading
 * it:
 *
 *   · `can_view_post(c, me)` was handed the CTE's row — a record with four extra
 *     columns — where the function wants a `posts` row. Postgres plans a plpgsql
 *     body lazily, so the migration applied cleanly and the rail would have
 *     failed the first time a member opened Discover. Rank in SQL, check
 *     visibility per row.
 *
 *   · "one clip per author" was numbered over every post, so a member who posted
 *     a photograph an hour ago lost their clip to it. It is counted over clips.
 *
 * The ranking itself is unchanged and deliberately legible: the last seven days
 * first, then Crushes with a comment worth three, then newest, then id as a
 * tiebreak so two calls a millisecond apart agree.
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
      select po.id,
             po.author_id,
             po.created_at,
             coalesce((select count(*) from post_reactions re where re.post_id = po.id), 0) as crushes,
             coalesce((select count(*) from post_comments pc where pc.post_id = po.id), 0) as comments,
             row_number() over (partition by po.author_id
                                order by po.created_at desc, po.id desc) as per_author
        from posts po
       where po.media_url is not null
         and po.media_url ~ '\.(mp4|webm|mov|m4v)(\?|$)'
         and po.circle_id is null
         and po.audience = 'everyone'
    )
    select c.id from clip c
     where c.per_author = 1
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
          'id', post.id,
          'body', post.body,
          'mediaUrl', post.media_url,
          'mediaKind', 'video',
          'edit', post.edit,
          'audience', post.audience,
          'createdAt', post.created_at,
          'author', public.public_profile(me, post.author_id, false),
          'mine', post.author_id = me
        ) || public.post_engagement(post.id, me)
      );
    end if;
  end loop;

  return items;
end $function$;

grant execute on function public.trending_clips(integer) to authenticated, service_role;
