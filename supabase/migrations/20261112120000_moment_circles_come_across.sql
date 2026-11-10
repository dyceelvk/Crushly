-- 20261112120000_moment_circles_come_across
--
-- What this migration owns: who appears in the ring of Moments above the
-- Crushes feed, and the record of whose Space a member has actually opened.
--
-- The ring used to be `visible_moments()` — everybody whose Moment this member
-- was allowed to see. On a public-audience Moment that is effectively everyone
-- in the app, so the row filled with strangers: people you had never opened,
-- never clicked with, never kept. A face at the top of your own feed should be
-- somebody you have actually met here.
--
-- So the ring reads a smaller set. One row per person, and only if this member
-- has done at least one of:
--
--   * added them up          — `crushes.from_id = me`
--   * clicked with them      — `connections`
--   * kept them close        — `keeps.keeper_id = me`
--   * spoken to them         — `conversations`
--   * opened their Space     — `space_views` (added below)
--
-- Liking a post is deliberately *not* on that list. A like is a reaction to one
-- piece of writing, and it should not put a face in front of you every time
-- that person posts a Moment. Same for viewing a Moment: watching somebody's
-- Moment is not the same as having come across them.
--
-- `visible_moments()` is untouched. Discover still browses the wider set, and a
-- Moment you can see there is still a Moment you can open.

-- ---------------------------------------------------------------- space views
--
-- There was no record of a member opening somebody's Space, so "viewed their
-- profile" could not be answered anywhere in the database. This is that record,
-- and it is one-way on purpose.
--
-- It is private in the strongest sense the schema allows: there is no table
-- grant to `authenticated` at all, only the two functions below, which are
-- security definer. Nobody can read who viewed whom — not the owner of the
-- Space, not an admin surface, not a query in the app. Its only consumer is
-- `moment_circles()`, for the viewer's own row set.

create table if not exists public.space_views (
  viewer_id      bigint not null references public.profiles(id) on delete cascade,
  viewed_id      bigint not null references public.profiles(id) on delete cascade,
  first_seen_at  bigint not null default public.now_ms(),
  last_seen_at   bigint not null default public.now_ms(),
  views          integer not null default 1 check (views > 0),
  primary key (viewer_id, viewed_id),
  check (viewer_id <> viewed_id)
);

create index if not exists space_views_viewer_idx
  on public.space_views (viewer_id, last_seen_at desc);

alter table public.space_views enable row level security;

-- No policies: the table is invisible to every client role. Reading and writing
-- happen only inside the security-definer functions below, which decide for
-- themselves who is allowed to do what.
revoke all on table public.space_views from public, anon, authenticated;

/**
 * "I opened this person's Space."
 *
 * Called by the Space screen once it has a member to show. Silent, cheap, and
 * idempotent: the second visit updates a timestamp instead of adding a row.
 *
 * Refuses to record a view of yourself, of somebody who blocked you, or of
 * somebody you blocked — a blocked Space is not one you "came across".
 */
create or replace function public.record_space_view(p_member_id bigint)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  me bigint := public.me_id();
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  if p_member_id is null or p_member_id = me then
    return false;
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_member_id) then
    return false;
  end if;
  if public.is_blocked_pair(me, p_member_id) then
    return false;
  end if;

  insert into public.space_views as sv (viewer_id, viewed_id)
  values (me, p_member_id)
  on conflict (viewer_id, viewed_id) do update
    set last_seen_at = public.now_ms(),
        views = sv.views + 1;

  return true;
end $function$;

revoke all on function public.record_space_view(bigint) from public, anon;
grant execute on function public.record_space_view(bigint) to authenticated, service_role;

-- ------------------------------------------------------------- the ring itself
--
-- Same shape as `visible_moments()` — serialized jsonb rows, oldest first, so
-- the client groups and orders them exactly as it already does. The only
-- difference is the set: `can_view_moment` still has the last word, so expiry,
-- audience, blocks, incognito and profile visibility keep their meaning.

create or replace function public.moment_circles()
returns setof jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  me bigint := public.me_id();
  m public.moments;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  for m in
    select mo.*
      from public.moments mo
     where mo.expires_at > public.now_ms()
       and public.can_view_moment(mo, me)
       and (
         -- Mine always belongs in the row: it is how you see what you have live.
         mo.user_id = me
         -- Kept in my Close Ones.
         or exists (select 1 from public.keeps k
                     where k.keeper_id = me and k.kept_id = mo.user_id)
         -- Clicked with: the connection is mutual, so either column order works,
         -- but the table stores user_a < user_b.
         or exists (select 1 from public.connections c
                     where c.user_a = least(me, mo.user_id)
                       and c.user_b = greatest(me, mo.user_id))
         -- Added up: I sent the Add Up. One I merely received is not a meeting.
         or exists (select 1 from public.crushes cr
                     where cr.from_id = me and cr.to_id = mo.user_id)
         -- We have a Whisper thread.
         or exists (select 1 from public.conversations cv
                     where cv.user_a = least(me, mo.user_id)
                       and cv.user_b = greatest(me, mo.user_id))
         -- I opened their Space.
         or exists (select 1 from public.space_views sv
                     where sv.viewer_id = me and sv.viewed_id = mo.user_id)
       )
       -- Passing on someone removes them from the ring even if the rest is true.
       and not exists (select 1 from public.passes pa
                        where pa.from_id = me and pa.to_id = mo.user_id)
     order by mo.created_at asc
  loop
    return next public.serialize_moment(m, me);
  end loop;
end $function$;

revoke all on function public.moment_circles() from public, anon, authenticated;
grant execute on function public.moment_circles() to authenticated, service_role;

notify pgrst, 'reload schema';
