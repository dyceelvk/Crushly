-- Who liked this post.
--
-- The comment sheet shows two tabs over a post — the comments, and the people
-- who reacted to it — and only the first had a query behind it. Counting
-- reactions was possible (`post_engagement` returns the number); naming them
-- was not, so the reference surface could only be copied with a dead tab.
--
-- Visibility follows the post: you get the list only if you can see the post at
-- all, which `can_view_post` already decides for comments, saves and reactions.

create or replace function public.post_likers(p_post_id bigint, p_limit integer default 40)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  me    bigint := public.me_id();
  post  public.posts;
  n     integer := least(greatest(coalesce(p_limit, 40), 1), 100);
  items jsonb := '[]'::jsonb;
  r     record;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  select * into post from posts where id = p_post_id;
  if not found or not public.can_view_post(post, me) then
    perform public.crushly_fail(404, 'not_found', 'That post is no longer available.');
  end if;

  for r in
    select pr.user_id, pr.kind, pr.created_at
      from post_reactions pr
     where pr.post_id = p_post_id
     order by pr.created_at desc
     limit n
  loop
    items := items || jsonb_build_array(
      jsonb_build_object(
        'kind', r.kind,
        'createdAt', r.created_at,
        'author', public.public_profile(me, r.user_id, false)
      )
    );
  end loop;

  return jsonb_build_object('items', items);
end $function$;

revoke all on function public.post_likers(bigint, integer) from public, anon, authenticated;
grant execute on function public.post_likers(bigint, integer) to authenticated, service_role;
