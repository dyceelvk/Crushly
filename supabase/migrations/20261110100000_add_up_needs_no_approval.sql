-- REQUIRES: relationship_cutover
--
-- This is a correction to a database that already carries the relationship
-- cutover (20261110080000). A database built from scratch never needs it: the
-- cutover file already contains the corrected rules, and applying this on top of
-- nothing would fail on a missing table. `scripts/validate-cutover.sh` skips any
-- migration carrying this marker for exactly that reason, and applies the
-- cutover candidate instead.
--
-- An Add Up needs nobody's approval. Only a Homie does.
--
-- APPLIED in production (yzcssyebozfkmojqqdhc) and recorded in
-- supabase_migrations.schema_migrations as 20261110092915_add_up_needs_no_approval.
-- Verified on the live database afterwards: pending Add Ups 1 -> 0, active
-- 2 -> 3, every Keep now an active follow, approval_required gone, the status
-- check is (active|declined), and the three routines answer approvalRequired
-- false.
--
-- The first cut of this feature let a member switch on "require my approval"
-- before anybody could Add them Up. That is not the product: adding somebody up
-- is immediate and one-way, and the only relationship that has to be agreed to is
-- a Homie. This migration removes the rule rather than leaving it switched off,
-- so it cannot be switched back on by a stray client or a forgotten setting.
--
-- It also corrects what the backfill in 20261110080000 got wrong once the rule is
-- stated plainly:
--
--   * a Keep was a one-way, unanswered follow. That is an Add Up, so it arrives
--     active — it does not ask anybody to answer it;
--   * a *pending* Crush was a request to connect. Connecting is a Homie, so that
--     is where it belongs: an unanswered Homie request.

begin;

-- 1. Undo what the previous backfill made of a pending Crush. It imported every
--    pending Crush as a pending Add Up, which is the wrong relationship: a Crush
--    request was a request to connect, and connecting is a Homie. The imported
--    row is identified by the exact creation time the backfill copied from the
--    Crush, so an Add Up the member made for themselves is never touched.
lock table public.keeps, public.crushes, public.holup_homies in share row exclusive mode;
delete from public.holup_follows f
 using public.crushes c
 where c.status = 'pending'
   and f.follower_id = c.from_id
   and f.followed_id = c.to_id
   and f.created_at = c.created_at;

-- 2. Keeps are Add Ups that already happened: one-way, unanswered, lived. They
--    arrive active, and they arrive after step 1 so that a pair which had both a
--    Keep and a Crush keeps its follow.
insert into public.holup_follows(follower_id, followed_id, status, created_at, decided_at)
 select k.keeper_id, k.kept_id, 'active', k.created_at, k.created_at
   from public.keeps k
  where not public.is_blocked_pair(k.keeper_id, k.kept_id)
 on conflict (follower_id, followed_id) do nothing;

-- 3. Any pending follow left can only exist because approval was switched on.
--    There is no such switch any more, so they are promoted rather than left in a
--    state the product cannot reach.
update public.holup_follows set status = 'active', decided_at = coalesce(decided_at, created_at)
 where status = 'pending';

-- 4. The Homie requests the previous backfill built out of Keeps were never
--    asked for by the sender, so they go: a decline would put words in their
--    mouth. Matched on the pair *and* the millisecond the Keep was created, which
--    is what the backfill copied — a request somebody actually tapped will not
--    match. Then a pending Crush, which IS a request to connect, is written where
--    it belongs, as an unanswered Homie request.
delete from public.holup_homie_requests r
 using public.keeps k
 where r.sender_id = k.keeper_id
   and r.recipient_id = k.kept_id
   and r.status = 'pending'
   and r.created_at = k.created_at;

insert into public.holup_homie_requests(sender_id, recipient_id, status, created_at)
 select c.from_id, c.to_id, 'pending', c.created_at
   from public.crushes c
  where c.status = 'pending'
    and not public.is_blocked_pair(c.from_id, c.to_id)
    and not exists (
      select 1 from public.holup_homies h
       where h.user_a = least(c.from_id, c.to_id) and h.user_b = greatest(c.from_id, c.to_id)
    )
 on conflict (sender_id, recipient_id) do nothing;

-- 5. Now the table can only hold the two honest states.
alter table public.holup_follows drop constraint if exists holup_follows_status_check;
alter table public.holup_follows add constraint holup_follows_status_check
  check (status in ('active', 'declined'));

-- 6. The setting itself. A column nobody may write is a rule waiting to be
--    rediscovered, so it goes.
alter table public.holup_follow_settings drop column if exists approval_required;

-- 7. The routines. `p_approval` stays in the signature and is ignored: installed
--    clients still send it, and dropping the argument would turn their settings
--    call into a PGRST202 for a feature they are not using.
create or replace function public.holup_set_follow_settings(p_approval boolean, p_outgoing_visibility text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare me bigint := public.me_id(); s public.holup_follow_settings;
begin
  if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
  if p_outgoing_visibility is not null and p_outgoing_visibility not in ('everyone','close','private') then
    perform public.crushly_fail(400,'','Choose a valid privacy setting.');
  end if;
  insert into public.holup_follow_settings(user_id, outgoing_visibility)
    values(me, coalesce(p_outgoing_visibility,'private'))
  on conflict(user_id) do update
    set outgoing_visibility = coalesce(p_outgoing_visibility, holup_follow_settings.outgoing_visibility)
  returning * into s;
  return jsonb_build_object('approvalRequired', false, 'outgoingVisibility', s.outgoing_visibility);
end $$;

create or replace function public.holup_follow(p_target bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
declare me bigint := public.me_id(); r public.holup_follows; target record;
begin
  if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
  if p_target is null or p_target = me then perform public.crushly_fail(400,'','Invalid member.'); end if;
  perform pg_advisory_xact_lock(hashtextextended('holup-follow-rate:'||me,0));
  perform public.holup_follow_pair_lock(me, p_target);
  if not exists(select 1 from public.profiles where id = me and onboarded and status = 'active') or
     public.is_blocked_pair(me, p_target) or public.load_visible_profile(me, p_target, false) is null then
    perform public.crushly_fail(404,'','Space not available.'); end if;
  perform public.space_relationship_stats(p_target);
  select p.name, pr.who_can_crush into target
    from public.profiles p join public.privacy pr on pr.user_id = p.id
   where p.id = p_target and p.onboarded and p.status = 'active';
  if not found then perform public.crushly_fail(404,'','Space not available.'); end if;
  if target.who_can_crush = 'verified' and not exists(select 1 from public.profiles where id = me and verification = 'verified') then
    perform public.crushly_fail(403,'verification_required','This member only accepts Add Ups from verified members.'); end if;
  select * into r from public.holup_follows where follower_id = me and followed_id = p_target;
  if found and r.status = 'active' then return jsonb_build_object('status','active','changed',false); end if;
  if found and r.status = 'declined' and r.decided_at > public.now_ms() - 604800000 then
    perform public.crushly_fail(429,'request_cooldown','Please wait before requesting again.'); end if;
  delete from public.holup_follow_attempts where follower_id = me and created_at <= public.now_ms() - 86400000;
  if (select count(*) from public.holup_follow_attempts where follower_id = me) >= 100 then
    perform public.crushly_fail(429,'rate_limit','Please wait before adding up more people.'); end if;
  insert into public.holup_follow_attempts(follower_id) values(me);
  -- Immediate. There is no approval step to wait for, so there is no pending
  -- state to reach: the row is written active, now, and they are told.
  insert into public.holup_follows(follower_id, followed_id, status, created_at, decided_at)
    values(me, p_target, 'active', public.now_ms(), public.now_ms())
  on conflict(follower_id, followed_id) do update
    set status = 'active', created_at = excluded.created_at, decided_at = excluded.decided_at
  returning * into r;
  perform public.notify_to(p_target, 'keep', me, null, '');
  return jsonb_build_object('status', r.status, 'changed', true);
end $$;

create or replace function public.holup_follow_stats(p_target bigint) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare me bigint := public.me_id(); base jsonb; outgoing text; incoming text; homies boolean;
begin
  if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
  base := public.space_relationship_stats(p_target);
  select coalesce((select outgoing_visibility from public.holup_follow_settings where user_id = p_target),'private'),
         (select add_up_list_visibility from public.privacy where user_id = p_target),
         public.holup_existing_close(me, p_target) into outgoing, incoming, homies;
  return jsonb_build_object(
    'addUps', (select count(*) from public.holup_follows f join public.profiles p on p.id = f.follower_id
                where f.followed_id = p_target and f.status = 'active' and p.onboarded and p.status = 'active'
                  and not public.is_blocked_pair(p_target, p.id)),
    'addedUp', (select count(*) from public.holup_follows f join public.profiles p on p.id = f.followed_id
                where f.follower_id = p_target and f.status = 'active' and p.onboarded and p.status = 'active'
                  and not public.is_blocked_pair(p_target, p.id)),
    'canViewAddUps', me = p_target or incoming = 'everyone' or (incoming = 'close' and homies),
    'canViewAddedUp', me = p_target or outgoing = 'everyone' or (outgoing = 'close' and homies),
    'outgoingVisibility', case when me = p_target then outgoing else null end,
    'approvalRequired', false,
    'myStatus', case when me <> p_target then
      (select status from public.holup_follows where follower_id = me and followed_id = p_target and status = 'active')
      else null end,
    'keptClose', base->'keptClose', 'canViewKeptClose', base->'canViewKeptClose',
    'postLikes', base->'postLikes', 'addUpVisibility', base->'addUpVisibility');
end $$;

notify pgrst, 'reload schema';

commit;
