-- Liking a comment, which the product could show but never set.
--
-- `post_comment_likes` has existed since the comment work landed, and
-- `post_comments_feed` already counts it and reports whether you are one of the
-- likers — but nothing has ever written to the table. The count was therefore
-- always zero and the heart was decoration. This adds the missing write path,
-- with the same audience and block rules as the comment it belongs to.
--
-- The comment's own RLS already decides whether you may see it; this function
-- only decides whether you may say you liked it, and refuses when you could not
-- have read it in the first place.

create or replace function public.like_post_comment(p_comment_id bigint, p_liked boolean default true)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me  bigint := public.me_id();
  c   public.post_comments;
  po  public.posts;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  select * into c from post_comments pc where pc.id = p_comment_id;
  if not found or c.hidden then
    perform public.crushly_fail(404, '', 'That comment isn’t there.');
  end if;

  select * into po from posts p where p.id = c.post_id;
  -- You cannot like a comment on a post you cannot read, and a block silences
  -- both ways here exactly as it does everywhere else.
  if not found or not public.can_view_post(po, me) or public.is_blocked_pair(me, c.author_id) then
    perform public.crushly_fail(404, '', 'That comment isn’t there.');
  end if;

  if coalesce(p_liked, true) then
    insert into post_comment_likes (comment_id, user_id) values (c.id, me)
    on conflict do nothing;
  else
    delete from post_comment_likes l where l.comment_id = c.id and l.user_id = me;
  end if;

  return jsonb_build_object(
    'liked', coalesce(p_liked, true),
    'likeCount', (select count(*) from post_comment_likes l where l.comment_id = c.id)
  );
end $$;

revoke all on function public.like_post_comment(bigint, boolean) from public, anon, authenticated;
grant execute on function public.like_post_comment(bigint, boolean) to authenticated, service_role;

notify pgrst, 'reload schema';
