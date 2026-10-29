-- A post inside a Circle had no like count and no comment count.
--
-- `circle_feed` was written by hand-building the post JSON and it was the one
-- post-returning function that never merged `post_engagement` into the row.
-- Every other one does: `flow_feed`, `public_flow`, `space_posts`, `load_post`,
-- and now `saved_posts`. So in a Circle the counts came back undefined — not
-- zero, absent — and the card rendered an empty space where "12 likes · 3
-- comments" goes. The Feed was right, the Circle was wrong, about the same post.
--
-- Re-declaring the function with the merge is the whole fix. Nothing else in
-- it changes: the audience check, the pagination and the block filtering are
-- copied over unchanged so this migration cannot quietly alter who sees what.

create or replace function public.circle_feed(
  p_circle_id bigint, p_limit integer default 20, p_after bigint default null
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

revoke all on function public.circle_feed(bigint, integer, bigint) from public, anon, authenticated;
grant execute on function public.circle_feed(bigint, integer, bigint) to authenticated, service_role;
