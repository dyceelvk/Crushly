-- 20261029122045 post_comment_threads
--
-- RECONSTRUCTED 2026-10-30 from the live production catalog (columns,
-- pg_constraint, pg_indexes, pg_get_functiondef). Idempotent, safe to replay.
--
-- What this migration owns: one level of replies under a comment.
--   * post_comments.parent_id + FK (on delete cascade) + the covering index
--   * post_comments_guard trigger - a reply must belong to the same post and
--     may not itself be a reply ("replies go one level deep")
--   * comment_on_post() gains p_parent_id
--   * post_comments_feed() returns parentId, replyCount, likeCount, liked
--   * delete_post_comment() tombstones a comment that still has replies
--     instead of destroying the thread under it

alter table public.post_comments
  add column if not exists parent_id bigint;

alter table public.post_comments
  drop constraint if exists post_comments_parent_fk;
alter table public.post_comments
  add constraint post_comments_parent_fk
  foreign key (parent_id) references public.post_comments(id) on delete cascade;

create index if not exists post_comments_parent_idx
  on public.post_comments (parent_id, created_at, id);

create or replace function public.post_comments_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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
end $function$;

drop trigger if exists post_comments_guard_trg on public.post_comments;
create trigger post_comments_guard_trg
  before insert or update of parent_id on public.post_comments
  for each row execute function public.post_comments_guard();

create or replace function public.comment_on_post(p_post_id bigint, p_body text, p_parent_id bigint default null::bigint)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  select count(*) into n from post_comments c
   where c.author_id = me and c.created_at > public.now_ms() - 3600 * 1000;
  if n >= 30 then
    perform public.crushly_fail(429, '', 'You have written plenty for now — try again in a bit.');
  end if;

  insert into post_comments (post_id, author_id, body, parent_id)
    values (po.id, me, clean_body, p_parent_id)
    returning id into new_id;

  return jsonb_build_object('id', new_id);
end $function$;

create or replace function public.post_comments_feed(p_post_id bigint, p_limit integer default 200)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
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
      and not public.is_blocked_pair(me, c.author_id)
    limit least(greatest(coalesce(p_limit, 200), 1), 400)
  );
end $function$;

create or replace function public.delete_post_comment(p_comment_id bigint)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
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
end $function$;

-- ---------------------------------------------------------------------------
-- Comment likes.
--
-- This table was part of the same body of work and is also absent from every
-- committed migration, so it is reconstructed here: the repo's later
-- 20261030204007_post_comment_likes_write_path.sql writes to `post_comment_likes` and
-- post_comments_feed() counts it, but nothing in the repo ever created it.
-- Production has it, and prod has no policies on it *beyond* the three below.
--
-- Reads are gated on the parent comment's post: you can see the likes on a
-- comment only if you could have read the comment.
-- ---------------------------------------------------------------------------

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
  using (exists (
    select 1 from post_comments c
      join posts p on p.id = c.post_id
     where c.id = post_comment_likes.comment_id
       and public.can_view_post(p.*, public.me_id())
  ));

drop policy if exists post_comment_likes_insert on public.post_comment_likes;
create policy post_comment_likes_insert on public.post_comment_likes
  for insert to authenticated
  with check (user_id = public.me_id());

drop policy if exists post_comment_likes_delete on public.post_comment_likes;
create policy post_comment_likes_delete on public.post_comment_likes
  for delete to authenticated
  using (user_id = public.me_id());

-- The original write path. 20261030204007_post_comment_likes_write_path.sql adds
-- like_post_comment() alongside it; production carries both, and both are
-- granted, so both are reproduced here.
create or replace function public.react_to_post_comment(p_comment_id bigint, p_liked boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
end $function$;

-- Execution grants, matching production pg_proc.proacl.
revoke all on function public.comment_on_post(bigint, text, bigint) from public, anon, authenticated;
grant execute on function public.comment_on_post(bigint, text, bigint) to authenticated, service_role;
revoke all on function public.post_comments_feed(bigint, integer) from public, anon, authenticated;
grant execute on function public.post_comments_feed(bigint, integer) to authenticated, service_role;
revoke all on function public.delete_post_comment(bigint) from public, anon, authenticated;
grant execute on function public.delete_post_comment(bigint) to authenticated, service_role;
revoke all on function public.react_to_post_comment(bigint, boolean) from public, anon, authenticated;
grant execute on function public.react_to_post_comment(bigint, boolean) to authenticated, service_role;

notify pgrst, 'reload schema';
