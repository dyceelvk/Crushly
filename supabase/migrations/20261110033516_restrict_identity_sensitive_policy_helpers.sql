-- Preserve session-bound RLS checks while preventing direct helper RPCs from
-- selecting another viewer or Circle member.
create or replace function public.holup_can_view_post_as_me(p_post public.posts)
returns boolean language sql stable security definer set search_path=public
as $$ select public.me_id() is not null and public.can_view_post(p_post, public.me_id()) $$;
revoke all on function public.holup_can_view_post_as_me(public.posts) from public, anon;
grant execute on function public.holup_can_view_post_as_me(public.posts) to authenticated;

create or replace function public.holup_circle_member_as_me(p_circle_id bigint)
returns boolean language sql stable security definer set search_path=public
as $$ select public.me_id() is not null and public.is_circle_member(p_circle_id, public.me_id()) $$;
revoke all on function public.holup_circle_member_as_me(bigint) from public, anon;
grant execute on function public.holup_circle_member_as_me(bigint) to authenticated;

alter policy post_reactions_select on public.post_reactions
  using (exists (select 1 from public.posts p where p.id=post_reactions.post_id and public.holup_can_view_post_as_me(p.*)));
alter policy post_comments_select on public.post_comments
  using (exists (select 1 from public.posts p where p.id=post_comments.post_id and public.holup_can_view_post_as_me(p.*)));
alter policy post_comments_insert on public.post_comments
  with check (author_id=public.me_id() and exists (select 1 from public.posts p where p.id=post_comments.post_id and public.holup_can_view_post_as_me(p.*)));
alter policy post_comment_likes_select on public.post_comment_likes
  using (exists (select 1 from public.post_comments c join public.posts p on p.id=c.post_id where c.id=post_comment_likes.comment_id and public.holup_can_view_post_as_me(p.*)));
alter policy circle_members_select_member on public.circle_members using (public.holup_circle_member_as_me(circle_id));
alter policy circle_messages_select_member on public.circle_messages using (public.holup_circle_member_as_me(circle_id));
alter policy circles_select_member on public.circles using (public.holup_circle_member_as_me(id));

revoke execute on function public.can_view_post(public.posts,bigint) from public, anon, authenticated;
revoke execute on function public.is_circle_member(bigint,bigint) from public, anon, authenticated;

notify pgrst, 'reload schema';
