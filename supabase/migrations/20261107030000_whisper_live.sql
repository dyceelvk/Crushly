-- ============================================================================
-- Whisper, live — 1.0.68
--
-- Three things were missing from Whisper and all three are transport, not
-- product: a message arrived only when a poll asked for it, "being here" was a
-- five-minute guess computed from `last_active_at`, and a Whisper had two
-- visible states (sent, read) because nothing recorded the moment the other
-- phone actually had it.
--
-- So this migration adds transport, and only transport:
--
--   1 · `messages.delivered_at` — the moment the recipient's device had the
--       message. Not a receipt: it says "arrived", never "read".
--   2 · one private Realtime topic per conversation (`whisper:<id>`), with the
--       same authorisation shape the voice calls already use, so typing,
--       recording and presence can ride on it without ever carrying content.
--   3 · `privacy.show_activity` — being seen online and being timestamped are
--       different disclosures, so they get different switches.
--
-- Message *content* never travels over the channel. The channel says "there is
-- something new"; the message itself is still fetched through `get_messages`,
-- where every audience, block and read rule already lives.
-- ============================================================================

-- ------------------------------------------------------------ 1 · delivery

alter table public.messages add column if not exists delivered_at bigint;

-- The recipient's query is "what have I not acknowledged yet, in this thread".
-- A partial index keeps that cheap forever: it only ever holds the few rows
-- between a message being sent and being delivered.
create index if not exists messages_undelivered_idx
  on public.messages (conversation_id, id) where delivered_at is null;

/*
 * Serialisation gains one field, and only for the sender.
 *
 * `deliveredAt` is about *my* message reaching *their* device, so it is the
 * sender's business. A recipient is not told when their own phone received
 * something — that is their own device's knowledge, not a message about them.
 */
create or replace function public.serialize_message(m public.messages, p_viewer bigint, p_show_receipts boolean)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', m.id,
    'conversationId', m.conversation_id,
    'senderId', m.sender_id,
    'mine', m.sender_id = p_viewer,
    'kind', m.kind,
    'body', m.body,
    'mediaUrl', m.media_url,
    'meta', m.meta,
    'createdAt', m.created_at,
    'readAt', case when m.sender_id = p_viewer and not p_show_receipts then null else m.read_at end,
    'deliveredAt', case when m.sender_id = p_viewer then m.delivered_at else null end,
    'reactions', coalesce((
      select jsonb_agg(jsonb_build_object('userId', r.user_id, 'kind', r.kind))
        from message_reactions r where r.message_id = m.id
    ), '[]'::jsonb)
  )
$$;

/*
 * "I have these."
 *
 * Called by the recipient's device the moment the messages arrive — on open, on
 * a realtime nudge, and on returning to the app. Deliberately idempotent: the
 * stamp is the *first* time it was true, so a second call neither moves it nor
 * fails, and re-delivery after a reconnect cannot rewrite history.
 *
 * `p_up_to_id` is optional and defaults to everything in the thread, because
 * the honest thing to record is "I have all of it" rather than the highest id a
 * screen happened to be holding.
 */
create or replace function public.mark_messages_delivered(p_conversation_id bigint, p_up_to_id bigint default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  conv record;
  peer bigint;
  ceiling_id bigint;
  stamped integer;
  highest bigint;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  select * into conv from conversations c where c.id = p_conversation_id;
  if not found or (conv.user_a <> me and conv.user_b <> me) then
    perform public.crushly_fail(404, '', 'Conversation not found.');
  end if;
  peer := case when conv.user_a = me then conv.user_b else conv.user_a end;
  -- A cut-off pair does not get delivery acks either: the thread is over, and
  -- an ack is still a signal that somebody is there.
  if public.is_blocked_pair(me, peer) then
    perform public.crushly_fail(404, '', 'Conversation not found.');
  end if;

  ceiling_id := coalesce(p_up_to_id, 0);
  if ceiling_id <= 0 then
    select max(ms.id) into ceiling_id from messages ms where ms.conversation_id = p_conversation_id;
  end if;
  if ceiling_id is null then
    return jsonb_build_object('upTo', 0, 'count', 0);
  end if;

  with stamped_rows as (
    update messages ms set delivered_at = public.now_ms()
     where ms.conversation_id = p_conversation_id
       and ms.sender_id <> me
       and ms.delivered_at is null
       and ms.id <= ceiling_id
    returning ms.id
  )
  select count(*)::int, max(id) into stamped, highest from stamped_rows;

  return jsonb_build_object('upTo', coalesce(highest, 0), 'count', coalesce(stamped, 0));
end $$;

revoke all on function public.mark_messages_delivered(bigint, bigint) from public, anon, authenticated;
grant execute on function public.mark_messages_delivered(bigint, bigint) to authenticated, service_role;

/*
 * Reading implies having. Anybody who marks a thread read has, by definition,
 * the messages in it — so the delivery stamp is filled in the same statement
 * rather than waiting for a second round trip that might never come.
 */
create or replace function public.mark_conversation_read(p_conversation_id bigint) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  conv record;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  select * into conv from conversations c where c.id = p_conversation_id;
  if not found or (conv.user_a <> me and conv.user_b <> me) then
    perform public.crushly_fail(404, '', 'Conversation not found.');
  end if;
  update messages ms set delivered_at = coalesce(ms.delivered_at, public.now_ms())
   where ms.conversation_id = p_conversation_id and ms.sender_id <> me and ms.delivered_at is null;
  update messages ms set read_at = public.now_ms()
   where ms.conversation_id = p_conversation_id and ms.sender_id <> me and ms.read_at is null;
  update notifications nt set read_at = public.now_ms()
   where nt.user_id = me and nt.kind = 'message' and nt.ref_id = p_conversation_id and nt.read_at is null;
  return true;
end $$;

-- ------------------------------------------------- 2 · the whisper channel

/*
 * One topic per conversation: `whisper:<conversation id>`.
 *
 * Same shape as the private call rooms — a topic the database can authorise,
 * because a topic a client invents is a topic anybody can guess. Nothing secret
 * is in the name: a conversation id is already a number both members know, and
 * knowing it is useless without the row saying you are one of them.
 */
create or replace function public.whisper_topic_conversation(p_topic text) returns bigint
language sql immutable as $$
  select case
    when p_topic ~ '^whisper:[0-9]{1,18}$' then substring(p_topic from 9)::bigint
    else null
  end
$$;

/*
 * Who may listen to and speak on a conversation's channel.
 *
 * A member, of a conversation that is still open, with nobody cut off. That is
 * the whole rule — the same rule `get_messages` already applies to the messages
 * themselves, so the channel can never be wider than the thread it describes.
 */
create or replace function public.can_join_whisper(p_topic text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  conv_id bigint;
  conv record;
  peer bigint;
begin
  if me is null then return false; end if;
  conv_id := public.whisper_topic_conversation(p_topic);
  if conv_id is null then return false; end if;
  select * into conv from conversations c where c.id = conv_id;
  if not found or (conv.user_a <> me and conv.user_b <> me) then return false; end if;
  if conv.closed then return false; end if;
  peer := case when conv.user_a = me then conv.user_b else conv.user_a end;
  return not public.is_blocked_pair(me, peer);
end $$;

revoke all on function public.whisper_topic_conversation(text) from public, anon;
revoke all on function public.can_join_whisper(text) from public, anon;
grant execute on function public.whisper_topic_conversation(text) to authenticated, service_role;
grant execute on function public.can_join_whisper(text) to authenticated, service_role;

-- Supabase supplies realtime.messages and realtime.topic(); the plain-Postgres
-- smoke harness stubs both, so these policies are exercised by the tests too.
drop policy if exists "crushly_whisper_receive" on realtime.messages;
create policy "crushly_whisper_receive" on realtime.messages
  for select to authenticated
  using (extension = 'broadcast' and public.can_join_whisper(realtime.topic()));

drop policy if exists "crushly_whisper_send" on realtime.messages;
create policy "crushly_whisper_send" on realtime.messages
  for insert to authenticated
  with check (extension = 'broadcast' and public.can_join_whisper(realtime.topic()));

-- ------------------------------------------------------- 3 · what presence says

/*
 * Being online and being timestamped are two disclosures, so they are two
 * switches. Default true keeps every existing member exactly as they are today.
 */
alter table public.privacy add column if not exists show_activity boolean not null default true;

/*
 * The header of a Whisper, read once and then kept live by the channel.
 *
 * It answers only what a chat header may ask: are they here, when were they
 * last here, and may I see a tick when they read this. `activity` is null when
 * either side has switched that off, which is the same answer as "unknown" —
 * the screen prints nothing rather than inventing a time.
 */
create or replace function public.peer_presence(p_conversation_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  conv record;
  peer bigint;
  r record;
  v record;
  see_online boolean;
  see_activity boolean;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  select * into conv from conversations c
   where c.id = p_conversation_id and (c.user_a = me or c.user_b = me);
  if not found then
    perform public.crushly_fail(404, '', 'Conversation not found.');
  end if;
  peer := case when conv.user_a = me then conv.user_b else conv.user_a end;

  select p.last_active_at, pr.show_online, pr.show_activity into r
    from profiles p join privacy pr on pr.user_id = p.id where p.id = peer;
  select pr.show_online, pr.show_activity into v from privacy pr where pr.user_id = me;

  see_online := coalesce(r.show_online, true) and coalesce(v.show_online, true);
  see_activity := see_online and coalesce(r.show_activity, true) and coalesce(v.show_activity, true);

  return jsonb_build_object(
    'peerId', peer,
    'online', case when see_online then public.is_online_at(r.last_active_at) else null end,
    'activity', case when see_activity then public.activity_label_at(r.last_active_at) else null end,
    -- Receipts need both sides; the receipt tick is drawn from this, and the
    -- channel's `read` broadcast is only sent when it is true.
    'receipts', public.receipts_visible(me, peer),
    -- Whether this member's own presence may be announced on the channel. It is
    -- my switch about me, so I am the only one who has to allow it.
    'announce', coalesce(v.show_online, true),
    'closed', conv.closed
  );
end $$;

revoke all on function public.peer_presence(bigint) from public, anon, authenticated;
grant execute on function public.peer_presence(bigint) to authenticated, service_role;

-- ------------------------------------- 4 · the Space, with activity gated

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
  can_see_online boolean;
  can_see_activity boolean;
  result jsonb;
begin
  select p.*, pr.show_distance, pr.show_online, pr.show_activity, pr.discoverable,
         pr.profile_visibility, pr.who_can_message, pr.who_can_crush, pr.show_age,
         pr.show_city, pr.incognito
    into r
    from profiles p join privacy pr on pr.user_id = p.id
   where p.id = p_target;
  if not found then
    return null;
  end if;

  select p.lat, p.lng, p.interests, p.intentions, p.verification, pr.show_online, pr.show_activity
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

  /*
   * Two different questions, so two different answers.
   *
   * The dot means "they are here right now"; the label means "they were here at
   * 14:20". Somebody may be happy to be seen online while not wanting to hand
   * out a log of when they were last around — which is why `show_activity` is
   * its own switch and both sides have to allow it, exactly like `show_online`.
   */
  can_see_online := r.show_online and coalesce(v.show_online, true);
  can_see_activity := can_see_online and r.show_activity and coalesce(v.show_activity, true);

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
    'online', case when can_see_online then public.is_online_at(r.last_active_at) else null end,
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
