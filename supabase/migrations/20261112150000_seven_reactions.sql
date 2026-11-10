-- 20261112150000_seven_reactions
--
-- What this migration owns: the seven reactions a member can give a post or a
-- comment, and the record of which one each person gave.
--
-- The set was five — crush, fire, laugh, wow, clap — and it was reached through a
-- single tap on a heart. A tap is one bit, so five kinds behind one gesture is
-- five kinds nobody could reach: the app only ever sent `crush`. Press and hold
-- opens a row, and the row has seven: the three that were there, plus sad, angry
-- and tired, because a feed that only lets you be delighted is a feed where you
-- are not being honest.
--
-- `clap` stays legal in the constraint even though it is no longer offered: real
-- rows carry it, and a constraint that invalidates live data is a migration that
-- breaks the ones who already reacted. It is simply not in the row any more.

-- ------------------------------------------------------------------- on a post
alter table public.post_reactions drop constraint if exists post_reactions_kind_check;
alter table public.post_reactions
  add constraint post_reactions_kind_check
  check (kind in ('crush', 'laugh', 'wow', 'fire', 'sad', 'angry', 'tired', 'clap'));

-- ---------------------------------------------------------------- on a comment
--
-- A comment's like was a boolean row keyed (comment_id, user_id) — reactive to
-- nothing but "yes". It gets a kind, defaulting to crush so every existing row
-- still means exactly what it meant.
alter table public.post_comment_likes
  add column if not exists kind text not null default 'crush';

alter table public.post_comment_likes drop constraint if exists post_comment_likes_kind_check;
alter table public.post_comment_likes
  add constraint post_comment_likes_kind_check
  check (kind in ('crush', 'laugh', 'wow', 'fire', 'sad', 'angry', 'tired', 'clap'));

/**
 * Give a comment one of the seven, or take yours back.
 *
 * One reaction per person per comment, and choosing a different one replaces it
 * rather than stacking: that is what a row of reactions means everywhere else,
 * and two feelings at once on one sentence is not a thing anybody asked for.
 *
 * A new name rather than an overload of `like_post_comment`: that function takes
 * `(bigint, boolean)`, and adding a `(bigint, text)` candidate would make a
 * two-argument call ambiguous — PostgREST answers 300 to an ambiguous call, and
 * every existing client would break at once.
 */
create or replace function public.react_to_comment(p_comment_id bigint, p_kind text default 'crush')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  me  bigint := public.me_id();
  c   public.post_comments;
  po  public.posts;
  k   text := coalesce(p_kind, 'crush');
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  if k not in ('crush', 'laugh', 'wow', 'fire', 'sad', 'angry', 'tired', 'clap') then
    perform public.crushly_fail(400, 'kind', 'That is not a reaction.');
  end if;

  select * into c from post_comments pc where pc.id = p_comment_id;
  if not found or c.hidden then
    perform public.crushly_fail(404, '', 'That comment isn’t there.');
  end if;

  select * into po from posts p where p.id = c.post_id;
  -- You cannot react to a comment on a post you cannot read, and a block
  -- silences both ways here exactly as it does everywhere else.
  if not found or not public.can_view_post(po, me) or public.is_blocked_pair(me, c.author_id) then
    perform public.crushly_fail(404, '', 'That comment isn’t there.');
  end if;

  -- Same reaction again means "take it back": the row goes, and nobody has to
  -- find a separate control to undo a tap.
  if exists (
    select 1 from post_comment_likes l
     where l.comment_id = c.id and l.user_id = me and l.kind = k
  ) then
    delete from post_comment_likes l where l.comment_id = c.id and l.user_id = me;
    return jsonb_build_object(
      'myReaction', null,
      'likeCount', (select count(*) from post_comment_likes l where l.comment_id = c.id)
    );
  end if;

  insert into post_comment_likes (comment_id, user_id, kind) values (c.id, me, k)
  on conflict (comment_id, user_id) do update set kind = excluded.kind, created_at = public.now_ms();

  return jsonb_build_object(
    'myReaction', k,
    'likeCount', (select count(*) from post_comment_likes l where l.comment_id = c.id)
  );
end $function$;

revoke all on function public.react_to_comment(bigint, text) from public, anon;
grant execute on function public.react_to_comment(bigint, text) to authenticated, service_role;

/**
 * The comment list, now saying which reaction each comment has from you.
 *
 * `liked` stays, so nothing that already reads it breaks; `myReaction` is the
 * new fact, and it is what the row draws.
 */
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
        'myReaction', (
          select l.kind from post_comment_likes l
           where l.comment_id = c.id and l.user_id = me
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

notify pgrst, 'reload schema';
