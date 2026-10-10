-- Usernames: a stable @handle for every member.
--
-- A first name is not an identity — dozens of members can be called Alex. A
-- handle is how you tell people apart, how you find someone without knowing
-- their name, and how you point at somebody in a post without misspelling
-- them. It also gives us something to show publicly that is not a legal name,
-- which matters for members who are not out everywhere.
--
-- Handles are stored lowercase so that @Alex and @alex cannot both exist and
-- be mistaken for each other. Members keep the right to change theirs, with a
-- day between changes so a handle cannot be used to dodge a block or to
-- impersonate someone one minute at a time.

alter table public.profiles
  add column if not exists username text not null default '',
  add column if not exists username_updated_at bigint;

alter table public.profiles
  drop constraint if exists profiles_username_format;
alter table public.profiles
  add constraint profiles_username_format
  check (username = '' or username ~ '^[a-z0-9_]{3,30}$');

-- Everyone already here gets one: first name, stripped to handle characters,
-- with their id on the end so it cannot collide. e.g. Daniel, 12 → daniel12.
update public.profiles p
   set username = substr(
         lower(regexp_replace(coalesce(nullif(btrim(p.name), ''), 'member'), '[^a-zA-Z0-9_]', '', 'g')),
         1, 16) || p.id::text
 where p.username = '';

create unique index if not exists profiles_username_key on public.profiles (username);
create index if not exists profiles_username_lookup_idx on public.profiles (username)
  where username <> '';

-- Is this handle free? Deliberately says nothing about *who* holds a taken
-- one, so it cannot be used to fish for accounts.
create or replace function public.username_available(p_username text)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v text := lower(btrim(coalesce(p_username, '')));
begin
  if v !~ '^[a-z0-9_]{3,20}$' then return false; end if;
  if v ~ '^[0-9_]+$' then return false; end if;           -- not a row of numbers or underscores
  return not exists (select 1 from profiles p where p.username = v);
end $$;

-- Sets your own handle. Runs as the owner of the function so the format and
-- uniqueness rules cannot be worked around by writing to the table directly.
create or replace function public.set_username(p_username text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  v text := lower(btrim(coalesce(p_username, '')));
  changed bigint;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  if v = '' then
    perform public.crushly_fail(400, '', 'Pick a username.');
  elsif length(v) < 3 then
    perform public.crushly_fail(400, '', 'Usernames are at least 3 characters.');
  elsif length(v) > 20 then
    perform public.crushly_fail(400, '', 'Usernames are at most 20 characters.');
  elsif v ~ '^[0-9_]+$' then
    perform public.crushly_fail(400, '', 'Use at least one letter.');
  elsif v !~ '^[a-z0-9_]+$' then
    perform public.crushly_fail(400, '', 'Letters, numbers and underscores only.');
  end if;

  select p.username_updated_at into changed from profiles p where p.id = me;
  if changed is not null and public.now_ms() - changed < 24 * 60 * 60 * 1000 then
    perform public.crushly_fail(429, '', 'You can change your username once a day.');
  end if;

  if exists (select 1 from profiles p where p.username = v and p.id <> me) then
    perform public.crushly_fail(409, '', 'That username is taken.');
  end if;

  update profiles
     set username = v,
         username_updated_at = case when username = v then username_updated_at else public.now_ms() end,
         updated_at = public.now_ms()
   where id = me;

  return jsonb_build_object('username', v);
end $$;

-- Find a member by handle. Goes through the same visibility rules as opening
-- a Space, so blocked, hidden and paused members are not findable this way.
create or replace function public.profile_by_username(p_username text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  target bigint;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  select p.id into target from profiles p where p.username = lower(btrim(coalesce(p_username, '')));
  if target is null then return null; end if;
  return public.load_visible_profile(me, target, true);
end $$;

-- Handles travel with the profile everywhere it is shown.
create or replace function public.public_profile(p_viewer bigint, p_target bigint, p_full boolean default false)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
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
   where i in (select jsonb_array_elements_text(coalesce(v.interests, '[]'::jsonb));

  result := jsonb_build_object(
    'id', r.id,
    'name', r.name,
    'username', nullif(r.username, ''),
    'age', case when r.show_age then public.age_of(r.birthdate) else null end,
    'pronouns', nullif(r.pronouns, ''),
    'city', case when r.show_city then nullif(r.city, '') else null end,
    'verified', r.verification = 'verified',
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
    'acceptsCrushes', r.who_can_crush <> 'verified' or (v.verification = 'verified')
  );

  if p_full then
    result := result || jsonb_build_object(
      'languages', coalesce(r.languages, '[]'::jsonb),
      'lifestyle', coalesce(r.lifestyle, '{}'::jsonb),
      'messageBlockReason', public.messaging_block_reason(p_viewer, p_target)
    );
  end if;
  return result;
end $$;
