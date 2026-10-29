-- Read a single post by id, with the same audience and block rules as the Feed.
--
-- Posts are otherwise only reachable through the paginated flow/circle feeds,
-- so opening a post directly (or refreshing after the feed page moved past it)
-- had no way to load it: the post view rendered empty instead.
create or replace function public.load_post(p_post_id bigint)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  po public.posts;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  select * into po from posts p where p.id = p_post_id;
  if not found or not public.can_view_post(po, me) then
    perform public.crushly_fail(404, '', 'That post isn’t available.');
  end if;

  return (
    select jsonb_build_object(
      'id', po.id,
      'body', po.body,
      'mediaUrl', po.media_url,
      'mediaKind', case
        when po.media_url is null then null
        when po.media_url ~ '\.(mp4|webm|mov|m4v)(\?|$)' then 'video'
        else 'photo'
      end,
      'edit', po.edit,
      'audience', po.audience,
      'circleId', po.circle_id,
      'createdAt', po.created_at,
      'author', public.public_profile(me, po.author_id, false),
      'mine', po.author_id = me
    ) || public.post_engagement(po.id, me)
  );
end $$;

revoke all on function public.load_post(bigint) from public, anon, authenticated;
grant execute on function public.load_post(bigint) to authenticated, service_role;
