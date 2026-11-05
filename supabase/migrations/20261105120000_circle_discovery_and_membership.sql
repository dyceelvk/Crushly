-- Circles you can find, and rooms you have to be let into.
--
-- Until now a Circle had one switch: `visibility`, public or not. That was one
-- question pretending to be two, and it produced the worst of both answers —
-- a room could be findable on a Space while having no way in at all, and an
-- owner had no way to say "anyone who wants in, come in".
--
-- Two independent settings replace it:
--
--   discoverable   may this room be found by people who are not in it?
--                  It appears in Connections' discovery, it can be recommended,
--                  and its preview is readable. Off means the room is invisible
--                  outside its members, and only the owner can bring people in.
--
--   join_policy    when somebody who found it asks to come in, what happens?
--                    request  they ask, the owner answers. Pending grants nothing.
--                    open     they are in, immediately. Still a join, not a dodge
--                             around capacity or a block.
--                    invite   there is no asking. The owner adds people.
--
-- The two are orthogonal on purpose. "Findable but you must be approved",
-- "findable and open", and "hidden and I choose who comes in" are three
-- different communities that used to be one.
--
-- Everything below is a function with RLS under it: `circles` is still readable
-- only through membership, so a discoverable room is findable without being
-- readable. Finding a room means seeing its name, its face, who runs it and how
-- busy it is — never its posts and never its conversation.

/* ------------------------------------------------------------- the settings */

alter table public.circles
  add column if not exists discoverable boolean not null default false;

alter table public.circles
  add column if not exists join_policy text not null default 'request';

alter table public.circles
  drop constraint if exists circles_join_policy_check;
alter table public.circles
  add constraint circles_join_policy_check check (join_policy in ('request', 'open', 'invite'));

-- A room that was public was, by definition, findable. Those keep the one thing
-- they had, and start on the safest of the three policies.
update public.circles
   set discoverable = true
 where visibility = 'public'
   and discoverable = false;

/**
 * One truth, two columns.
 *
 * `visibility` is what older builds read and what older fixtures write;
 * `discoverable` is what the rest of this migration decides by. A trigger keeps
 * them from ever disagreeing — including for an INSERT from an old build, and
 * including for a hand-written fixture, which is how the existing test suite
 * builds its rooms.
 */
create or replace function public.circles_mirror_visibility()
returns trigger
language plpgsql
as $function$
begin
  if tg_op = 'INSERT' then
    if new.visibility = 'public' then
      new.discoverable := true;
    end if;
    new.visibility := case when new.discoverable then 'public' else 'connections' end;
  elsif new.discoverable is distinct from old.discoverable then
    new.visibility := case when new.discoverable then 'public' else 'connections' end;
  elsif new.visibility is distinct from old.visibility then
    new.discoverable := (new.visibility = 'public');
  end if;
  return new;
end $function$;

drop trigger if exists circles_mirror_visibility on public.circles;
create trigger circles_mirror_visibility
  before insert or update on public.circles
  for each row execute function public.circles_mirror_visibility();

/**
 * The owner's answer to both questions at once.
 *
 * `visibility` is kept in step so builds written before this migration keep
 * drawing the right badge; `discoverable` is the truth from here on.
 */
create or replace function public.set_circle_access(
  p_circle_id bigint, p_discoverable boolean, p_join_policy text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  me bigint := public.me_id();
  v_owner bigint;
  v_discoverable boolean := coalesce(p_discoverable, false);
  v_policy text := case when p_join_policy in ('request', 'open', 'invite') then p_join_policy else 'request' end;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  select owner_id into v_owner from circles where id = p_circle_id;
  if v_owner is null then
    perform public.crushly_fail(404, '', 'That Circle isn’t here any more.');
  end if;
  if v_owner <> me then
    perform public.crushly_fail(403, '', 'Only the owner can change this Circle.');
  end if;

  update circles
     set discoverable = v_discoverable,
         join_policy = v_policy,
         visibility = case when v_discoverable then 'public' else 'connections' end
   where id = p_circle_id;

  return jsonb_build_object(
    'id', p_circle_id,
    'discoverable', v_discoverable,
    'joinPolicy', v_policy,
    'visibility', case when v_discoverable then 'public' else 'connections' end
  );
end $function$;

/**
 * What a room's settings are, for the management screen.
 *
 * Owner only: the numbers behind the switches are the owner's business, and a
 * pending request is somebody's name.
 */
create or replace function public.circle_settings(p_circle_id bigint)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  me bigint := public.me_id();
  c public.circles;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  select * into c from circles where id = p_circle_id;
  if not found then
    perform public.crushly_fail(404, '', 'That Circle isn’t here any more.');
  end if;
  if c.owner_id <> me then
    perform public.crushly_fail(403, '', 'Only the owner can manage this Circle.');
  end if;
  return jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'discoverable', c.discoverable,
    'joinPolicy', c.join_policy,
    'capacity', public.circle_capacity(),
    'memberCount', (select count(*) from circle_members where circle_id = c.id),
    'pendingRequests', (select count(*) from circle_join_requests r where r.circle_id = c.id and r.status = 'pending'),
    'pendingInvitations', (select count(*) from circle_invitations i where i.circle_id = c.id and i.status = 'pending')
  );
end $function$;

/* ------------------------------------------------------------ invitations */

-- The other direction of the same question. A request is somebody asking to
-- come in; an invitation is the owner asking somebody in. Both end in a row in
-- `circle_members`, and neither does so by itself.
create table if not exists public.circle_invitations (
  id          bigint generated always as identity primary key,
  circle_id   bigint not null references public.circles(id) on delete cascade,
  member_id   bigint not null references public.profiles(id) on delete cascade,
  invited_by  bigint not null references public.profiles(id) on delete cascade,
  status      text not null default 'pending'
                check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at  bigint not null default public.now_ms(),
  decided_at  bigint
);

-- One live invitation per person per room, the same way there is one live
-- request: asking twice is not two invitations.
create unique index if not exists circle_invitations_pending_idx
  on public.circle_invitations (circle_id, member_id) where status = 'pending';

create index if not exists circle_invitations_member_idx
  on public.circle_invitations (member_id, created_at desc);

alter table public.circle_invitations enable row level security;
-- No policies, same as requests: every read and write is a function below.

/* -------------------------------------------------------- notification kinds */

-- Four new things can happen to a person: somebody asked to come into their
-- room, they were let in, they were turned away, and they were asked in.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('crush', 'deep_crush', 'mutual', 'message', 'moment_reply',
                  'moment_reaction', 'verified', 'verification_rejected',
                  'post_reaction', 'post_comment',
                  'circle_request', 'circle_approved', 'circle_declined', 'circle_invite'));

/* --------------------------------------------------------------- discovery */

/**
 * Rooms you could walk into, for the Connections feed.
 *
 * The rules, in order, because each one is a refusal somebody could otherwise
 * complain about:
 *
 *   * only discoverable rooms — a private family room is not a suggestion;
 *   * never a room you are in, or the one you own;
 *   * never a room whose owner has blocked you, or you them;
 *   * never a room that is already full, because recommending a door that
 *     cannot open is worse than recommending nothing;
 *   * ranked by what makes a room worth joining: whether it is about something
 *     you said you were into, whether people you are connected to are already
 *     inside, and how alive it is this week. Member count is the last tiebreak,
 *     not the first score, so a big dead room does not outrank a small one
 *     people are actually using.
 *
 * `state` carries where you already stand, so the card can show the truth:
 * `none`, `pending`, `invited`, or `member` (a member is not a discovery, but
 * the query is also used to place a card for a room you just left).
 *
 * Paging is offset-based and the order is deterministic, so "load more" never
 * shows the same room twice and never skips one.
 */
create or replace function public.discover_circles(p_limit integer default 6, p_offset integer default 0)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  me bigint := public.me_id();
  lim int := least(greatest(coalesce(p_limit, 6), 1), 20);
  off int := greatest(coalesce(p_offset, 0), 0);
  my_interests jsonb;
  week bigint := public.now_ms() - 7 * 24 * 60 * 60 * 1000;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  select coalesce(interests, '[]'::jsonb) into my_interests from profiles where id = me;
  my_interests := coalesce(my_interests, '[]'::jsonb);

  return coalesce((
    select jsonb_agg(item order by score desc, member_count desc, id)
      from (
        select c.id,
               c.member_count,
               (
                 -- Is it about something you said you were into? A theme that
                 -- matches one of your interests is the strongest single signal.
                 case when c.theme is not null
                       and exists (
                         select 1 from jsonb_array_elements_text(my_interests) i
                          where lower(i) = lower(c.theme)
                             or c.theme ilike '%' || i || '%'
                             or i ilike '%' || c.theme || '%'
                       ) then 8 else 0 end
                 -- People you already know, inside.
                 + 4 * c.friends_inside
                 -- A room being used this week beats a room with a big history.
                 + 2 * least(c.posts_week, 5)
                 + 2 * least(c.messages_week, 5)
                 + least(c.reactions_week, 10)
                 + least(c.member_count, 12)
               ) as score,
               jsonb_build_object(
                 'id', c.id,
                 'name', c.name,
                 'about', c.about,
                 'theme', c.theme,
                 'coverUrl', c.cover_url,
                 'createdAt', c.created_at,
                 'ownerId', c.owner_id,
                 'ownerName', c.owner_name,
                 'ownerUsername', c.owner_username,
                 'ownerPhoto', c.owner_photo,
                 'memberCount', c.member_count,
                 'capacity', public.circle_capacity(),
                 'discoverable', true,
                 'joinPolicy', c.join_policy,
                 'postsThisWeek', c.posts_week,
                 'messagesThisWeek', c.messages_week,
                 'posts', c.posts_total,
                 'messages', c.messages_total,
                 'friendsInside', c.friends_inside,
                 'state', case
                            when exists (select 1 from circle_members m where m.circle_id = c.id and m.member_id = me) then 'member'
                            when exists (select 1 from circle_join_requests r where r.circle_id = c.id and r.member_id = me and r.status = 'pending') then 'pending'
                            when exists (select 1 from circle_invitations i where i.circle_id = c.id and i.member_id = me and i.status = 'pending') then 'invited'
                            else 'none'
                          end
               ) as item
          from (
            select c0.*,
                   (select count(*) from circle_members m0 where m0.circle_id = c0.id) as member_count,
                   (select count(*) from posts p0 where p0.circle_id = c0.id) as posts_total,
                   (select count(*) from posts p0 where p0.circle_id = c0.id and p0.created_at > week) as posts_week,
                   (select count(*) from circle_messages m0 where m0.circle_id = c0.id) as messages_total,
                   (select count(*) from circle_messages m0 where m0.circle_id = c0.id and m0.created_at > week) as messages_week,
                   (select count(*) from posts p0
                      join post_reactions r0 on r0.post_id = p0.id
                     where p0.circle_id = c0.id and r0.created_at > week) as reactions_week,
                   (select count(distinct cm0.member_id) from circle_members cm0
                     where cm0.circle_id = c0.id and cm0.member_id <> me
                       and public.is_connected_pair(me, cm0.member_id)) as friends_inside,
                   po.name as owner_name,
                   po.username as owner_username,
                   (select ph.url from photos ph where ph.user_id = po.id order by ph.position, ph.id limit 1) as owner_photo
              from circles c0
              join profiles po on po.id = c0.owner_id
             where c0.discoverable
               and not exists (select 1 from circle_members m1 where m1.circle_id = c0.id and m1.member_id = me)
               and not public.is_blocked_pair(me, c0.owner_id)
          ) c
         where c.member_count < public.circle_capacity()
         order by score desc, c.member_count desc, c.id
         limit lim offset off
      ) ranked
  ), '[]'::jsonb);
end $function$;

/* ----------------------------------------------------------------- preview */

/**
 * One room, seen from outside.
 *
 * A member sees the room. A non-member sees it only if it is discoverable, and
 * even then sees only what a stranger may know: what it is called, what it is
 * about, its face, who runs it, who is in it, and how much has happened — counts,
 * not contents. The posts and the conversation stay behind membership, which is
 * the one rule Circles have had since the first migration and is not relaxed
 * here to make a preview look fuller.
 */
create or replace function public.circle_preview(p_circle_id bigint)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  me bigint := public.me_id();
  c public.circles;
  member boolean;
  week bigint := public.now_ms() - 7 * 24 * 60 * 60 * 1000;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  select * into c from circles where id = p_circle_id;
  if not found then
    perform public.crushly_fail(404, '', 'That Circle isn’t here any more.');
  end if;

  member := public.is_circle_member(c.id, me);
  if not member and not c.discoverable then
    perform public.crushly_fail(403, '', 'That Circle is private.');
  end if;

  return jsonb_build_object(
    'circle', jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'about', c.about,
      'theme', c.theme,
      'coverUrl', c.cover_url,
      'createdAt', c.created_at,
      'ownerId', c.owner_id,
      'discoverable', c.discoverable,
      'joinPolicy', c.join_policy,
      'memberCount', (select count(*) from circle_members m where m.circle_id = c.id),
      'capacity', public.circle_capacity()
    ),
    'owner', public.public_profile(me, c.owner_id, false),
    'members', coalesce((
      select jsonb_agg(faces.item order by faces.joined_at)
        from (
          select public.public_profile(me, m.member_id, false) as item, m.joined_at
            from circle_members m
           where m.circle_id = c.id
             and not public.is_blocked_pair(me, m.member_id)
           order by m.joined_at
           limit 8
        ) faces
    ), '[]'::jsonb),
    'activity', jsonb_build_object(
      'posts', (select count(*) from posts p where p.circle_id = c.id),
      'postsThisWeek', (select count(*) from posts p where p.circle_id = c.id and p.created_at > week),
      'messagesThisWeek', (select count(*) from circle_messages m where m.circle_id = c.id and m.created_at > week),
      'reactionsThisWeek', (select count(*) from posts p join post_reactions r on r.post_id = p.id
                             where p.circle_id = c.id and r.created_at > week),
      'lastActivityAt', greatest(
        coalesce((select max(p.created_at) from posts p where p.circle_id = c.id), 0),
        coalesce((select max(m.created_at) from circle_messages m where m.circle_id = c.id), 0)
      )
    ),
    'state', case
               when member then 'member'
               when exists (select 1 from circle_join_requests r where r.circle_id = c.id and r.member_id = me and r.status = 'pending') then 'pending'
               when exists (select 1 from circle_invitations i where i.circle_id = c.id and i.member_id = me and i.status = 'pending') then 'invited'
               else 'none'
             end,
    'myRole', case when member then (select m.role from circle_members m where m.circle_id = c.id and m.member_id = me) else null end,
    'full', (select count(*) from circle_members m where m.circle_id = c.id) >= public.circle_capacity()
  );
end $function$;

/* -------------------------------------------------------------------- join */

/**
 * Walking in.
 *
 * One function for all three policies, because the button and the rule should
 * never be able to disagree: an `open` room makes you a member now, a `request`
 * room makes you a pending row, and an `invite` room refuses — including when
 * the client ignored the fact that there was no button to press.
 *
 * An outstanding invitation is honoured on the way in: if the owner already
 * asked you, asking back is not a request, it is an acceptance.
 */
create or replace function public.join_circle(p_circle_id bigint)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  me bigint := public.me_id();
  c public.circles;
  req public.circle_join_requests;
  inv public.circle_invitations;
  n int;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  select * into c from circles where id = p_circle_id;
  if not found then
    perform public.crushly_fail(404, '', 'That Circle isn’t here any more.');
  end if;

  if exists (select 1 from circle_members where circle_id = c.id and member_id = me) then
    return jsonb_build_object('state', 'member', 'already', true);
  end if;

  if public.is_blocked_pair(me, c.owner_id) then
    perform public.crushly_fail(403, '', 'You cannot join this Circle.');
  end if;

  -- Invited already: this is not an ask, it is an answer.
  select * into inv from circle_invitations
   where circle_id = c.id and member_id = me and status = 'pending';
  if found then
    select count(*) into n from circle_members where circle_id = c.id;
    if n >= public.circle_capacity() then
      perform public.crushly_fail(409, '', 'This Circle is full.');
    end if;
    insert into circle_members (circle_id, member_id, role, joined_at)
      values (c.id, me, 'member', public.now_ms())
      on conflict (circle_id, member_id) do nothing;
    update circle_invitations
       set status = 'accepted', decided_at = public.now_ms()
     where id = inv.id;
    perform public.notify_to(c.owner_id, 'circle_approved', me, c.id, left(c.name, 60));
    return jsonb_build_object('state', 'member', 'viaInvitation', true);
  end if;

  if not c.discoverable then
    perform public.crushly_fail(403, '', 'That Circle is private.');
  end if;

  if c.join_policy = 'invite' then
    perform public.crushly_fail(403, '', 'This Circle only takes people the owner adds.');
  end if;

  select count(*) into n from circle_members where circle_id = c.id;
  if n >= public.circle_capacity() then
    perform public.crushly_fail(409, '', 'This Circle is full.');
  end if;

  if c.join_policy = 'open' then
    insert into circle_members (circle_id, member_id, role, joined_at)
      values (c.id, me, 'member', public.now_ms())
      on conflict (circle_id, member_id) do nothing;
    perform public.notify_to(c.owner_id, 'circle_approved', me, c.id, left(c.name, 60));
    return jsonb_build_object('state', 'member');
  end if;

  select * into req from circle_join_requests
   where circle_id = c.id and member_id = me and status = 'pending';
  if not found then
    insert into circle_join_requests (circle_id, member_id)
      values (c.id, me)
      returning * into req;
    perform public.notify_to(c.owner_id, 'circle_request', me, c.id, left(c.name, 60));
  end if;

  return jsonb_build_object('state', 'pending', 'requestId', req.id);
end $function$;

/**
 * The owner's decision, now with the two notifications it always implied.
 *
 * Approval is the only path that creates a membership from a request, and it
 * hands the new member the room's name rather than an id: "You're in" should
 * say what you are in.
 */
create or replace function public.decide_circle_request(p_request_id bigint, p_approve boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  me bigint := public.me_id();
  r public.circle_join_requests;
  c public.circles;
  n int;
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
    perform public.notify_to(r.member_id, 'circle_approved', me, c.id, left(c.name, 60));
  else
    perform public.notify_to(r.member_id, 'circle_declined', me, c.id, left(c.name, 60));
  end if;

  update circle_join_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_at = public.now_ms(),
         decided_by = me
   where id = r.id;

  return jsonb_build_object(
    'ok', true,
    'approved', p_approve,
    'memberId', r.member_id,
    'circleId', c.id,
    'circleName', c.name
  );
end $function$;

/* ------------------------------------------------------------- invitations */

/**
 * Asking somebody in.
 *
 * Refused for an open room — there is nothing to invite people to when the door
 * is already unlocked, and a pending invitation there would be paperwork. If the
 * person has already asked to join, this is the answer to that request, so it
 * becomes membership and the request is marked approved rather than left
 * standing next to a membership that makes it meaningless.
 */
create or replace function public.invite_to_circle(p_circle_id bigint, p_member_id bigint)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  me bigint := public.me_id();
  c public.circles;
  req public.circle_join_requests;
  inv public.circle_invitations;
  n int;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  select * into c from circles where id = p_circle_id;
  if not found then
    perform public.crushly_fail(404, '', 'That Circle isn’t here any more.');
  end if;
  if c.owner_id <> me then
    perform public.crushly_fail(403, '', 'Only the person who started this Circle can add people.');
  end if;
  if p_member_id is null or p_member_id = me then
    perform public.crushly_fail(400, '', 'That is not somebody to add.');
  end if;
  if not exists (select 1 from profiles where id = p_member_id) then
    perform public.crushly_fail(404, '', 'That member is not here any more.');
  end if;
  if exists (select 1 from circle_members where circle_id = c.id and member_id = p_member_id) then
    perform public.crushly_fail(409, '', 'They are already in this Circle.');
  end if;
  if public.is_blocked_pair(me, p_member_id) then
    perform public.crushly_fail(403, '', 'You cannot add this person.');
  end if;
  if c.join_policy = 'open' then
    perform public.crushly_fail(409, '', 'Anyone can join this Circle already — no invitation needed.');
  end if;

  select count(*) into n from circle_members where circle_id = c.id;
  if n >= public.circle_capacity() then
    perform public.crushly_fail(409, '', 'This Circle is full.');
  end if;

  -- They asked; this is the yes.
  select * into req from circle_join_requests
   where circle_id = c.id and member_id = p_member_id and status = 'pending';
  if found then
    insert into circle_members (circle_id, member_id, role, joined_at)
      values (c.id, p_member_id, 'member', public.now_ms())
      on conflict (circle_id, member_id) do nothing;
    update circle_join_requests
       set status = 'approved', decided_at = public.now_ms(), decided_by = me
     where id = req.id;
    perform public.notify_to(p_member_id, 'circle_approved', me, c.id, left(c.name, 60));
    return jsonb_build_object('state', 'member', 'fromRequest', true);
  end if;

  select * into inv from circle_invitations
   where circle_id = c.id and member_id = p_member_id and status = 'pending';
  if not found then
    insert into circle_invitations (circle_id, member_id, invited_by)
      values (c.id, p_member_id, me)
      returning * into inv;
    perform public.notify_to(p_member_id, 'circle_invite', me, c.id, left(c.name, 60));
  end if;

  return jsonb_build_object('state', 'invited', 'invitationId', inv.id);
end $function$;

/** The invitations waiting on you. */
create or replace function public.my_circle_invitations()
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

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', i.id,
             'circleId', i.circle_id,
             'circleName', c.name,
             'about', c.about,
             'theme', c.theme,
             'coverUrl', c.cover_url,
             'memberCount', (select count(*) from circle_members m where m.circle_id = c.id),
             'createdAt', i.created_at,
             'invitedBy', public.public_profile(me, i.invited_by, false),
             'state', 'invited'
           ) order by i.created_at desc)
      from circle_invitations i
      join circles c on c.id = i.circle_id
     where i.member_id = me and i.status = 'pending'
       and not public.is_blocked_pair(me, c.owner_id)
  ), '[]'::jsonb);
end $function$;

/**
 * Yes or no to an invitation.
 *
 * Only the person invited can answer, and accepting goes through the same
 * capacity test as every other way in — an invitation is not a key that
 * overfills a room.
 */
create or replace function public.respond_circle_invitation(p_invitation_id bigint, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  me bigint := public.me_id();
  inv public.circle_invitations;
  c public.circles;
  n int;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  select * into inv from circle_invitations where id = p_invitation_id;
  if not found or inv.member_id <> me or inv.status <> 'pending' then
    perform public.crushly_fail(404, '', 'That invitation is no longer open.');
  end if;

  select * into c from circles where id = inv.circle_id;

  if p_accept then
    select count(*) into n from circle_members where circle_id = c.id;
    if n >= public.circle_capacity() then
      perform public.crushly_fail(409, '', 'This Circle is full.');
    end if;
    insert into circle_members (circle_id, member_id, role, joined_at)
      values (c.id, me, 'member', public.now_ms())
      on conflict (circle_id, member_id) do nothing;
    perform public.notify_to(c.owner_id, 'circle_approved', me, c.id, left(c.name, 60));
  end if;

  update circle_invitations
     set status = case when p_accept then 'accepted' else 'declined' end,
         decided_at = public.now_ms()
   where id = inv.id;

  return jsonb_build_object('ok', true, 'accepted', p_accept, 'circleId', c.id);
end $function$;

/**
 * The owner's desk: everybody, everybody waiting, everybody invited, everybody
 * turned away.
 *
 * One call rather than four, because the four lists are read at one glance and
 * somebody deciding a request wants to see the room it is for.
 */
create or replace function public.circle_manage(p_circle_id bigint)
returns jsonb
language plpgsql
stable security definer
set search_path = 'public'
as $function$
declare
  me bigint := public.me_id();
  c public.circles;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  select * into c from circles where id = p_circle_id;
  if not found then
    perform public.crushly_fail(404, '', 'That Circle isn’t here any more.');
  end if;
  if c.owner_id <> me then
    perform public.crushly_fail(403, '', 'Only the owner can manage this Circle.');
  end if;

  return jsonb_build_object(
    'circle', jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'about', c.about,
      'theme', c.theme,
      'coverUrl', c.cover_url,
      'discoverable', c.discoverable,
      'joinPolicy', c.join_policy,
      'capacity', public.circle_capacity()
    ),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'member', public.public_profile(me, m.member_id, false),
               'role', m.role,
               'joinedAt', m.joined_at
             ) order by case when m.role = 'owner' then 0 else 1 end, m.joined_at)
        from circle_members m where m.circle_id = c.id
    ), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id,
               'requestedAt', r.created_at,
               'member', public.public_profile(me, r.member_id, false)
             ) order by r.created_at)
        from circle_join_requests r
       where r.circle_id = c.id and r.status = 'pending' and r.member_id <> me
    ), '[]'::jsonb),
    'declined', coalesce((
      select jsonb_agg(no.item order by no.decided_at desc nulls last)
        from (
          select jsonb_build_object(
                   'id', r.id,
                   'requestedAt', r.created_at,
                   'decidedAt', r.decided_at,
                   'member', public.public_profile(me, r.member_id, false)
                 ) as item,
                 r.decided_at
            from circle_join_requests r
           where r.circle_id = c.id and r.status = 'rejected'
           order by r.decided_at desc nulls last
           limit 20
        ) no
    ), '[]'::jsonb),
    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id,
               'createdAt', i.created_at,
               'member', public.public_profile(me, i.member_id, false)
             ) order by i.created_at desc)
        from circle_invitations i
       where i.circle_id = c.id and i.status = 'pending'
    ), '[]'::jsonb)
  );
end $function$;

/**
 * Somebody to invite.
 *
 * The owner picks from people they can already see — their Connections first,
 * because a room is a room and twelve strangers is not one. Search is by name or
 * username, never anonymous: you cannot invite somebody you could not otherwise
 * find.
 */
create or replace function public.circle_invite_candidates(p_circle_id bigint, p_query text default '')
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  me bigint := public.me_id();
  q text := lower(btrim(coalesce(p_query, '')));
  owner bigint;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  select c.owner_id into owner from circles c where c.id = p_circle_id;
  if owner is null or owner <> me then
    perform public.crushly_fail(403, '', 'Only the owner can add people.');
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'member', public.public_profile(me, p.id, false),
             'connected', public.is_connected_pair(me, p.id),
             'invited', exists (select 1 from circle_invitations i
                                 where i.circle_id = p_circle_id and i.member_id = p.id and i.status = 'pending')
           ) order by (case when public.is_connected_pair(me, p.id) then 0 else 1 end), p.name)
      from profiles p
      join privacy pr on pr.user_id = p.id
     where p.id <> me
       and p.onboarded
       and p.status = 'active'
       and pr.discoverable
       and not public.is_blocked_pair(me, p.id)
       and not exists (select 1 from circle_members m where m.circle_id = p_circle_id and m.member_id = p.id)
       and (q = '' or lower(p.name) like '%' || q || '%' or lower(coalesce(p.username, '')) like '%' || q || '%')
     limit 24
  ), '[]'::jsonb);
end $function$;

/* ------------------------------------------------------------ the old doors */

-- `request_join_circle` keeps working for builds already in people's hands, but
-- it now asks the same questions as `join_circle` instead of the retired
-- visibility flag.
create or replace function public.request_join_circle(p_circle_id bigint)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  me bigint := public.me_id();
  c public.circles;
  req public.circle_join_requests;
  n int;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  select * into c from circles where id = p_circle_id;
  if not found then
    perform public.crushly_fail(404, '', 'That Circle is not here any more.');
  end if;
  if not c.discoverable then
    perform public.crushly_fail(403, '', 'That Circle is not taking new members.');
  end if;
  if c.join_policy = 'invite' then
    perform public.crushly_fail(403, '', 'This Circle only takes people the owner adds.');
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
  perform public.notify_to(c.owner_id, 'circle_request', me, c.id, left(c.name, 60));
  return jsonb_build_object('status', 'pending', 'requestId', req.id);
end $function$;

/**
 * A member's Space, and the Circles on it a stranger may walk up to.
 *
 * The old rule was `visibility = 'public'`; the rule is `discoverable` now, and
 * the two are kept in step by `set_circle_access`, so this only had to change
 * which one it reads.
 */
create or replace function public.member_circles(p_member_id bigint)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  me bigint := public.me_id();
  connected boolean;
  items jsonb := '[]'::jsonb;
  r record;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  connected := public.is_connected_pair(me, p_member_id);

  for r in
    select c.*,
           (select count(*) from circle_members cm2 where cm2.circle_id = c.id) as member_count,
           exists (select 1 from circle_members cm3 where cm3.circle_id = c.id and cm3.member_id = me) as i_am_in
      from circles c
     where exists (select 1 from circle_members cm where cm.circle_id = c.id and cm.member_id = p_member_id)
       and (
         c.discoverable
         or connected
         or exists (select 1 from circle_members cm5 where cm5.circle_id = c.id and cm5.member_id = me)
       )
     order by i_am_in desc, member_count desc, c.created_at desc
     limit 30
  loop
    items := items || jsonb_build_array(jsonb_build_object(
      'id', r.id,
      'name', r.name,
      'about', r.about,
      'coverUrl', r.cover_url,
      'theme', r.theme,
      'visibility', r.visibility,
      'discoverable', r.discoverable,
      'joinPolicy', r.join_policy,
      'createdAt', r.created_at,
      'ownerId', r.owner_id,
      'myRole', case when r.i_am_in then coalesce((select cm6.role from circle_members cm6 where cm6.circle_id = r.id and cm6.member_id = me), 'member') else 'visitor' end,
      'muted', coalesce((select cm7.muted from circle_members cm7 where cm7.circle_id = r.id and cm7.member_id = me), false),
      'memberCount', r.member_count,
      'joined', r.i_am_in
    ));
  end loop;

  return jsonb_build_object('items', items, 'connected', connected);
end $function$;

-- `my_circles` carries the two settings so the rooms list can say, in a line,
-- what each room is: open, by request, or by invitation.
create or replace function public.my_circles()
returns jsonb
language plpgsql stable security definer set search_path = 'public' as $function$
declare
  me bigint := public.me_id();
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  return (
    select jsonb_build_object('items', coalesce(jsonb_agg(t.item), '[]'::jsonb))
    from (
      select jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'about', c.about,
        'coverUrl', c.cover_url,
        'theme', c.theme,
        'visibility', c.visibility,
        'discoverable', c.discoverable,
        'joinPolicy', c.join_policy,
        'createdAt', c.created_at,
        'ownerId', c.owner_id,
        'myRole', cm.role,
        'muted', cm.muted,
        'memberCount', (select count(*) from circle_members m where m.circle_id = c.id),
        'pendingRequests', case when cm.role = 'owner'
                                then (select count(*) from circle_join_requests r
                                       where r.circle_id = c.id and r.status = 'pending')
                                else 0 end,
        'lastMessageAt', (select max(m2.created_at) from circle_messages m2 where m2.circle_id = c.id),
        'unreadCount', (
          select count(*) from circle_messages m3
           where m3.circle_id = c.id and m3.sender_id <> me and m3.created_at > cm.last_read_at
             and not public.is_blocked_pair(me, m3.sender_id)
        )
      ) as item,
      coalesce((select max(m4.created_at) from circle_messages m4 where m4.circle_id = c.id), c.created_at) as activity
      from circles c join circle_members cm on cm.circle_id = c.id
      where cm.member_id = me
      order by activity desc, c.id desc
    ) t
  );
end $function$;

/* ------------------------------------------------------------------ grants */

revoke all on function public.set_circle_access(bigint, boolean, text) from public, anon, authenticated;
grant execute on function public.set_circle_access(bigint, boolean, text) to authenticated, service_role;

revoke all on function public.circle_settings(bigint) from public, anon, authenticated;
grant execute on function public.circle_settings(bigint) to authenticated, service_role;

revoke all on function public.discover_circles(integer, integer) from public, anon, authenticated;
grant execute on function public.discover_circles(integer, integer) to authenticated, service_role;

revoke all on function public.circle_preview(bigint) from public, anon, authenticated;
grant execute on function public.circle_preview(bigint) to authenticated, service_role;

revoke all on function public.join_circle(bigint) from public, anon, authenticated;
grant execute on function public.join_circle(bigint) to authenticated, service_role;

revoke all on function public.invite_to_circle(bigint, bigint) from public, anon, authenticated;
grant execute on function public.invite_to_circle(bigint, bigint) to authenticated, service_role;

revoke all on function public.my_circle_invitations() from public, anon, authenticated;
grant execute on function public.my_circle_invitations() to authenticated, service_role;

revoke all on function public.respond_circle_invitation(bigint, boolean) from public, anon, authenticated;
grant execute on function public.respond_circle_invitation(bigint, boolean) to authenticated, service_role;

revoke all on function public.circle_manage(bigint) from public, anon, authenticated;
grant execute on function public.circle_manage(bigint) to authenticated, service_role;

revoke all on function public.circle_invite_candidates(bigint, text) from public, anon, authenticated;
grant execute on function public.circle_invite_candidates(bigint, text) to authenticated, service_role;

notify pgrst, 'reload schema';
