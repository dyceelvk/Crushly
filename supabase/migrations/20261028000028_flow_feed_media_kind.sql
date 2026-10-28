-- The Flow feed was missing `mediaKind` and `edit`, so a clip posted to the
-- Feed arrived as a still image with its words missing — the post showed its
-- caption and nothing else. This teaches `flow_feed` to say whether the media
-- is a photo or a clip, and to pass the edit recipe through, matching what
-- `circle_feed` and `load_post` already return.

create or replace function public.flow_feed(p_limit integer default 20, p_after bigint default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  items jsonb := '[]'::jsonb;
  r record;
  post public.posts;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  for r in
    select po.* from posts po
     where (p_after is null or po.created_at < (select p2.created_at from posts p2 where p2.id = p_after)
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
            when r.media_url ~ '\\.(mp4|webm|mov|m4v)(\\?|$)' then 'video'
            else 'photo'
          end,
          'edit', r.edit,
          'audience', r.audience,
          'circleId', r.circle_id,
          'createdAt', r.created_at,
          'author', public.public_profile(me, r.author_id, false),
          'mine', r.author_id = me
        )
      );
    end if;
  end loop;

  return jsonb_build_object('items', items);
end $$;

revoke all on function public.flow_feed(integer, bigint) from public, anon, authenticated;
grant execute on function public.flow_feed(integer, bigint) to authenticated, service_role;
