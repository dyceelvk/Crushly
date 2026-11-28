-- Privacy by default (2026-11-28).
--
-- A member's age, city, distance and zodiac are theirs to show, not ours.
-- Everything that used to be visible unless switched off is now hidden until
-- the member switches it on in Settings → Privacy & visibility. Nobody ever
-- turned these on; the platform did — so this hides them for everyone and the
-- app tells members where the switches live.
--
-- The birthdate itself is untouched: it never leaves the database.

begin;

alter table privacy alter column show_age set default false;
alter table privacy alter column show_city set default false;
alter table privacy alter column show_distance set default false;
alter table privacy add column if not exists show_zodiac boolean not null default false;

update privacy set show_age = false, show_city = false, show_distance = false;

-- public_profile is the only payload that carries the lifestyle facts. The
-- zodiac is a birth-sign: it leaves the database only when the member has
-- asked for it, exactly like the age above.
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
         pr.show_city, pr.incognito, pr.show_zodiac
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
      -- The zodiac is a birth-sign. It travels with the rest of the facts
      -- only when the member has said so.
      'lifestyle', case when coalesce(r.show_zodiac, false)
        then coalesce(r.lifestyle, '{}'::jsonb)
        else coalesce(r.lifestyle, '{}'::jsonb) - 'zodiac' end,
      'messageBlockReason', public.messaging_block_reason(p_viewer, p_target)
    );
  end if;
  return result;
end $function$;

commit;
