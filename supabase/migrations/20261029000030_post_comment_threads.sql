/* Comments become a conversation.

   Two things were missing from a comment on a post, both visible in the design
   we are matching: a comment could not be liked, and a comment could not be
   answered. Everything else about comments already works and is left alone —
   who may read them, who may leave them, who may delete them.

   REPLIES ARE ONE LEVEL DEEP
   A reply points at the comment it answers, and a reply may not answer another
   reply. That is not a presentation shortcut: an unbounded tree is impossible
   to draw on a phone without sliding a second screen over the first, and the
   conversation it produces ("@a @b @c yes") is worse than the flat one. Depth
   is enforced by trigger, so it holds even if a caller skips the RPC.

   "HIDE" MEANS DETACH, NOT ERASE
   Deleting a comment that has replies would silently delete somebody else's
   words, and leave the survivors answering a question that is no longer there.
   So a comment with replies is emptied instead: the body becomes null,
   `hidden` becomes true, and the replies stay where they are. The app draws
   "This comment was deleted." Nobody's reply disappears because somebody else
   tapped delete.
*/

/* ------------------------------------------------------------------- tables */

alter table public.post_comments add column if not exists parent_id bigint;
alter table public.post_comments add column if not exists hidden boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'post_comments_parent_fk'
  ) then
    alter table public.post_comments
      add constraint post_comments_parent_fk
      foreign key (parent_id) references public.post_comments(id) on delete cascade;
  end if;
end $$;

-- The thread is read by parent, so it is indexed by parent.
create index if not exists post_comments_parent_idx
  on public.post_comments (parent_id, created_at, id);

/* A reply must belong to the same post as the comment it answers, and must not
   answer a reply. Both are properties of the row, so the table enforces them. */
create or replace function public.post_comments_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  parent public.post_comments;
begin
  if new.parent_id is null then
    return new;
  end if;

  select * into parent from post_comments c where c.id = new.parent_id;
  if not found then
    perform public.crushly_fail(404, '', 'That comment isn’t there.');
  end if;
  if parent.post_id <> new.post_id then
    perform public.crushly_fail(400, '', 'That reply belongs somewhere else.');
  end if;
  if parent.parent_id is not null then
    perform public.crushly_fail(400, '', 'Replies go one level deep.');
  end if;

  return new;
end $$;

drop trigger if exists post_comments_guard on public.post_comments;
create trigger post_comments_guard before insert or update of parent_id
  on public.post_comments
  for each row execute function public.post_comments_guard();

/* Likes on a comment. Same shape as a like on a post, and the same rule: the
   only row you may put here is your own. */
create table if not exists public.post_comment_likes (
  comment_id bigint not null references public.post_comments(id) on delete cascade,
  user_id    bigint not null references public.profiles(id) on delete cascade,
  created_at bigint not null default public.now_ms(),
  primary key (comment_id, user_id)
);

alter table public.post_comment_likes enable row level security;

drop policy if exists post_comment_likes_select on public.post_comment_likes;
create policy post_comment_likes_select on public.post_comment_likes
  for select to authenticated
  using (
    exists (
      select 1 from post_comments c
        join posts p on p.id = c.post_id
       where c.id = post_comment_likes.comment_id
         and public.can_view_post(p, public.me_id())
    )
  );

drop policy if exists post_comment_likes_insert on public.post_comment_likes;
create policy post_comment_likes_insert on public.post_comment_likes
  for insert to authenticated with check (user_id = public.me_id());

drop policy if exists post_comment_likes_delete on public.post_comment_likes;
create policy post_comment_likes_delete on public.post_comment_likes
  for delete to authenticated using (user_id = public.me_id());

/* ------------------------------------------------------------------- reads */

-- `post_comments_feed` is replaced: it now carries the parent, the like count,
-- whether you liked it, whether it was hidden, and how many answers it has, so
-- one call draws the whole thread. The reader's own comments are always
-- visible; the blocked-pair filter is unchanged.
create or replace function public.post_comments_feed(p_post_id bigint, p_limit integer default 200)
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
    select jsonb_build_object('items', coalesce(jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'body', case when c.hidden then null else c.body end,
        'parentId', c.parent_id,
        'hidden', c.hidden,
        'createdAt', c.created_at,
        'mine', c.author_id = me,
        -- Yours to remove: your own, or any on a post you wrote.
        'canDelete', c.author_id = me or po.author_id = me,
        'likeCount', (select count(*) from post_comment_likes l where l.comment_id = c.id),
        'liked', exists (
          select 1 from post_comment_likes l where l.comment_id = c.id and l.user_id = me
        ),
        'replyCount', (
          select count(*) from post_comments r
           where r.parent_id = c.id
             and not public.is_blocked_pair(me, r.author_id)
        ),
        'author', public.public_profile(me, c.author_id, false)
      ) order by c.created_at, c.id
    ), '[]'::jsonb))
    from post_comments c
    where c.post_id = po.id
      -- A comment from somebody you have cut off is not shown to you, even
      -- though he was allowed to leave it.
      and not public.is_blocked_pair(me, c.author_id)
    limit least(greatest(coalesce(p_limit, 200), 1), 400)
  );
end $$;

/* --------------------------------------------------------------- mutations */

-- A comment, or a reply to one. `p_parent_id` is separate from the body so the
-- database knows the shape of the thread without parsing text for "@name".
create or replace function public.comment_on_post(
  p_post_id bigint, p_body text, p_parent_id bigint default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me         bigint := public.me_id();
  po         public.posts;
  parent     public.post_comments;
  clean_body text := left(btrim(coalesce(p_body, '')), 1000);
  new_id     bigint;
  n          integer;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  select * into po from posts p where p.id = p_post_id;
  if not found or not public.can_view_post(po, me) then
    perform public.crushly_fail(404, '', 'That post isn’t available.');
  end if;
  if clean_body = '' then
    perform public.crushly_fail(400, '', 'Write something first.');
  end if;

  if p_parent_id is not null then
    select * into parent from post_comments c where c.id = p_parent_id;
    if not found or parent.post_id <> p_post_id then
      perform public.crushly_fail(404, '', 'That comment isn’t there.');
    end if;
    if parent.parent_id is not null then
      perform public.crushly_fail(400, '', 'Replies go one level deep.');
    end if;
    if parent.hidden then
      perform public.crushly_fail(400, '', 'That comment was deleted.');
    end if;
    if public.is_blocked_pair(me, parent.author_id) then
      perform public.crushly_fail(404, '', 'That comment isn’t there.');
    end if;
  end if;

  -- Somebody working through a feed leaving a hundred comments is not a
  -- conversation; it is noise. Thirty an hour is more than anybody writes.
  select count(*) into n from post_comments c
   where c.author_id = me and c.created_at > public.now_ms() - 3600 * 1000;
  if n >= 30 then
    perform public.crushly_fail(429, '', 'You have written plenty for now — try again in a bit.');
  end if;

  insert into post_comments (post_id, author_id, body, parent_id)
    values (po.id, me, clean_body, p_parent_id)
    returning id into new_id;

  return jsonb_build_object('id', new_id);
end $$;

/* Deleting is unchanged in who may do it, and smarter in what it leaves:
   a comment with answers is emptied rather than removed. */
create or replace function public.delete_post_comment(p_comment_id bigint)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  c  public.post_comments;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  select cc.* into c
    from post_comments cc
    join posts p on p.id = cc.post_id
   where cc.id = p_comment_id
     and (cc.author_id = me or p.author_id = me);

  if not found then
    perform public.crushly_fail(404, '', 'That comment isn’t there.');
  end if;

  if exists (select 1 from post_comments r where r.parent_id = c.id) then
    update post_comments
       set hidden = true, body = ''
     where id = c.id;
  else
    delete from post_comments where id = c.id;
  end if;

  return true;
end $$;

-- Liking a comment. The answer says what the count is now, so the app can show
-- the truth rather than its own guess.
create or replace function public.react_to_post_comment(
  p_comment_id bigint, p_liked boolean default true
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  c  public.post_comments;
  po public.posts;
  now_liked boolean;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  select * into c from post_comments cc where cc.id = p_comment_id;
  if not found then
    perform public.crushly_fail(404, '', 'That comment isn’t there.');
  end if;
  select * into po from posts p where p.id = c.post_id;
  if not found or not public.can_view_post(po, me) or public.is_blocked_pair(me, c.author_id) then
    perform public.crushly_fail(404, '', 'That comment isn’t there.');
  end if;
  if c.hidden then
    perform public.crushly_fail(400, '', 'That comment was deleted.');
  end if;

  if coalesce(p_liked, true) then
    insert into post_comment_likes (comment_id, user_id) values (c.id, me)
      on conflict do nothing;
    now_liked := true;
  else
    delete from post_comment_likes l where l.comment_id = c.id and l.user_id = me;
    now_liked := false;
  end if;

  return jsonb_build_object(
    'liked', now_liked,
    'likeCount', (select count(*) from post_comment_likes l where l.comment_id = c.id)
  );
end $$;

-- The post-level count now counts what the thread draws: top-level comments,
-- plus answers, minus nothing hidden — a deleted comment with answers is still
-- a comment, and its answers still count.
create or replace function public.post_engagement(p_post_id bigint, p_viewer bigint)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'likeCount', (select count(*) from post_reactions r where r.post_id = p_post_id),
    'commentCount', (
      select count(*) from post_comments c
       where c.post_id = p_post_id
         and not public.is_blocked_pair(p_viewer, c.author_id)
    ),
    'liked', exists (select 1 from post_reactions r where r.post_id = p_post_id and r.user_id = p_viewer)
  );
$$;

/* ------------------------------------------------------------------ grants */

revoke all on function public.post_comments_feed(bigint, integer) from public, anon, authenticated;
grant execute on function public.post_comments_feed(bigint, integer) to authenticated, service_role;

revoke all on function public.comment_on_post(bigint, text) from public, anon, authenticated;
revoke all on function public.comment_on_post(bigint, text, bigint) from public, anon, authenticated;
grant execute on function public.comment_on_post(bigint, text, bigint) to authenticated, service_role;

revoke all on function public.delete_post_comment(bigint) from public, anon, authenticated;
grant execute on function public.delete_post_comment(bigint) to authenticated, service_role;

revoke all on function public.react_to_post_comment(bigint, boolean) from public, anon, authenticated;
grant execute on function public.react_to_post_comment(bigint, boolean) to authenticated, service_role;

revoke all on function public.post_engagement(bigint, bigint) from public, anon, authenticated;
grant execute on function public.post_engagement(bigint, bigint) to authenticated, service_role;
