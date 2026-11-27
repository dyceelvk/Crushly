-- Two numbers the new Space header needs, added to the function that already
-- answers this question.
--
-- `holup_follow_stats` is the live v2 Space summary: Add Ups, Added Up, Homies,
-- post likes and the list-visibility rules. The header needs it to also answer
-- "how many people opened this Space" and "how much engagement have they had in
-- total" — so this extends that function rather than starting a second one that
-- would slowly disagree with it.
--
-- ── All Round Likes, defined exactly ────────────────────────────────────────
--
-- Every *like* a member has received, counted once each:
--
--   post_reactions       reactions on posts they wrote
--   moment_reactions     reactions on Moments they posted
--   post_comment_likes   likes on comments they wrote
--
-- Views, saves, downloads and messages are deliberately excluded: they are not
-- likes, and folding them in would inflate a number members compare with each
-- other. It rises only when somebody actually reacts.
--
-- Only content the caller could open is counted, so the total cannot be used as
-- a side channel to infer that a private post exists — a connections-only post's
-- reactions are invisible to a stranger here, exactly as they are everywhere else.
--
-- ── Views are the owner's ───────────────────────────────────────────────────
--
-- `views` is null for anybody but the member themselves. It is their traffic, not
-- a scoreboard, and the Space has always treated it that way. A visitor seeing
-- nothing is honest; seeing a zero would be a lie.

create or replace function public.holup_follow_stats(p_target bigint) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  me bigint:=public.me_id();
  base jsonb;
  outgoing text;
  incoming text;
  homies boolean;
  like_total int;
begin
  if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
  -- Uses the deployed Space authorization gate; a follow never grants access.
  base:=public.space_relationship_stats(p_target);

  select coalesce((select outgoing_visibility from public.holup_follow_settings where user_id=p_target),'private'),
         (select add_up_list_visibility from public.privacy where user_id=p_target),
         public.holup_existing_close(me,p_target) into outgoing,incoming,homies;

  -- Only computed when the Space is actually visible: space_relationship_stats
  -- has already raised if it is not, so reaching here means the caller may look.
  select
    coalesce((
      select count(*) from public.post_reactions r
        join public.posts p on p.id = r.post_id
       where p.author_id = p_target
         and (me = p_target or public.can_view_post(p, me))
    ), 0)
  + coalesce((
      select count(*) from public.moment_reactions mr
        join public.moments m on m.id = mr.moment_id
       where m.user_id = p_target
         and (me = p_target or public.can_view_moment(m, me))
    ), 0)
  + coalesce((
      select count(*) from public.post_comment_likes cl
        join public.post_comments c on c.id = cl.comment_id
        join public.posts p on p.id = c.post_id
       where c.author_id = p_target
         and not c.hidden
         and (me = p_target or public.can_view_post(p, me))
    ), 0)
  into like_total;

  return jsonb_build_object(
    'addUps',(select count(*) from public.holup_follows f join public.profiles p on p.id=f.follower_id where f.followed_id=p_target and f.status='active' and p.onboarded and p.status='active' and not public.is_blocked_pair(p_target,p.id)),
    'addedUp',(select count(*) from public.holup_follows f join public.profiles p on p.id=f.followed_id where f.follower_id=p_target and f.status='active' and p.onboarded and p.status='active' and not public.is_blocked_pair(p_target,p.id)),
    'canViewAddUps',me=p_target or incoming='everyone' or (incoming='close' and homies),
    'canViewAddedUp',me=p_target or outgoing='everyone' or (outgoing='close' and homies),
    'outgoingVisibility',case when me=p_target then outgoing else null end,
    -- `holup_follow_settings` on the live database has only user_id and
    -- outgoing_visibility: Add Ups have never needed approval here. Reported as
    -- a constant rather than guessed from a column that does not exist.
    'approvalRequired',case when me=p_target then false else null end,
    'myStatus',case when me<>p_target then (select status from public.holup_follows where follower_id=me and followed_id=p_target and status in ('active','pending')) else null end,
    'keptClose',base->'keptClose','canViewKeptClose',base->'canViewKeptClose','postLikes',base->'postLikes','addUpVisibility',base->'addUpVisibility',
    -- New: engagement received, and the owner's own traffic.
    'allRoundLikes', like_total,
    'views', case when me = p_target then coalesce((select sum(s.views) from public.space_views s where s.viewed_id = p_target), 0)::int else null end
  );
end $$;
