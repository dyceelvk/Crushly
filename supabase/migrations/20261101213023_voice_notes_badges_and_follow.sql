-- Voice notes that were never allowed through, the two badge tiers above
-- "verified", and Keep Close travelling with a member into public.

/* ------------------------------------------------------------------ voice */
--
-- A voice note is uploaded as a `messages` file, and `media_extension` decides
-- what a Content-Type is allowed to become. It knew `audio/mp4`, `audio/aac`,
-- `audio/mpeg` and `audio/x-m4a` — and neither of the two types the app itself
-- sends:
--
--   * Chrome records with `audio/webm`, and the web app has always sent exactly
--     that;
--   * the phone app labels its recording `audio/m4a`, which is not a media type
--     anybody registered, so the map missed it too.
--
-- Both came back 415 "That file type is not supported", which is why a voice
-- note never went through on either side. The parameters are stripped first
-- (`;codecs=opus` is part of a recorder's answer, not of the file), and the two
-- missing types are mapped to formats the `messages` kind already accepts.
create or replace function public.media_extension(p_content_type text)
returns text
language sql
immutable
as $function$
  select case lower(trim(split_part(coalesce(p_content_type, ''), ';', 1)))
    when 'image/jpeg' then 'jpg'
    when 'image/jpg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
    when 'image/heic' then 'heic'
    when 'audio/mpeg' then 'mp3'
    when 'audio/mp3' then 'mp3'
    when 'audio/mp4' then 'm4a'
    when 'audio/m4a' then 'm4a'
    when 'audio/x-m4a' then 'm4a'
    when 'audio/aac' then 'm4a'
    -- What a browser's MediaRecorder actually produces, with or without a codec
    -- parameter. A .webm is a container the player already handles, so the file
    -- is stored as one rather than refused.
    when 'audio/webm' then 'webm'
    when 'audio/ogg' then 'ogg'
    when 'audio/wav' then 'wav'
    when 'audio/x-wav' then 'wav'
    when 'video/mp4' then 'mp4'
    when 'video/webm' then 'webm'
    when 'video/quicktime' then 'mov'
    when 'video/x-m4v' then 'mp4'
    else null
  end
$function$;

-- `ogg` and `wav` are voice notes too, but only for the places that take a
-- voice note: a message, or a post inside a Circle.
create or replace function public.media_kind_allows(p_kind text, p_ext text)
returns boolean
language sql
immutable
as $function$
  select case p_kind
    when 'photos'   then p_ext in ('jpg', 'png', 'webp', 'heic')
    when 'moments'  then p_ext in ('jpg', 'png', 'webp', 'heic', 'mp4', 'webm', 'mov')
    when 'posts'    then p_ext in ('jpg', 'png', 'webp', 'heic', 'mp4', 'webm', 'mov')
    when 'messages' then p_ext in ('jpg', 'png', 'webp', 'm4a', 'mp3', 'mp4', 'webm', 'mov', 'ogg', 'wav')
    when 'circles'  then p_ext in ('jpg', 'png', 'webp', 'm4a', 'mp3', 'mp4', 'webm', 'mov', 'ogg', 'wav')
    when 'vibes'    then p_ext in ('mp4', 'webm', 'mov', 'jpg', 'png', 'webp')
    else false
  end
$function$;

-- The per-kind guard inside the ticket repeats the list, so it moves with it.
create or replace function public.media_upload_ticket(p_kind text, p_content_type text, p_bytes integer default 0)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  me bigint := public.me_id();
  v_ext text;
  v_limit int;
  v_path text;
  n int;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  if p_kind is null or p_kind not in ('photos', 'moments', 'messages', 'posts', 'circles', 'vibes') then
    perform public.crushly_fail(400, '', 'Unsupported media kind.');
  end if;

  v_ext := public.media_extension(p_content_type);
  if v_ext is null then
    perform public.crushly_fail(415, '', 'That file type is not supported.');
  end if;
  if not public.media_kind_allows(p_kind, v_ext) then
    perform public.crushly_fail(415, '', case
      when p_kind = 'photos' then 'Photos must be JPEG, PNG or WebP.'
      when p_kind in ('moments', 'posts') then 'That takes a photo or a short clip.'
      when p_kind = 'circles' then 'Circles take photos, voice notes and clips.'
      when p_kind = 'vibes' then 'Vibes are short video clips, with a still for the cover.'
      else 'That file type is not supported.' end);
  end if;

  v_limit := case when p_kind in ('messages', 'circles', 'vibes', 'posts') then 80 * 1024 * 1024 else 8 * 1024 * 1024 end;
  if coalesce(p_bytes, 0) <= 0 then
    perform public.crushly_fail(400, '', 'That file looks empty - try picking it again.');
  elsif p_bytes > v_limit then
    perform public.crushly_fail(413, '', 'That file is too large to send.');
  end if;

  perform 1 from profiles where id = me for update;
  select (select count(*) from photos where user_id = me and created_at > public.now_ms() - 3600 * 1000)
       + (select count(*) from moments where user_id = me and created_at > public.now_ms() - 3600 * 1000)
       + (select count(*) from messages where sender_id = me and created_at > public.now_ms() - 3600 * 1000)
       + (select count(*) from posts where author_id = me and created_at > public.now_ms() - 3600 * 1000)
       + (select count(*) from circle_messages where sender_id = me and created_at > public.now_ms() - 3600 * 1000)
       + (select count(*) from vibes where author_id = me and created_at > public.now_ms() - 3600 * 1000)
    into n;
  if n >= 40 then
    perform public.crushly_fail(429, '', 'That is a lot of uploading - try again in a little while.');
  end if;

  if p_kind = 'photos' and (select count(*) from photos where user_id = me) >= 6 then
    perform public.crushly_fail(400, '', 'You can show up to 6 photos.');
  end if;

  v_path := p_kind || '/' || me::text || '/' || public.now_ms()::text || '-'
    || substr(md5(random()::text || me::text || public.now_ms()::text), 1, 10) || '.' || v_ext;
  insert into media_upload_reservations(path, user_id, bytes) values (v_path, me, p_bytes);
  return jsonb_build_object('path', v_path, 'maxBytes', v_limit, 'extension', v_ext);
end $function$;

/* ----------------------------------------------------------------- badges */
--
-- Two tiers above the badge everybody gets for being verified: a golden seal
-- for members who earn their keep on Crushly, and a diamond for the company's
-- own account, which is a different thing entirely and should never be mistaken
-- for a person who was verified.
alter table public.profiles
  add column if not exists badge_tier text not null default 'none';

alter table public.profiles
  drop constraint if exists profiles_badge_tier_check;
alter table public.profiles
  add constraint profiles_badge_tier_check
  check (badge_tier in ('none', 'verified', 'gold', 'diamond'));

-- The company account, from now on and by handle rather than by id: the test
-- account the product is demonstrated from is @thisisriel.
update public.profiles
   set badge_tier = 'diamond',
       verification = 'verified'
 where lower(username) = 'thisisriel';

/* -------------------------------------------------------------- keep close */
--
-- Keep Close is Crushly's follow: it says "this one, I want to see". A follow
-- that only exists inside a Space is a follow nobody can act on, so the flag
-- now travels with the person into everything they publish — the feed, a
-- Circle, a comment, a Moment — and the app draws a small chip beside their
-- name wherever it appears. `badgeTier` rides along for the same reason: the
-- badge belongs next to the name, and the name is written in one place.
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

  select c.deep, c.note into my_deep, my_note from crushes c
   where c.from_id = p_viewer and c.to_id = p_target;
  my_found := found;
  select c.deep, c.note into their_deep, their_note from crushes c
   where c.from_id = p_target and c.to_id = p_viewer;
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
    'crush', jsonb_build_object(
      'sent', my_found,
      'sentDeep', coalesce(my_deep, false),
      'received', their_found,
      'receivedDeep', coalesce(their_deep, false),
      'note', case when their_found then their_note else null end,
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
