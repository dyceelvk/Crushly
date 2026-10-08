-- Crushly demo community — the port of the old server/scripts/seed.js.
--
-- Applied automatically by `supabase db reset`. Every demo member is a real
-- Supabase Auth account with the password `crushly123`, so you can sign in as
-- two of them in two browsers and test crushes and messaging for real.
--
-- Demo login: daniel@crushly.app / crushly123
--
-- Photos are AI-generated portraits of fictional people. Upload them to the
-- `media` bucket first: node supabase/scripts/seed-storage.mjs

-- ------------------------------------------------------------- auth users

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   last_sign_in_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111101', 'authenticated', 'authenticated',
   'daniel@crushly.app', extensions.crypt('crushly123', extensions.gen_salt('bf')), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111102', 'authenticated', 'authenticated',
   'marcus@crushly.app', extensions.crypt('crushly123', extensions.gen_salt('bf')), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111103', 'authenticated', 'authenticated',
   'tobi@crushly.app', extensions.crypt('crushly123', extensions.gen_salt('bf')), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111104', 'authenticated', 'authenticated',
   'ryan@crushly.app', extensions.crypt('crushly123', extensions.gen_salt('bf')), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111105', 'authenticated', 'authenticated',
   'ade@crushly.app', extensions.crypt('crushly123', extensions.gen_salt('bf')), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111106', 'authenticated', 'authenticated',
   'luca@crushly.app', extensions.crypt('crushly123', extensions.gen_salt('bf')), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111107', 'authenticated', 'authenticated',
   'kelechi@crushly.app', extensions.crypt('crushly123', extensions.gen_salt('bf')), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111108', 'authenticated', 'authenticated',
   'jayden@crushly.app', extensions.crypt('crushly123', extensions.gen_salt('bf')), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111109', 'authenticated', 'authenticated',
   'femi@crushly.app', extensions.crypt('crushly123', extensions.gen_salt('bf')), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111110', 'authenticated', 'authenticated',
   'seun@crushly.app', extensions.crypt('crushly123', extensions.gen_salt('bf')), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, 'email',
       jsonb_build_object('sub', u.id::text, 'email', u.email), now(), now(), now()
  from auth.users u where u.email like '%@crushly.app';

-- --------------------------------------------------------------- members
--
-- (The on_auth_user_created trigger already created blank profile rows;
-- this fills them in and builds the demo social graph.)

create or replace function public.seed_set_member(
  p_auth uuid, p_name text, p_age int, p_month int, p_city text,
  p_lat real, p_lng real, p_pronouns text, p_verified boolean, p_active_hours real,
  p_bio text, p_intentions jsonb, p_rel text, p_interests jsonb, p_languages jsonb, p_lifestyle jsonb
) returns bigint
language plpgsql as $$
declare
  v_id bigint;
  v_year int;
  v_now bigint := public.now_ms();
begin
  -- The demo says "age N": pick the birth year that makes the member exactly N today.
  if (p_month < extract(month from now())::int)
     or (p_month = extract(month from now())::int and 14 <= extract(day from now())::int) then
    v_year := extract(year from now())::int - p_age;
  else
    v_year := extract(year from now())::int - p_age - 1;
  end if;
  update profiles set
    name = p_name,
    birthdate = v_year || '-' || lpad(p_month::text, 2, '0') || '-14',
    pronouns = p_pronouns,
    bio = p_bio,
    city = p_city,
    lat = p_lat,
    lng = p_lng,
    intentions = p_intentions,
    interests = p_interests,
    languages = p_languages,
    relationship_intention = p_rel,
    lifestyle = p_lifestyle,
    verification = case when p_verified then 'verified' else 'none' end,
    onboarded = true,
    is_demo = true,
    last_active_at = v_now - (p_active_hours * 3600000)::bigint,
    updated_at = v_now
  where auth_user_id = p_auth
  returning id into v_id;
  update preferences set age_min = 21, age_max = 40, max_distance = 50 where user_id = v_id;
  return v_id;
end $$;

do $$
declare
  t bigint := public.now_ms();
  h constant bigint := 3600000; -- one hour in ms
  daniel bigint; marcus bigint; tobi bigint; ryan bigint; ade bigint;
  luca bigint; kelechi bigint; jayden bigint; femi bigint; seun bigint;
begin
  daniel := public.seed_set_member('11111111-1111-4111-8111-111111111101', 'Daniel', 27, 2, 'Lekki, Lagos', 6.44, 3.47,
    'he/him', true, 0.1,
    'Golden-hour chaser and amateur chef. Weekends are for long lunches, new playlists and getting lost somewhere new. Looking for someone who can hold a conversation and hold my hand.',
    '["dating","relationship"]', 'Long-term partner',
    '["Travel","Food","Music","Photography","Cooking"]', '["English","Yoruba"]',
    '{"work":"Product designer","height":182,"workout":"Sometimes","drinking":"Socially","smoking":"Never"}');
  marcus := public.seed_set_member('11111111-1111-4111-8111-111111111102', 'Marcus', 24, 9, 'Ikoyi, Lagos', 6.45, 3.43,
    'he/him', true, 0.05,
    'Soft heart, strong coffee. Personal trainer by day, vinyl collector by night. I believe the best dates end with “we should do this again.”',
    '["dating","relationship"]', 'Long-term, open to short',
    '["Music","Fitness","Fashion","Travel","Movies"]', '["English","Igbo"]',
    '{"work":"Personal trainer","height":185,"workout":"Often","drinking":"Rarely","smoking":"Never","zodiac":"Virgo"}');
  tobi := public.seed_set_member('11111111-1111-4111-8111-111111111103', 'Tobi', 26, 7, 'Yaba, Lagos', 6.51, 3.38,
    'he/him', false, 0.02,
    'Making beats you will hear at your cousin’s wedding. Late-night studio sessions, Afrobeats, and long voice notes.',
    '["dating","new_connections","friends"]', 'Still figuring it out',
    '["Music","Afrobeats","Nightlife","Gaming","Art"]', '["English","Yoruba"]',
    '{"work":"Music producer","workout":"Rarely","drinking":"Socially"}');
  ryan := public.seed_set_member('11111111-1111-4111-8111-111111111104', 'Ryan', 28, 11, 'Victoria Island, Lagos', 6.43, 3.42,
    'he/him', true, 3,
    'London-born, Lagos-curious. Here for two years with work and determined to find the best suya in the city. Recommendations (and company) welcome.',
    '["dating","friends"]', 'Short-term, open to long',
    '["Travel","Food","Wine","Books","Football"]', '["English","French"]',
    '{"work":"Consultant","education":"University of Edinburgh","height":179,"drinking":"Socially","pets":"Dog person"}');
  ade := public.seed_set_member('11111111-1111-4111-8111-111111111105', 'Ade', 31, 4, 'Ikoyi, Lagos', 6.46, 3.44,
    'he/him', true, 0.5,
    'Architect. I like clean lines, honest people and Sunday mornings that never end. Ask me about the building I’d save in a fire.',
    '["relationship"]', 'Long-term partner',
    '["Design","Art","Coffee","Books","Travel"]', '["English","Yoruba","French"]',
    '{"work":"Architect","education":"AA School, London","workout":"Sometimes","drinking":"Rarely","smoking":"Never","zodiac":"Taurus"}');
  luca := public.seed_set_member('11111111-1111-4111-8111-111111111106', 'Luca', 29, 6, 'Victoria Island, Lagos', 6.42, 3.41,
    'he/him', false, 8,
    'Milanese designer, adopted Lagosian. Espresso snob, terrible dancer, excellent listener.',
    '["dating","casual"]', 'Something casual',
    '["Fashion","Design","Wine","Art","Dancing"]', '["Italian","English","French"]',
    '{"work":"Fashion designer","drinking":"Socially","smoking":"Socially"}');
  kelechi := public.seed_set_member('11111111-1111-4111-8111-111111111107', 'Kelechi', 29, 1, 'Surulere, Lagos', 6.50, 3.35,
    'he/him', false, 1.5,
    'Big laugh, bigger heart. Football on Saturdays, church choir on Sundays, jollof debates any day of the week.',
    '["relationship","dating"]', 'Long-term partner',
    '["Fitness","Football","Music","Food","Sports"]', '["English","Igbo"]',
    '{"work":"Civil engineer","height":188,"workout":"Often","drinking":"Never","smoking":"Never"}');
  jayden := public.seed_set_member('11111111-1111-4111-8111-111111111108', 'Jayden', 23, 12, 'Ikeja, Lagos', 6.60, 3.35,
    'he/they', false, 0.03,
    'Final-year comp-sci, part-time anime critic. I will absolutely beat you at Mario Kart, then buy you shawarma to make up for it.',
    '["friends","new_connections","dating"]', 'New friends',
    '["Gaming","Tech","Movies","Music","Food"]', '["English"]',
    '{"education":"UNILAG","workout":"Rarely","drinking":"Rarely"}');
  femi := public.seed_set_member('11111111-1111-4111-8111-111111111109', 'Femi', 25, 3, 'Lekki, Lagos', 6.45, 3.50,
    'he/him', false, 20,
    'Chef de partie with a soft spot for pepper soup and old Fela records. The way to my heart is… well, you know.',
    '["dating","casual","friends"]', 'Short-term, open to long',
    '["Cooking","Food","Music","Afrobeats","Nightlife"]', '["English","Yoruba"]',
    '{"work":"Chef","workout":"Sometimes","drinking":"Socially"}');
  seun := public.seed_set_member('11111111-1111-4111-8111-111111111110', 'Seun', 30, 8, 'Ikoyi, Lagos', 6.45, 3.44,
    'he/him', true, 30,
    'Corporate lawyer who reads poetry on the third mainland bridge. Discreet, warm, and very good at choosing restaurants.',
    '["relationship","dating"]', 'Long-term partner',
    '["Books","Wine","Theatre","Business","Travel"]', '["English","Yoruba","French"]',
    '{"work":"Lawyer","education":"Lagos Law School","height":180,"drinking":"Socially","smoking":"Never","zodiac":"Leo"}');

  -- Photos (uploaded to media/seed/ by scripts/seed-storage.mjs). Tobi and
  -- Seun deliberately have none — same as the original demo.
  insert into photos (user_id, url, position, created_at) values
    (daniel,  'seed/daniel.jpg',    0, t),  (daniel,  'seed/daniel-2.jpg',    1, t),
    (marcus,  'seed/marcus.jpg',    0, t),  (marcus,  'seed/marcus-2.jpg',    1, t),
    (ryan,    'seed/ryan.jpg',      0, t),  (ryan,    'seed/ryan-2.jpg',      1, t),
    (ade,     'seed/ade.jpg',       0, t),  (ade,     'seed/ade-2.jpg',       1, t),
    (luca,    'seed/luca.jpg',      0, t),  (luca,    'seed/luca-2.jpg',      1, t),
    (kelechi, 'seed/kelechi.jpg',   0, t),  (kelechi, 'seed/kelechi-2.jpg',   1, t),
    (jayden,  'seed/jayden.jpg',    0, t),  (jayden,  'seed/jayden-2.jpg',    1, t),
    (femi,    'seed/femi.jpg',      0, t),  (femi,    'seed/femi-2.jpg',      1, t);

  -- ------------------------------------------------------------- crushes
  -- Daniel (the demo account) has people crushing on him — crush back on
  -- Marcus for a Mutual Crush.

  insert into crushes (from_id, to_id, deep, note, created_at) values
    (marcus,  daniel,  false, null, t - 2 * h),
    (kelechi, daniel,  true,  'That rooftop photo. I need the location — and maybe a tour guide?', t - 5 * h),
    (tobi,    daniel,  false, null, t - 9 * h),
    (jayden,  daniel,  false, null, t - 26 * h),
    (daniel,  luca,    false, null, t - 30 * h),
    (daniel,  femi,    false, null, t - 40 * h),
    (luca,    marcus,  false, null, t - 12 * h),
    (femi,    tobi,    false, null, t - 4 * h);

  insert into crushes (from_id, to_id, deep, note, created_at) values
    (daniel, ryan, false, null, t - 51 * h), (ryan, daniel, false, null, t - 50 * h),
    (daniel, ade,  false, null, t - 21 * h), (ade,  daniel, false, null, t - 20 * h),
    (marcus, seun, false, null, t - 71 * h), (seun, marcus, false, null, t - 70 * h);

  insert into connections (user_a, user_b, created_at) values
    (daniel, ryan,   t - 50 * h),
    (ade,    daniel, t - 20 * h),
    (marcus, seun,   t - 70 * h);

  insert into notifications (user_id, kind, actor_id, body, created_at) values
    (daniel, 'crush',      marcus,  '', t - 2 * h),
    (daniel, 'deep_crush', kelechi, 'That rooftop photo. I need the location — and maybe a tour guide?', t - 5 * h),
    (daniel, 'crush',      tobi,    '', t - 9 * h),
    (daniel, 'crush',      jayden,  '', t - 26 * h),
    (luca,   'crush',      daniel,  '', t - 30 * h),
    (femi,   'crush',      daniel,  '', t - 40 * h),
    (marcus, 'crush',      luca,    '', t - 12 * h),
    (tobi,   'crush',      femi,    '', t - 4 * h),
    (daniel, 'mutual',     ryan,    '', t - 50 * h),
    (ryan,   'mutual',     daniel,  '', t - 50 * h),
    (daniel, 'mutual',     ade,     '', t - 20 * h),
    (ade,    'mutual',     daniel,  '', t - 20 * h),
    (marcus, 'mutual',     seun,    '', t - 70 * h),
    (seun,   'mutual',     marcus,  '', t - 70 * h);

  -- ------------------------------------------------------------- chats

  insert into conversations (user_a, user_b, created_at, last_message_at) values
    (daniel, ryan,   t - 31 * h, t - 30 * h + 35 * 60000),
    (ade,    daniel, t - 7 * h,  t - 6 * h + 21 * 60000),
    (marcus, seun,   t - 41 * h, t - 40 * h + 14 * 60000);

  insert into messages (conversation_id, sender_id, kind, body, created_at, read_at)
  select c.id, x.sender, 'text', x.body, x.at,
         case when x.needs_read then x.at + 60000 else null end
    from conversations c,
    lateral (values
      (ryan,   'Okay, I have to ask — where was your second photo taken? That skyline is unreal.', t - 30 * h + 7 * 60000, true),
      (daniel, 'Ha, a rooftop in Lekki. I can show you sometime if you promise not to tell everyone.', t - 30 * h + 14 * 60000, true),
      (ryan,   'Sworn to secrecy. Also still on my quest for the best suya in Lagos. Any leads?', t - 30 * h + 21 * 60000, true),
      (daniel, 'You’re asking a dangerous question. Glover Road, Friday night. Bring an appetite.', t - 30 * h + 28 * 60000, true),
      (ryan,   'It’s a date. Well — a suya date.', t - 30 * h + 35 * 60000, false)
    ) x(sender, body, at, needs_read)
   where c.user_a = least(daniel, ryan) and c.user_b = greatest(daniel, ryan);

  insert into messages (conversation_id, sender_id, kind, body, created_at, read_at)
  select c.id, x.sender, 'text', x.body, x.at,
         case when x.needs_read then x.at + 60000 else null end
    from conversations c,
    lateral (values
      (daniel, 'Your bio got me. Which building would you save in a fire?', t - 6 * h + 7 * 60000, true),
      (ade,    'The National Theatre, no hesitation. It’s a flawed masterpiece — like most good things.', t - 6 * h + 14 * 60000, true),
      (ade,    'Your turn. What’s the meal you’d cook to impress someone?', t - 6 * h + 21 * 60000, false)
    ) x(sender, body, at, needs_read)
   where c.user_a = least(ade, daniel) and c.user_b = greatest(ade, daniel);

  insert into messages (conversation_id, sender_id, kind, body, created_at, read_at)
  select c.id, x.sender, 'text', x.body, x.at, x.at + 60000
    from conversations c,
    lateral (values
      (seun,   'Dinner Thursday?', t - 40 * h + 7 * 60000),
      (marcus, 'Only if I get to pick dessert.', t - 40 * h + 14 * 60000)
    ) x(sender, body, at)
   where c.user_a = least(marcus, seun) and c.user_b = greatest(marcus, seun);

  -- ------------------------------------------------------------- moments
  -- (expire 24h after creation)

  insert into moments (user_id, kind, body, media_url, style, audience, created_at, expires_at) values
    (marcus,  'photo', 'Sunday reset. Who’s joining me for a run tomorrow?', 'seed/marcus-2.jpg',
     'noir', 'everyone', t - 2 * h,  t - 2 * h + 24 * h),
    (tobi,    'text',   'Studio till 3am again. New track drops Friday — be honest with me.', null,
     'crimson', 'everyone', t - 4 * h,  t - 4 * h + 24 * h),
    (ryan,    'photo',  'Wine bar discovery of the year 🍷', 'seed/ryan-2.jpg',
     'noir', 'everyone', t - 6 * h,  t - 6 * h + 24 * h),
    (ade,     'text',   'A city is a conversation between the people who built it and the people who live in it.', null,
     'champagne', 'everyone', t - 3 * h,  t - 3 * h + 24 * h),
    (femi,    'photo',  'Tasting menu night. Pepper soup, reimagined.', 'seed/femi-2.jpg',
     'noir', 'everyone', t - 9 * h,  t - 9 * h + 24 * h),
    (kelechi, 'photo',  'Leg day. Pray for me.', 'seed/kelechi-2.jpg',
     'noir', 'everyone', t - 1 * h,  t - 1 * h + 24 * h),
    (jayden,  'text',   'Hot take: the Lagos traffic is a free podcast-listening session.', null,
     'midnight', 'everyone', t - 11 * h, t - 11 * h + 24 * h);

  -- Align notification times with the events they describe; older ones are
  -- already read.
  update notifications n set created_at = coalesce(
    (select c.created_at from crushes c where c.from_id = n.actor_id and c.to_id = n.user_id), n.created_at)
  where n.kind in ('crush', 'deep_crush', 'mutual');
  update notifications n set read_at = t
  where n.created_at < t - 24 * h or n.kind = 'mutual';
end $$;

drop function public.seed_set_member(uuid, text, int, int, text, real, real, text, boolean, real, text, jsonb, text, jsonb, jsonb, jsonb);
