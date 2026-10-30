-- Reactions carry what they are, not merely that they happened.
--
-- A Moment already answers with a kind: crush, fire, laugh, wow, clap. A post
-- did not — `post_reactions` had only (post_id, user_id, created_at), so the
-- most useful thing a reader could say about a post was "yes". This gives a
-- post the same vocabulary a Moment has, which means one reaction model across
-- the whole product instead of two.
--
-- Nothing is widened here. A reaction still inherits the audience of its post,
-- a block still silences both ways, and a reaction you cannot see the post for
-- is still invisible.
--
-- Existing rows default to 'crush', which is what a like meant until today.

alter table public.post_reactions
  add column if not exists kind text not null default 'crush';

-- The same five words a Moment uses. Anything else is a typo, not a reaction.
alter table public.post_reactions drop constraint if exists post_reactions_kind_check;
alter table public.post_reactions
  add constraint post_reactions_kind_check
  check (kind in ('crush', 'fire', 'laugh', 'wow', 'clap'));

-- ------------------------------------------------------------ reacting, typed

-- `create or replace` would leave the old two-argument function in place,
-- because the signature differs — and then PostgREST would see two candidates
-- for a two-argument call and answer 300. So: create the new one with defaults,
-- then drop the old one, guarded, exactly as 20261012000025 did.
create or replace function public.react_to_post(
  p_post_id bigint,
  p_liked   boolean default true,
  p_kind    text    default 'crush'
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me    bigint := public.me_id();
  po    public.posts;
  had   boolean;
  clean text := lower(btrim(coalesce(p_kind, 'crush')));
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  select * into po from posts p where p.id = p_post_id;
  if not found or not public.can_view_post(po, me) then
    perform public.crushly_fail(404, '', 'That post isn’t available.');
  end if;
  if po.author_id = me then
    perform public.crushly_fail(400, '', 'You can’t like your own post.');
  end if;

  if clean not in ('crush', 'fire', 'laugh', 'wow', 'clap') then
    clean := 'crush';
  end if;

  select exists (select 1 from post_reactions r where r.post_id = po.id and r.user_id = me) into had;

  if coalesce(p_liked, true) then
    insert into post_reactions (post_id, user_id, kind)
      values (po.id, me, clean)
    on conflict (post_id, user_id) do update set kind = excluded.kind;
    -- Only the first reaction is news; changing your mind afterwards is not.
    if not had then
      perform public.notify_to(po.author_id, 'post_reaction', me, po.id, '');
    end if;
  else
    delete from post_reactions r where r.post_id = po.id and r.user_id = me;
  end if;

  return jsonb_build_object(
    'liked', coalesce(p_liked, true),
    'myReaction', case when coalesce(p_liked, true) then clean else null end,
    'likeCount', (select count(*) from post_reactions r where r.post_id = po.id),
    'reactionKinds', coalesce((
      select jsonb_object_agg(s.kind, s.n)
        from (select r.kind, count(*) as n
                from post_reactions r
               where r.post_id = po.id
               group by r.kind) s
    ), '{}'::jsonb)
  );
end $$;

do $$
begin
  -- The two-argument version is superseded by the three-argument one above.
  if to_regprocedure('public.react_to_post(bigint, boolean, text)') is not null then
    drop function if exists public.react_to_post(bigint, boolean);
  end if;
end $$;

revoke all on function public.react_to_post(bigint, boolean, text) from public, anon, authenticated;
grant execute on function public.react_to_post(bigint, boolean, text) to authenticated, service_role;

-- ------------------------------------------- every post arrives with its answer

-- The feed and the post view both build their engagement through this one
-- function, so adding the breakdown here means it reaches both at once.
-- `saved` is included because `post_saves` has existed since 20261029205829
-- with a `save_post` function and no client ever called it.
create or replace function public.post_engagement(p_post_id bigint, p_viewer bigint)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'likeCount', (select count(*) from post_reactions r where r.post_id = p_post_id),
    'commentCount', (
      select count(*) from post_comments c
       where c.post_id = p_post_id
         and not c.hidden
         and not public.is_blocked_pair(p_viewer, c.author_id)
    ),
    'liked', exists (
      select 1 from post_reactions r where r.post_id = p_post_id and r.user_id = p_viewer
    ),
    'myReaction', (
      select r.kind from post_reactions r
       where r.post_id = p_post_id and r.user_id = p_viewer
    ),
    'reactionKinds', coalesce((
      select jsonb_object_agg(s.kind, s.n)
        from (select r.kind, count(*) as n
                from post_reactions r
               where r.post_id = p_post_id
               group by r.kind) s
    ), '{}'::jsonb),
    'saved', exists (
      select 1 from post_saves s where s.post_id = p_post_id and s.user_id = p_viewer
    )
  );
$$;

revoke all on function public.post_engagement(bigint, bigint) from public, anon, authenticated;
grant execute on function public.post_engagement(bigint, bigint) to authenticated, service_role;

notify pgrst, 'reload schema';
