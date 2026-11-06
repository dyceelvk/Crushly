-- Add Up is a request a person answers.
--
-- The fault: "Add Up" wrote a one-way row in `crushes` and connected both
-- members the instant the other had also done it. Nothing was ever asked, so
-- nothing could be accepted, declined or withdrawn — the recipient had no way
-- to say no, and the sender had no way to know whether it had been seen.
--
-- The model is the one this table already had, with the half that was missing:
--
--     pending    a request is waiting for the person it was sent to
--     accepted   they said yes; the pair is in `connections`
--     declined   they said no; the row is kept as the record of that
--     cancelled  the sender took it back
--
-- `connections` stays the only definition of "connected", so nothing about
-- messaging, Moments or the Crushes feed's audience rules changes. `keeps`
-- (Keep Close) is untouched and still needs nobody's permission: following is
-- not asking, and accepting a request is not following.
--
-- Counts, for the record: a request is between two members and only ever two
-- rows — one each way — because the primary key is the pair.

alter table public.crushes
  add column if not exists status text not null default 'pending',
  add column if not exists responded_at bigint;

alter table public.crushes drop constraint if exists crushes_status_check;
alter table public.crushes add constraint crushes_status_check
  check (status in ('pending', 'accepted', 'declined', 'cancelled'));

-- Anything already connected was answered long ago (by reciprocity, before
-- there was a word for it). Marking it accepted keeps history honest and stops
-- an old crush reappearing as a request the moment this ships.
update public.crushes c
   set status = 'accepted', responded_at = coalesce(c.responded_at, c.created_at)
 where c.status = 'pending'
   and public.is_connected_pair(c.from_id, c.to_id);

create index if not exists crushes_incoming_pending_idx
  on public.crushes (to_id, created_at desc) where status = 'pending';
create index if not exists crushes_outgoing_pending_idx
  on public.crushes (from_id, created_at desc) where status = 'pending';


-- ---------------------------------------------------------------- asking

/*
 * Add Up: ask to connect.
 *
 * Three things a button cannot decide by itself, and all three live here:
 *
 *   - a request is only new once. Asking twice is not two requests, and the
 *     primary key on (from_id, to_id) is why rather than a check in a screen;
 *   - if *they* have already asked, this is not a second request, it is an
 *     answer — both rows are accepted and the pair joins `connections`;
 *   - a declined request is not a door that can be knocked on every five
 *     minutes. Asking again is allowed after seven days, which is long enough
 *     to be a change of mind rather than a campaign.
 *
 * The preserved signature is deliberate: every installed build calls
 * `crush_member`, and the verb changed before the mechanism did.
 */
create or replace function public.crush_member(
  p_target_id bigint,
  p_is_deep boolean default false,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  target record;
  mine public.crushes;
  mine_found boolean;
  theirs_status text;
  already_connected boolean;
  used int;
  clean_note text;
  cooldown_ms bigint := 7 * 24 * 60 * 60 * 1000;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  if me = p_target_id then
    perform public.crushly_fail(400, '', 'You can’t add yourself up.');
  end if;
  if public.load_visible_profile(me, p_target_id) is null then
    perform public.crushly_fail(404, '', 'This profile isn’t available.');
  end if;

  select pf.name, pv.who_can_crush into target from profiles pf
    join privacy pv on pv.user_id = pf.id where pf.id = p_target_id;
  if target.who_can_crush = 'verified'
     and not exists (select 1 from profiles pf where pf.id = me and pf.verification = 'verified') then
    perform public.crushly_fail(403, 'verification_required',
      target.name || ' only accepts Add ups from verified members.');
  end if;

  clean_note := case when p_note is null or btrim(p_note) = '' then null else left(btrim(p_note), 140) end;
  already_connected := public.is_connected_pair(me, p_target_id);

  if already_connected then
    return jsonb_build_object(
      'mutual', true, 'isNew', false, 'request', 'connected',
      'profile', public.load_visible_profile(me, p_target_id)
    );
  end if;

  select * into mine from crushes c where c.from_id = me and c.to_id = p_target_id;
  mine_found := found;

  if mine_found and mine.status = 'pending' then
    -- Already asked and still waiting. Nothing happens, and nothing is said
    -- twice: the screen may show the same state without another notification.
    return jsonb_build_object(
      'mutual', false, 'isNew', false, 'request', 'pending',
      'profile', public.load_visible_profile(me, p_target_id)
    );
  end if;

  if mine_found and mine.status = 'declined'
     and coalesce(mine.responded_at, mine.created_at) > public.now_ms() - cooldown_ms then
    perform public.crushly_fail(429, 'request_cooldown',
      'They declined this Add up. You can ask again in a few days.');
  end if;

  if p_is_deep and not (mine_found and mine.deep) then
    select count(*)::int into used from crushes c
     where c.from_id = me and c.deep and c.created_at > public.now_ms() - 24 * 60 * 60 * 1000;
    if used >= 3 then
      perform public.crushly_fail(429, 'deep_limit',
        'You’ve sent your 3 Big Ups for today. They refresh tomorrow — an ordinary Add up still says plenty.');
    end if;
  end if;

  -- An answer, not another question.
  select c.status into theirs_status from crushes c where c.from_id = p_target_id and c.to_id = me;
  if coalesce(theirs_status, '') = 'pending' then
    update crushes c
       set status = 'accepted', responded_at = public.now_ms()
     where c.from_id = p_target_id and c.to_id = me;
    insert into crushes (from_id, to_id, deep, note, status, responded_at)
      values (me, p_target_id, coalesce(p_is_deep, false), clean_note, 'accepted', public.now_ms())
    on conflict (from_id, to_id) do update
      set deep = crushes.deep or excluded.deep,
          note = coalesce(excluded.note, crushes.note),
          status = 'accepted',
          responded_at = public.now_ms();

    perform public.connect_pair(me, p_target_id);
    -- The person who asked first hears the answer; the person who answered is
    -- looking at the result of their own tap.
    perform public.notify_to(p_target_id, 'mutual', me, null, '');
    return jsonb_build_object(
      'mutual', true, 'isNew', true, 'request', 'accepted',
      'profile', public.load_visible_profile(me, p_target_id)
    );
  end if;

  -- A fresh ask (or a renewal after a decline that has cooled off).
  insert into crushes (from_id, to_id, deep, note, status, created_at, responded_at)
    values (me, p_target_id, coalesce(p_is_deep, false), clean_note, 'pending', public.now_ms(), null)
  on conflict (from_id, to_id) do update
    set deep = crushes.deep or excluded.deep,
        note = coalesce(excluded.note, crushes.note),
        status = 'pending',
        created_at = public.now_ms(),
        responded_at = null;

  delete from passes where from_id = me and to_id = p_target_id;
  perform public.notify_to(p_target_id, case when coalesce(p_is_deep, false) then 'deep_crush' else 'crush' end,
                   me, null, coalesce(clean_note, ''));

  return jsonb_build_object(
    'mutual', false, 'isNew', true, 'request', 'pending',
    'profile', public.load_visible_profile(me, p_target_id)
  );
end $$;

-- --------------------------------------------------------------- answering

/*
 * Accept: they asked, you said yes, and you are connections.
 *
 * Only the person the request was sent to can answer it — the row is found by
 * (from = them, to = me), so there is nothing to guess and nothing to spoof.
 */
create or replace function public.accept_connection_request(p_from_id bigint)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  theirs public.crushes;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  select * into theirs from crushes c
   where c.from_id = p_from_id and c.to_id = me and c.status = 'pending';
  if not found then
    perform public.crushly_fail(404, '', 'That request isn’t waiting for an answer.');
  end if;

  update crushes c set status = 'accepted', responded_at = public.now_ms()
   where c.from_id = p_from_id and c.to_id = me;

  -- A row the other way is the same answer, so it is recorded as one rather
  -- than left looking like a request that was never answered.
  update crushes c set status = 'accepted', responded_at = public.now_ms()
   where c.from_id = me and c.to_id = p_from_id and c.status in ('pending', 'declined');

  perform public.connect_pair(me, p_from_id);
  perform public.notify_to(p_from_id, 'mutual', me, null, '');

  return jsonb_build_object(
    'connected', true,
    'profile', public.load_visible_profile(me, p_from_id)
  );
end $$;

/*
 * Decline: no, and the asking stops.
 *
 * Nothing is sent. A refusal is not news, and a notification that says somebody
 * declined would be a second refusal. The unread request in their centre goes
 * away with it, so the tap that would have opened the request opens nothing.
 */
create or replace function public.decline_connection_request(p_from_id bigint)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.me_id();
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  update crushes c set status = 'declined', responded_at = public.now_ms()
   where c.from_id = p_from_id and c.to_id = me and c.status = 'pending';
  if not found then
    perform public.crushly_fail(404, '', 'That request isn’t waiting for an answer.');
  end if;

  delete from notifications n
   where n.user_id = me and n.kind in ('crush', 'deep_crush')
     and n.actor_id = p_from_id and n.read_at is null;

  return jsonb_build_object('declined', true);
end $$;

/*
 * Cancel: you asked, and you have changed your mind.
 *
 * The row is kept as 'cancelled' so the pair's history stays readable, and the
 * unread request leaves their centre — a withdrawn ask that still rings the
 * bell is the worst of both.
 */
create or replace function public.cancel_connection_request(p_to_id bigint)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.me_id();
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  update crushes c set status = 'cancelled', responded_at = public.now_ms()
   where c.from_id = me and c.to_id = p_to_id and c.status = 'pending';
  if not found then
    perform public.crushly_fail(404, '', 'You don’t have a request waiting with them.');
  end if;

  delete from notifications n
   where n.user_id = p_to_id and n.kind in ('crush', 'deep_crush')
     and n.actor_id = me and n.read_at is null;

  return jsonb_build_object('cancelled', true);
end $$;

-- The old name, kept because it is what installed builds call. Withdrawing a
-- Crush and cancelling an Add up are the same act.
create or replace function public.uncrush_member(p_target_id bigint) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.me_id();
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  if public.is_connected_pair(me, p_target_id) then
    perform public.crushly_fail(400, '', 'You’re already connected. Use “Remove connection” to end it.');
  end if;
  delete from crushes where from_id = me and to_id = p_target_id;
  delete from notifications n
   where n.user_id = p_target_id and n.kind in ('crush', 'deep_crush')
     and n.actor_id = me and n.read_at is null;
  return true;
end $$;

revoke all on function public.accept_connection_request(bigint) from public, anon, authenticated;
revoke all on function public.decline_connection_request(bigint) from public, anon, authenticated;
revoke all on function public.cancel_connection_request(bigint) from public, anon, authenticated;
grant execute on function public.accept_connection_request(bigint) to authenticated, service_role;
grant execute on function public.decline_connection_request(bigint) to authenticated, service_role;
grant execute on function public.cancel_connection_request(bigint) to authenticated, service_role;

-- ---------------------------------------------------------------- the lists

/*
 * Crushes' people side: the requests waiting for you, the ones you are waiting
 * on, and the connections. Same shape as before — only pending rows are
 * requests, and an answered row is no longer either side's business here.
 */
create or replace function public.crushes_feed() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  incoming jsonb;
  outgoing jsonb;
  mutual jsonb;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  with src as (
    select c.created_at as at, p.id as pid,
           row_number() over (order by c.deep desc, c.created_at desc) as rn
      from crushes c join profiles p on p.id = c.from_id
     where c.to_id = me and c.status = 'pending'
       and not public.is_connected_pair(me, p.id)
       and not exists (select 1 from passes x where x.from_id = me and x.to_id = p.id)
       and not public.is_blocked_pair(me, p.id)
       and p.onboarded and p.status = 'active'
  )
  select coalesce(jsonb_agg(public.public_profile(me, src.pid, false) || jsonb_build_object('at', src.at)
                            order by src.rn), '[]'::jsonb)
    into incoming from src;

  with src as (
    select c.created_at as at, p.id as pid,
           row_number() over (order by c.created_at desc) as rn
      from crushes c join profiles p on p.id = c.to_id
     where c.from_id = me and c.status = 'pending'
       and not public.is_connected_pair(me, p.id)
       and not public.is_blocked_pair(me, p.id)
       and p.onboarded and p.status = 'active'
  )
  select coalesce(jsonb_agg(public.public_profile(me, src.pid, false) || jsonb_build_object('at', src.at)
                            order by src.rn), '[]'::jsonb)
    into outgoing from src;

  with src as (
    select k.created_at as at,
           case when k.user_a = me then k.user_b else k.user_a end as pid,
           row_number() over (order by k.created_at desc) as rn
      from connections k
     where k.user_a = me or k.user_b = me
  )
  select coalesce(jsonb_agg(public.public_profile(me, src.pid, false) || jsonb_build_object('at', src.at)
                            order by src.rn), '[]'::jsonb)
    into mutual from src
   where not public.is_blocked_pair(me, src.pid)
     and exists (select 1 from profiles p where p.id = src.pid and p.onboarded and p.status = 'active');

  return jsonb_build_object(
    'incoming', incoming,
    'outgoing', outgoing,
    'mutual', mutual,
    'requestCount', jsonb_array_length(incoming)
  );
end $$;


-- --------------------------------------------- the profile, from one side

create or replace function public.public_profile(p_viewer bigint, p_target bigint, p_full boolean default false)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  r record;
  v record;
  interests jsonb;
  intentions jsonb;
  shared_interests jsonb;
  km double precision;
  my_deep boolean;
  my_note text;
  my_found boolean;
  their_deep boolean;
  their_note text;
  their_found boolean;
  my_status text;
  my_responded bigint;
  their_status text;
  connected boolean;
  can_see_activity boolean;
  result jsonb;
begin
  select p.*, pr.show_distance, pr.show_online, pr.discoverable, pr.profile_visibility,
         pr.who_can_message, pr.who_can_crush, pr.show_age, pr.show_city, pr.incognito
    into r
    from profiles p join privacy pr on pr.user_id = p.id
   where p.id = p_target;
  if not found then
    return null;
  end if;

  select p.lat, p.lng, p.interests, p.intentions, p.verification, pr.show_online
    into v
    from profiles p join privacy pr on pr.user_id = p.id
   where p.id = p_viewer;

  interests := coalesce(r.interests, '[]'::jsonb);
  intentions := coalesce(r.intentions, '[]'::jsonb);
  km := public.distance_km(v.lat, v.lng, r.lat, r.lng);
  connected := public.is_connected_pair(p_viewer, p_target);

  select c.deep, c.note, c.status, c.responded_at into my_deep, my_note, my_status, my_responded
    from crushes c where c.from_id = p_viewer and c.to_id = p_target;
  my_found := found;
  select c.deep, c.note, c.status into their_deep, their_note, their_status
    from crushes c where c.from_id = p_target and c.to_id = p_viewer;
  their_found := found;

  can_see_activity := r.show_online and coalesce(v.show_online, true);

  select coalesce(jsonb_agg(i), '[]'::jsonb) into shared_interests
    from jsonb_array_elements_text(interests) i
   where i in (select jsonb_array_elements_text(coalesce(v.interests, '[]'::jsonb)));

  result := jsonb_build_object(
    'id', r.id,
    'name', r.name,
    'username', nullif(r.username, ''),
    'age', case when r.show_age then public.age_of(r.birthdate) else null end,
    'pronouns', nullif(r.pronouns, ''),
    'city', case when r.show_city then nullif(r.city, '') else null end,
    'verified', r.verification = 'verified',
    -- Which seal, if any. 'verified' is the ordinary one, 'gold' is earned,
    -- 'diamond' belongs to the company account alone.
    'badgeTier', case
      when r.badge_tier = 'diamond' then 'diamond'
      when r.badge_tier = 'gold' then 'gold'
      when r.verification = 'verified' then 'verified'
      else 'none'
    end,
    -- Keep Close, read from this viewer's side: are they keeping you close?
    'keepsYou', exists (select 1 from keeps k where k.keeper_id = p_target and k.kept_id = p_viewer),
    'distance', case when r.show_distance then public.distance_label(km) else null end,
    'online', case when can_see_activity then public.is_online_at(r.last_active_at) else null end,
    'activity', case when can_see_activity then public.activity_label_at(r.last_active_at) else null end,
    'bio', r.bio,
    'intentions', intentions,
    'relationshipIntention', nullif(r.relationship_intention, ''),
    'interests', interests,
    'sharedInterests', shared_interests,
    'photos', public.photos_of(p_target),
    /*
     * Add Up, read from this viewer's side.
     *
     * `sent` and `received` mean *a request is waiting* — they are what draws
     * "Request sent" and the Accept / Decline pair. An accepted request is a
     * connection (`mutual`), and a declined one is neither: `sentStatus` and
     * `receivedStatus` carry the whole truth for the screens that need to say
     * more than a yes or a no ("You asked. They declined. You can ask again
     * in a few days.").
     */
    'crush', jsonb_build_object(
      'sent', my_found and coalesce(my_status, 'pending') = 'pending',
      'sentStatus', my_status,
      'sentDeep', coalesce(my_deep, false),
      'received', their_found and coalesce(their_status, 'pending') = 'pending',
      'receivedStatus', their_status,
      'receivedDeep', coalesce(their_deep, false),
      'note', case when their_found then their_note else null end,
      'respondedAt', my_responded,
      'mutual', connected
    ),
    'canMessage', public.messaging_block_reason(p_viewer, p_target) is null,
    'acceptsCrushes', r.who_can_crush <> 'verified' or (v.verification = 'verified'),
    -- The ring. True only when there is a live Moment THIS viewer may open.
    'hasMoment', exists (
      select 1 from moments m
       where m.user_id = p_target
         and m.expires_at > public.now_ms()
         and public.can_view_moment(m, p_viewer)
    )
  );

  if p_full then
    result := result || jsonb_build_object(
      'languages', coalesce(r.languages, '[]'::jsonb),
      'lifestyle', coalesce(r.lifestyle, '{}'::jsonb),
      'messageBlockReason', public.messaging_block_reason(p_viewer, p_target)
    );
  end if;
  return result;
end $function$;
