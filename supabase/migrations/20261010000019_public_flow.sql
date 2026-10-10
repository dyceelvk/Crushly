-- Discover: what people chose to share with everybody.
--
-- Crushly is a social app, not a catalogue of faces, so the place you go to
-- find something new shows you what people have *said*, not rows of profile
-- photographs to sort through. This is the feed behind that: posts whose
-- author set them to Everyone, newest first.
--
-- Nothing here is a way round a rule. Only posts already published to
-- Everyone qualify; a post written for one member's Connections, or for a
-- Circle, is not public and does not appear. Everything is then put through
-- the same can_view_post test the Home feed uses, so a block, a paused Space
-- or a private profile still keeps a post out of here. Your own posts are
-- left out too — you already have a Home feed for those.

create or replace function public.public_flow_feed(p_limit integer default 20, p_after bigint default null)
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
     where po.audience = 'everyone'
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
     limit least(greatest(coalesce(p_limit, 20), 1), 50)
  loop
    -- The loop variable is a record, and a record will not cast itself to a
    -- row type — so the row is fetched again into one before it is judged.
    select * into post from posts where id = r.id;
    if public.can_view_post(post, me) then
      items := items || jsonb_build_array(
        jsonb_build_object(
          'id', r.id,
          'body', r.body,
          'mediaUrl', r.media_url,
          'audience', r.audience,
          'circleId', null,
          'createdAt', r.created_at,
          'author', public.public_profile(me, r.author_id, false),
          'mine', false
        )
      );
    end if;
  end loop;

  return jsonb_build_object('items', items);
end $$;

revoke all on function public.public_flow_feed(integer, bigint) from public, anon, authenticated;
grant execute on function public.public_flow_feed(integer, bigint) to authenticated, service_role;
