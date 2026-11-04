-- Circles become active: highlights worth looking at, and a way in.
--
-- §3 of the brief asked for two things that are really one idea. A Circle you
-- are already in should show you the thing inside it that people actually
-- engaged with — not a badge, not an "unread 3" — and a Circle you are not in
-- should be joinable, with the owner deciding, and with that rule enforced here
-- rather than in the button that happens to be on screen.
--
-- Two pieces follow:
--
--   * `circle_highlights()` — for the Circles you belong to, the post with the
--     most reactions in each, plus how many messages that room has had this
--     week. Every number comes from a row. There is no seeded engagement and no
--     derived guess: a Circle nobody has reacted to simply has no highlight.
--
--   * join requests — a real table with a pending row, an owner's decision, and
--     a membership that only `decide_circle_request()` can create. The whole
--     point of approving in the database is that a client cannot approve
--     itself: the request table has RLS on and no policies, so the only way to
--     read or write it is through these functions.
--
-- Nothing here changes what a Circle's contents are. A public Circle is still
-- findable, not readable: the request grants membership, and membership is what
-- reads the room.

/* ---------------------------------------------------------------- requests */

create table if not exists public.circle_join_requests (
  id          bigint generated always as identity primary key,
  circle_id   bigint not null references public.circles(id) on delete cascade,
  member_id   bigint not null references public.profiles(id) on delete cascade,
  status      text not null default 'pending'
                check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  created_at  bigint not null default public.now_ms(),
  decided_at  bigint,
  decided_by  bigint references public.profiles(id) on delete set null
);

-- One pending request per person per room. A decided row may be followed by a
-- new pending one, which is what "ask again later" means.
create unique index if not exists circle_join_requests_pending_idx
  on public.circle_join_requests (circle_id, member_id) where status = 'pending';

create index if not exists circle_join_requests_circle_idx
  on public.circle_join_requests (circle_id, created_at desc);

alter table public.circle_join_requests enable row level security;
-- Deliberately no policies: every read and every write goes through the
-- functions below, which check who is asking.

/** How many people a Circle holds. One number, in one place. */
create or replace function public.circle_capacity()
returns integer
language sql
immutable
as $function$
  select 12
$function$;

/**
 * Ask to join.
 *
 * Only a public Circle takes requests. Everything that could make the asking a
 * lie — a block between the two people, a full room, already being inside — is
 * refused here with a sentence a person can read, because the client is not the
 * place that gets to decide any of it.
 */
create or replace function public.request_join_circle(p_circle_id bigint)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  me  bigint := public.me_id();
  c   public.circles;
  req public.circle_join_requests;
  n   int;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  select * into c from circles where id = p_circle_id;
  if not found then
    perform public.crushly_fail(404, '', 'That Circle is not here any more.');
  end if;

  if c.visibility <> 'public' then
    perform public.crushly_fail(403, '', 'That Circle is not taking new members.');
  end if;

  if exists (select 1 from circle_members where circle_id = c.id and member_id = me) then
    perform public.crushly_fail(409, '', 'You are already in this Circle.');
  end if;

  if public.is_blocked_pair(me, c.owner_id) then
    perform public.crushly_fail(403, '', 'You cannot join this Circle.');
  end if;

  select count(*) into n from circle_members where circle_id = c.id;
  if n >= public.circle_capacity() then
    perform public.crushly_fail(409, '', 'This Circle is full.');
  end if;

  select * into req from circle_join_requests
   where circle_id = c.id and member_id = me and status = 'pending';
  if found then
    return jsonb_build_object('status', 'pending', 'requestId', req.id);
  end if;

  insert into circle_join_requests (circle_id, member_id)
    values (c.id, me)
    returning * into req;
  return jsonb_build_object('status', 'pending', 'requestId', req.id);
end $function$;

/** Take the request back before anybody answers it. */
create or replace function public.cancel_join_request(p_circle_id bigint)
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
  update circle_join_requests
     set status = 'cancelled', decided_at = public.now_ms(), decided_by = me
   where circle_id = p_circle_id and member_id = me and status = 'pending';
  return found;
end $function$;

/**
 * The owner's side: who has asked, for the rooms you started.
 *
 * Returns the asker as a profile card, because the decision is about a person
 * and not about an id. Circles you own but that are not public cannot have
 * requests, so they simply return nothing.
 */
create or replace function public.my_circle_requests()
returns jsonb
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

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id,
             'circleId', r.circle_id,
             'circleName', c.name,
             'createdAt', r.created_at,
             'member', public.public_profile(me, r.member_id, false)
           ) order by r.created_at)
      from circle_join_requests r
      join circles c on c.id = r.circle_id
     where c.owner_id = me
       and r.status = 'pending'
       and r.member_id <> me
  ), '[]'::jsonb);
end $function$;

/**
 * Approve or reject.
 *
 * The membership is created here, so an approved request and a row in
 * `circle_members` are the same event. A room that filled up between the asking
 * and the answer refuses the approval instead of silently exceeding twelve.
 */
create or replace function public.decide_circle_request(p_request_id bigint, p_approve boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  me  bigint := public.me_id();
  r   public.circle_join_requests;
  c   public.circles;
  n   int;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  select * into r from circle_join_requests where id = p_request_id;
  if not found or r.status <> 'pending' then
    perform public.crushly_fail(404, '', 'That request has already been answered.');
  end if;

  select * into c from circles where id = r.circle_id;
  if not found or c.owner_id <> me then
    perform public.crushly_fail(403, '', 'Only the person who started this Circle can answer.');
  end if;

  if p_approve then
    select count(*) into n from circle_members where circle_id = c.id;
    if n >= public.circle_capacity()
       and not exists (select 1 from circle_members where circle_id = c.id and member_id = r.member_id) then
      perform public.crushly_fail(409, '', 'This Circle is full.');
    end if;
    insert into circle_members (circle_id, member_id, role, joined_at)
      values (c.id, r.member_id, 'member', public.now_ms())
      on conflict (circle_id, member_id) do nothing;
  end if;

  update circle_join_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_at = public.now_ms(),
         decided_by = me
   where id = r.id;

  return jsonb_build_object('ok', true, 'approved', p_approve, 'memberId', r.member_id, 'circleId', c.id);
end $function$;

/** Where you stand with one room: for the button on somebody's Space. */
create or replace function public.circle_request_state(p_circle_id bigint)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  me bigint := public.me_id();
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  return jsonb_build_object(
    'requested', exists (
      select 1 from circle_join_requests
       where circle_id = p_circle_id and member_id = me and status = 'pending'
    )
  );
end $function$;

/* -------------------------------------------------------------- highlights */

/**
 * The most engaged thing in each of your Circles.
 *
 * A highlight is one of two facts, and both are counted:
 *
 *   * the post in the room with the most reactions — with its reactions and
 *     comments;
 *   * how many messages the room has had in the last seven days.
 *
 * Ordered by engagement, so the carousel leads with the room people are
 * actually using. A Circle with no reactions and no recent messages still
 * appears if it has messages at all, but at the back, and its `kind` is
 * `quiet`. Rooms with nothing in them are not returned: an empty card is a
 * worse empty state than no card.
 */
create or replace function public.circle_highlights(p_limit integer default 8)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  me bigint := public.me_id();
  n  int := least(greatest(coalesce(p_limit, 8), 1), 20);
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  return coalesce((
    select jsonb_agg(item order by score desc, circle_id)
      from (
        select
               (coalesce(best.likes, 0) * 3) + coalesce(best.comments, 0) * 2 + coalesce(week.messages, 0) as score,
               c.id as circle_id,
               jsonb_build_object(
                 'circleId', c.id,
                 'circleName', c.name,
                 'theme', c.theme,
                 'coverUrl', c.cover_url,
                 'memberCount', (select count(*) from circle_members cm where cm.circle_id = c.id),
                 'postId', best.post_id,
                 'body', best.body,
                 'mediaUrl', best.media_url,
                 'likes', coalesce(best.likes, 0),
                 'comments', coalesce(best.comments, 0),
                 'messages', coalesce(week.messages, 0),
                 'kind', case when best.post_id is not null and coalesce(best.likes, 0) > 0 then 'post'
                              when coalesce(week.messages, 0) > 0 then 'conversation'
                              else 'quiet' end,
                 'score', (coalesce(best.likes, 0) * 3) + coalesce(best.comments, 0) * 2 + coalesce(week.messages, 0),
                 'totalMessages', (select count(*) from circle_messages m where m.circle_id = c.id)
               ) as item
          from circles c
          join circle_members mine on mine.circle_id = c.id and mine.member_id = me
          left join lateral (
            select po.id as post_id, po.body, po.media_url,
                   (select count(*) from post_reactions pr where pr.post_id = po.id) as likes,
                   (select count(*) from post_comments pc where pc.post_id = po.id) as comments
              from posts po
             where po.circle_id = c.id
             order by (select count(*) from post_reactions pr where pr.post_id = po.id) desc,
                      po.created_at desc
             limit 1
          ) best on true
          left join lateral (
            select count(*) as messages
              from circle_messages m
             where m.circle_id = c.id
               and m.created_at > public.now_ms() - 7 * 24 * 60 * 60 * 1000
          ) week on true
         where best.post_id is not null or coalesce(week.messages, 0) > 0
         order by score desc, c.id
         limit n
      ) ranked
  ), '[]'::jsonb);
end $function$;

/* ------------------------------------------------------------------ grants */

revoke all on function public.circle_capacity() from public, anon, authenticated;
grant execute on function public.circle_capacity() to authenticated, service_role;

revoke all on function public.request_join_circle(bigint) from public, anon, authenticated;
grant execute on function public.request_join_circle(bigint) to authenticated, service_role;

revoke all on function public.cancel_join_request(bigint) from public, anon, authenticated;
grant execute on function public.cancel_join_request(bigint) to authenticated, service_role;

revoke all on function public.my_circle_requests() from public, anon, authenticated;
grant execute on function public.my_circle_requests() to authenticated, service_role;

revoke all on function public.decide_circle_request(bigint, boolean) from public, anon, authenticated;
grant execute on function public.decide_circle_request(bigint, boolean) to authenticated, service_role;

revoke all on function public.circle_request_state(bigint) from public, anon, authenticated;
grant execute on function public.circle_request_state(bigint) to authenticated, service_role;

revoke all on function public.circle_highlights(integer) from public, anon, authenticated;
grant execute on function public.circle_highlights(integer) to authenticated, service_role;

notify pgrst, 'reload schema';
