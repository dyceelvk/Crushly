-- Circles: a small room of your own.
--
-- A Circle is a private group — up to twelve people — with its own posts and
-- its own conversation. Not a forum, not a public feed: a room. You start one,
-- or someone you have Clicked with brings you into theirs, and what is said in
-- it stays in it.
--
-- The shape of it, and why:
--
--   - Membership is the whole permission. There are no roles that see more,
--     no moderators, no anonymous reading. You are in the Circle or you are
--     not, and if you are not, the posts and the messages do not exist for
--     you — not in the feed, not by direct query, not as a photo URL.
--   - You can only bring in somebody you have Clicked with, and only twelve
--     people fit. A room stays a room.
--   - Cutting someone off still works inside a Circle: their words stop
--     reaching you and yours stop reaching them, even though you share it.
--   - A post can go to a Circle instead of to your Connections or to Everyone.
--     It then appears in that Circle and nowhere else — not in the Flow.
--   - Leaving hands the room to the person who has been in it longest, so one
--     member walking out does not delete everybody else's conversation.

create table if not exists public.circles (
  id          bigint generated always as identity primary key,
  owner_id    bigint not null references public.profiles(id) on delete cascade,
  name        text not null,
  about       text not null default '',
  cover_url   text,
  created_at  bigint not null default public.now_ms(),
  constraint circles_name_length check (char_length(btrim(name)) between 2 and 40),
  constraint circles_about_length check (char_length(about) <= 160)
);

create table if not exists public.circle_members (
  circle_id   bigint not null references public.circles(id) on delete cascade,
  member_id   bigint not null references public.profiles(id) on delete cascade,
  role        text not null default 'member' check (role in ('owner', 'member')),
  muted       boolean not null default false,
  joined_at   bigint not null default public.now_ms(),
  last_read_at bigint not null default 0,
  primary key (circle_id, member_id)
);

create index if not exists circle_members_member_idx on public.circle_members (member_id, joined_at desc);

create table if not exists public.circle_messages (
  id          bigint generated always as identity primary key,
  circle_id   bigint not null references public.circles(id) on delete cascade,
  sender_id   bigint not null references public.profiles(id) on delete cascade,
  kind        text not null default 'text' check (kind in ('text', 'photo', 'voice')),
  body        text not null default '',
  media_url   text,
  created_at  bigint not null default public.now_ms()
);

create index if not exists circle_messages_circle_idx on public.circle_messages (circle_id, id desc);

alter table public.circles enable row level security;
alter table public.circle_members enable row level security;
alter table public.circle_messages enable row level security;

-- Everything is read through the functions below, which apply the membership
-- and block rules. Direct access is limited to Circles you are in, so a stray
-- client query cannot walk someone else's room.
-- The one question every Circle rule boils down to.
create or replace function public.is_circle_member(p_circle_id bigint, p_member_id bigint default null)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from circle_members cm
     where cm.circle_id = p_circle_id
       and cm.member_id = coalesce(p_member_id, public.me_id())
  )
$$;

-- The three policies below ask the same question, and they ask it through
-- is_circle_member() on purpose. A policy that reads circle_members to decide
-- who may read circle_members is infinite recursion — Postgres evaluates that
-- subquery under the very policy it is writing. The helper is security
-- definer, so the lookup happens as the table owner and skips RLS entirely.
drop policy if exists circles_select_member on public.circles;
create policy circles_select_member on public.circles
  for select to authenticated using (public.is_circle_member(circles.id));

drop policy if exists circle_members_select_member on public.circle_members;
create policy circle_members_select_member on public.circle_members
  for select to authenticated using (public.is_circle_member(circle_members.circle_id));

drop policy if exists circle_messages_select_member on public.circle_messages;
create policy circle_messages_select_member on public.circle_messages
  for select to authenticated using (public.is_circle_member(circle_messages.circle_id));

-- A post may belong to a Circle instead of to an audience of people.
alter table public.posts add column if not exists circle_id bigint references public.circles(id) on delete cascade;
create index if not exists posts_circle_idx on public.posts (circle_id, created_at desc, id desc);

alter table public.posts drop constraint if exists posts_audience_check;
alter table public.posts add constraint posts_audience_check
  check (audience in ('connections', 'everyone', 'circle'));

-- A Circle post carries its Circle; anything else carries none. The two cannot
-- disagree — otherwise a post could be filed under a Circle and still be
-- judged as visible to every Connection.
alter table public.posts drop constraint if exists posts_circle_pairing;
alter table public.posts add constraint posts_circle_pairing
  check ((audience = 'circle') = (circle_id is not null));

-- Who may read a post, in one place — now including Circle posts.
create or replace function public.can_view_post(p_post public.posts, p_viewer bigint)
returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if p_viewer is null then return false; end if;
  if p_post.author_id = p_viewer then return true; end if;
  if public.is_blocked_pair(p_viewer, p_post.author_id) then return false; end if;
  if p_post.audience = 'circle' then
    return public.is_circle_member(p_post.circle_id, p_viewer);
  end if;
  if p_post.audience = 'everyone' then
    return exists (
      select 1 from profiles p join privacy pr on pr.user_id = p.id
       where p.id = p_post.author_id and p.onboarded and p.status = 'active'
         and pr.profile_visibility = 'everyone' and not pr.incognito
    );
  end if;
  return public.is_connected_pair(p_viewer, p_post.author_id);
end $$;

-- The Flow: newest first, only what you are allowed to see. Circle posts are
-- not part of it — they were written for a room, not for a square.
create or replace function public.flow_feed(p_limit integer default 20, p_after bigint default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  items jsonb := '[]'::jsonb;
  r record;
  post public.posts;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  for r in
    select po.* from posts po
     where po.circle_id is null
       and (p_after is null or po.created_at < (select p2.created_at from posts p2 where p2.id = p_after)
                             or (po.created_at = (select p2.created_at from posts p2 where p2.id = p_after) and po.id < p_after))
     order by po.created_at desc, po.id desc
     limit least(greatest(coalesce(p_limit, 20), 1), 50)
  loop
    -- The loop variable is a record, and a record will not cast itself to a
    -- row type — so the row is fetched again into one before it is judged.
    select * into post from posts where id = r.id;
    if public.can_view_post(post, me) then
      items := items || jsonb_build_array(
        jsonb_build_object(
          'id', r.id,
          'body', r.body,
          'mediaUrl', r.media_url,
          'audience', r.audience,
          'createdAt', r.created_at,
          'author', public.public_profile(me, r.author_id, false),
          'mine', r.author_id = me
        )
      );
    end if;
  end loop;

  return jsonb_build_object('items', items);
end $$;

drop function if exists public.create_post(text, text, text);

create or replace function public.create_post(
  p_body text default '', p_media_url text default null, p_audience text default 'connections',
  p_circle_id bigint default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  clean_body text := left(btrim(coalesce(p_body, '')), 500);
  clean_media text := nullif(coalesce(p_media_url, ''), '');
  v_audience text;
  new_id bigint;
  n int;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  if clean_body = '' and clean_media is null then
    perform public.crushly_fail(400, '', 'Write something, or add a photo.');
  end if;

  if p_circle_id is not null then
    if not public.is_circle_member(p_circle_id, me) then
      perform public.crushly_fail(403, '', 'You’re not in that Circle.');
    end if;
    v_audience := 'circle';
  elsif p_audience in ('connections', 'everyone') then
    v_audience := p_audience;
  else
    perform public.crushly_fail(400, '', 'Choose who can see this.');
  end if;

  -- A post is not a Moment: it stays. So the ceiling is lower — ten an hour is
  -- more than anyone posts and nowhere near enough to fill a feed.
  select count(*) into n from posts where author_id = me and created_at > public.now_ms() - 3600 * 1000;
  if n >= 10 then
    perform public.crushly_fail(429, '', 'That’s a lot of posting — try again in a little while.');
  end if;

  insert into posts (author_id, body, media_url, audience, circle_id)
  values (me, clean_body, clean_media, v_audience, case when v_audience = 'circle' then p_circle_id end)
  returning id into new_id;

  return (
    select jsonb_build_object(
      'id', po.id, 'body', po.body, 'mediaUrl', po.media_url, 'audience', po.audience,
      'circleId', po.circle_id, 'createdAt', po.created_at,
      'author', public.public_profile(me, po.author_id, false), 'mine', true
    )
    from posts po where po.id = new_id
  );
end $$;

-- The Circles you are in, newest activity first, with what the tab needs to
-- show a badge without opening each one.
create or replace function public.my_circles()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
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
        'createdAt', c.created_at,
        'ownerId', c.owner_id,
        'myRole', cm.role,
        'muted', cm.muted,
        'memberCount', (select count(*) from circle_members m where m.circle_id = c.id),
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
end $$;

-- One Circle: the room itself, and everybody in it.
create or replace function public.circle_space(p_circle_id bigint)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me bigint := public.me_id();
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  if not public.is_circle_member(p_circle_id, me) then
    perform public.crushly_fail(404, '', 'Circle not found.');
  end if;

  return (
    select jsonb_build_object(
      'circle', jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'about', c.about,
        'coverUrl', c.cover_url,
        'createdAt', c.created_at,
        'ownerId', c.owner_id,
        'myRole', (select cm0.role from circle_members cm0 where cm0.circle_id = c.id and cm0.member_id = me),
        'muted', (select cm0.muted from circle_members cm0 where cm0.circle_id = c.id and cm0.member_id = me),
        'memberCount', (select count(*) from circle_members m where m.circle_id = c.id)
      ),
      'members', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'member', public.public_profile(me, m.member_id, false),
            'role', m.role,
            'joinedAt', m.joined_at
          ) order by m.role, m.joined_at, m.member_id
        )
        from circle_members m
        where m.circle_id = c.id and not public.is_blocked_pair(me, m.member_id)
      ), '[]'::jsonb)
    )
    from circles c where c.id = p_circle_id
  );
end $$;

create or replace function public.create_circle(
  p_name text, p_about text default '', p_member_ids bigint[] default '{}'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  v_name text := btrim(coalesce(p_name, ''));
  v_about text := left(btrim(coalesce(p_about, '')), 160);
  v_id bigint;
  v_total int;
  target bigint;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  if char_length(v_name) < 2 then
    perform public.crushly_fail(400, '', 'Give your Circle a name.');
  end if;
  if char_length(v_name) > 40 then
    perform public.crushly_fail(400, '', 'That name is too long — keep it under 40 characters.');
  end if;
  if (select count(*) from circles c where c.owner_id = me) >= 10 then
    perform public.crushly_fail(429, '', 'You have enough Circles for now.');
  end if;

  insert into circles (owner_id, name, about) values (me, v_name, v_about) returning id into v_id;
  insert into circle_members (circle_id, member_id, role) values (v_id, me, 'owner');

  -- Only people you have Clicked with, and only up to twelve in the room.
  v_total := 1;
  if p_member_ids is not null then
    foreach target in array p_member_ids
    loop
      exit when v_total >= 12;
      if target is null or target = me then continue; end if;
      if exists (select 1 from circle_members m where m.circle_id = v_id and m.member_id = target) then continue; end if;
      if not public.is_connected_pair(me, target) then continue; end if;
      if public.is_blocked_pair(me, target) then continue; end if;
      insert into circle_members (circle_id, member_id, role) values (v_id, target, 'member');
      v_total := v_total + 1;
    end loop;
  end if;

  return public.circle_space(v_id);
end $$;

create or replace function public.rename_circle(p_circle_id bigint, p_name text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  v_name text := btrim(coalesce(p_name, ''));
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  if char_length(v_name) between 2 and 40 then
    update circles c set name = v_name
     where c.id = p_circle_id and c.owner_id = me;
    if not found then
      perform public.crushly_fail(404, '', 'Only the member who started a Circle can rename it.');
    end if;
    return true;
  end if;
  perform public.crushly_fail(400, '', 'Give your Circle a name of 2 to 40 characters.');
  return false;
end $$;

create or replace function public.delete_circle(p_circle_id bigint)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.me_id();
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  delete from circles c where c.id = p_circle_id and c.owner_id = me;
  if not found then
    perform public.crushly_fail(404, '', 'Only the member who started a Circle can close it.');
  end if;
  return true;
end $$;

-- Bringing somebody in is a small thing to ask and a big thing to have done
-- to you, so it is limited to people you have already Clicked with.
create or replace function public.add_circle_member(p_circle_id bigint, p_member_id bigint)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  n int;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  if not public.is_circle_member(p_circle_id, me) then
    perform public.crushly_fail(404, '', 'Circle not found.');
  end if;
  if p_member_id is null or p_member_id = me then
    perform public.crushly_fail(400, '', 'Pick somebody to bring in.');
  end if;
  if public.is_blocked_pair(me, p_member_id) then
    perform public.crushly_fail(403, '', 'You can’t bring this member into a Circle.');
  end if;
  if not public.is_connected_pair(me, p_member_id) then
    perform public.crushly_fail(403, '', 'You can only bring in members you’ve Clicked with.');
  end if;

  select count(*) into n from circle_members m where m.circle_id = p_circle_id;
  if n >= 12 then
    perform public.crushly_fail(400, '', 'A Circle holds twelve people — this one is full.');
  end if;

  insert into circle_members (circle_id, member_id, role) values (p_circle_id, p_member_id, 'member')
    on conflict do nothing;
  return true;
end $$;

create or replace function public.remove_circle_member(p_circle_id bigint, p_member_id bigint)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  v_role text;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  select cm.role into v_role from circle_members cm where cm.circle_id = p_circle_id and cm.member_id = me;
  if v_role is null then
    perform public.crushly_fail(404, '', 'Circle not found.');
  end if;
  if p_member_id <> me and v_role <> 'owner' then
    perform public.crushly_fail(403, '', 'Only the member who started a Circle can remove somebody from it.');
  end if;
  delete from circle_members cm
   where cm.circle_id = p_circle_id and cm.member_id = p_member_id and cm.role <> 'owner';
  if not found then
    perform public.crushly_fail(400, '', 'That member can’t be removed from this Circle.');
  end if;
  return true;
end $$;

-- Leaving does not close the room behind you. If you started it and others are
-- still in it, it passes to whoever has been there longest.
create or replace function public.leave_circle(p_circle_id bigint)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  v_role text;
  v_heir bigint;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  select cm.role into v_role from circle_members cm where cm.circle_id = p_circle_id and cm.member_id = me;
  if v_role is null then
    perform public.crushly_fail(404, '', 'Circle not found.');
  end if;

  delete from circle_members cm where cm.circle_id = p_circle_id and cm.member_id = me;

  if v_role = 'owner' then
    select m.member_id into v_heir
      from circle_members m
     where m.circle_id = p_circle_id
     order by m.joined_at, m.member_id
     limit 1;
    if v_heir is null then
      delete from circles c where c.id = p_circle_id;
    else
      update circle_members m set role = 'owner' where m.circle_id = p_circle_id and m.member_id = v_heir;
      update circles c set owner_id = v_heir where c.id = p_circle_id;
    end if;
  end if;

  return true;
end $$;

-- What a Circle has said and shared. Only members, and nobody you have cut
-- off — a shared room does not cancel a block.
create or replace function public.circle_feed(
  p_circle_id bigint, p_limit integer default 20, p_after bigint default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  items jsonb := '[]'::jsonb;
  r record;
  post public.posts;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  if not public.is_circle_member(p_circle_id, me) then
    perform public.crushly_fail(404, '', 'Circle not found.');
  end if;

  for r in
    select po.* from posts po
     where po.circle_id = p_circle_id
       and (p_after is null or po.created_at < (select p2.created_at from posts p2 where p2.id = p_after)
                             or (po.created_at = (select p2.created_at from posts p2 where p2.id = p_after) and po.id < p_after))
     order by po.created_at desc, po.id desc
     limit least(greatest(coalesce(p_limit, 20), 1), 50)
  loop
    select * into post from posts where id = r.id;
    if public.can_view_post(post, me) then
      items := items || jsonb_build_array(
        jsonb_build_object(
          'id', r.id,
          'body', r.body,
          'mediaUrl', r.media_url,
          'audience', r.audience,
          'circleId', r.circle_id,
          'createdAt', r.created_at,
          'author', public.public_profile(me, r.author_id, false),
          'mine', r.author_id = me
        )
      );
    end if;
  end loop;

  return jsonb_build_object('items', items);
end $$;

create or replace function public.send_circle_message(
  p_circle_id bigint, p_body text default '', p_media_url text default null, p_kind text default 'text'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  clean_body text := left(coalesce(p_body, ''), 2000);
  clean_media text := nullif(coalesce(p_media_url, ''), '');
  v_kind text := coalesce(p_kind, 'text');
  new_id bigint;
  n int;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  if not public.is_circle_member(p_circle_id, me) then
    perform public.crushly_fail(404, '', 'Circle not found.');
  end if;
  if v_kind not in ('text', 'photo', 'voice') then
    perform public.crushly_fail(400, '', 'That message type isn’t supported here.');
  end if;
  if v_kind = 'text' and btrim(clean_body) = '' then
    perform public.crushly_fail(400, '', 'Write something first.');
  end if;
  if v_kind <> 'text' and clean_media is null then
    perform public.crushly_fail(400, '', 'That attachment didn’t come through — try again.');
  end if;

  -- Sixty an hour: a busy room, not a firehose.
  select count(*) into n from circle_messages m
   where m.sender_id = me and m.created_at > public.now_ms() - 3600 * 1000;
  if n >= 60 then
    perform public.crushly_fail(429, '', 'That’s a lot of messages — give it a little while.');
  end if;

  insert into circle_messages (circle_id, sender_id, kind, body, media_url)
  values (p_circle_id, me, v_kind, case when v_kind = 'text' then btrim(clean_body) else '' end, clean_media)
  returning id into new_id;

  update circle_members cm set last_read_at = public.now_ms()
   where cm.circle_id = p_circle_id and cm.member_id = me;

  return (
    select jsonb_build_object(
      'id', m.id, 'circleId', m.circle_id, 'senderId', m.sender_id, 'mine', true,
      'kind', m.kind, 'body', m.body, 'mediaUrl', m.media_url, 'createdAt', m.created_at
    )
    from circle_messages m where m.id = new_id
  );
end $$;

-- Newest last, the way a conversation reads. p_before is a message id: ask for
-- what came before it and you have your "older messages".
create or replace function public.circle_messages(
  p_circle_id bigint, p_limit integer default 30, p_before bigint default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me bigint := public.me_id();
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  if not public.is_circle_member(p_circle_id, me) then
    perform public.crushly_fail(404, '', 'Circle not found.');
  end if;

  return (
    select jsonb_build_object('items', coalesce(jsonb_agg(t.item order by t.created_at, t.id), '[]'::jsonb))
    from (
      select jsonb_build_object(
        'id', m.id, 'circleId', m.circle_id, 'senderId', m.sender_id, 'mine', m.sender_id = me,
        'kind', m.kind, 'body', m.body, 'mediaUrl', m.media_url, 'createdAt', m.created_at
      ) as item, m.created_at, m.id
      from circle_messages m
      where m.circle_id = p_circle_id
        and (p_before is null or m.id < p_before)
        and not public.is_blocked_pair(me, m.sender_id)
      order by m.id desc
      limit least(greatest(coalesce(p_limit, 30), 1), 100)
    ) t
  );
end $$;

-- Marks the room read as of now.
create or replace function public.read_circle(p_circle_id bigint)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.me_id();
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  if not public.is_circle_member(p_circle_id, me) then
    perform public.crushly_fail(404, '', 'Circle not found.');
  end if;
  update circle_members cm set last_read_at = public.now_ms()
   where cm.circle_id = p_circle_id and cm.member_id = me;
  return true;
end $$;

-- Photos and voice notes in a Circle ride in the same private bucket, and the
-- Circle's cover with them.
create or replace function public.media_upload_ticket(
  p_kind text, p_content_type text, p_bytes int default 0
) returns jsonb
language plpgsql security definer set search_path = public as $$
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
  if p_kind not in ('photos', 'moments', 'messages', 'posts', 'circles') then
    perform public.crushly_fail(400, '', 'Unsupported media kind.');
  end if;

  v_ext := public.media_extension(p_content_type);
  if v_ext is null then
    perform public.crushly_fail(415, '', 'That file type isn’t supported.');
  end if;
  if p_kind in ('photos', 'moments', 'posts') and v_ext not in ('jpg', 'png', 'webp') then
    perform public.crushly_fail(415, '', 'Photos must be JPEG, PNG or WebP.');
  end if;
  if p_kind = 'circles' and v_ext not in ('jpg', 'png', 'webp', 'm4a', 'mp3') then
    perform public.crushly_fail(415, '', 'Circles take photos and voice notes.');
  end if;

  v_limit := case when p_kind in ('messages', 'circles') then 25 * 1024 * 1024 else 8 * 1024 * 1024 end;
  if coalesce(p_bytes, 0) <= 0 then
    perform public.crushly_fail(400, '', 'That file looks empty — try picking it again.');
  elsif p_bytes > v_limit then
    perform public.crushly_fail(413, '', 'That file is too large to send.');
  end if;

  select (select count(*) from photos where user_id = me and created_at > public.now_ms() - 3600 * 1000)
       + (select count(*) from moments where user_id = me and created_at > public.now_ms() - 3600 * 1000)
       + (select count(*) from messages where sender_id = me and created_at > public.now_ms() - 3600 * 1000)
       + (select count(*) from posts where author_id = me and created_at > public.now_ms() - 3600 * 1000)
       + (select count(*) from circle_messages where sender_id = me and created_at > public.now_ms() - 3600 * 1000)
    into n;
  if n >= 40 then
    perform public.crushly_fail(429, '', 'That’s a lot of uploading — try again in a little while.');
  end if;

  if p_kind = 'photos' and (select count(*) from photos where user_id = me) >= 6 then
    perform public.crushly_fail(400, '', 'You can show up to 6 photos.');
  end if;

  v_path := p_kind || '/' || me::text || '/' || public.now_ms()::text || '-'
    || substr(md5(random()::text || me::text || public.now_ms()::text), 1, 10) || '.' || v_ext;

  return jsonb_build_object('path', v_path, 'maxBytes', v_limit, 'extension', v_ext);
end $$;

create or replace function public.can_view_media(p_path text, p_url text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  v_kind text := split_part(ltrim(coalesce(p_path, ''), '/'), '/', 1);
  m public.moments;
  msg public.messages;
  post public.posts;
begin
  if me is null then
    return jsonb_build_object('allowed', false, 'cacheable', false);
  end if;

  if v_kind = 'photos' then
    return jsonb_build_object('allowed', true, 'cacheable', true);
  end if;

  if v_kind = 'moments' then
    select * into m from moments mo where mo.media_url = p_path limit 1;
    if not found and p_url is not null then
      select * into m from moments mo where mo.media_url = p_url limit 1;
    end if;
    if not found then
      return jsonb_build_object('allowed', false, 'cacheable', false);
    end if;
    if m.expires_at <= public.now_ms() then
      return jsonb_build_object('allowed', false, 'cacheable', false);
    end if;
    if not public.can_view_moment(m, me) then
      return jsonb_build_object('allowed', false, 'cacheable', false);
    end if;
    return jsonb_build_object('allowed', true, 'cacheable', m.audience = 'everyone');
  end if;

  if v_kind = 'messages' then
    select ms.* into msg from messages ms
      join conversations c on c.id = ms.conversation_id
      where ms.media_url = p_path and (c.user_a = me or c.user_b = me)
      limit 1;
    if not found and p_url is not null then
      select ms.* into msg from messages ms
        join conversations c on c.id = ms.conversation_id
        where ms.media_url = p_url and (c.user_a = me or c.user_b = me)
        limit 1;
    end if;
    if not found then
      return jsonb_build_object('allowed', false, 'cacheable', false);
    end if;
    return jsonb_build_object('allowed', true, 'cacheable', false);
  end if;

  -- A post's photo follows the post: Everyone can be shared and cached,
  -- Connections-only never leaves the pair, and a Circle post stays in the
  -- Circle.
  if v_kind = 'posts' then
    select po.* into post from posts po
     where po.media_url = p_path or (p_url is not null and po.media_url = p_url)
     limit 1;
    if not found then
      return jsonb_build_object('allowed', false, 'cacheable', false);
    end if;
    if not public.can_view_post(post, me) then
      return jsonb_build_object('allowed', false, 'cacheable', false);
    end if;
    return jsonb_build_object('allowed', true, 'cacheable', post.audience = 'everyone' and post.author_id <> me);
  end if;

  -- Inside a Circle: the messages people sent, and the room's cover.
  if v_kind = 'circles' then
    if exists (
      select 1 from circle_messages m2
        join circle_members cm on cm.circle_id = m2.circle_id
       where cm.member_id = me
         and (m2.media_url = p_path or (p_url is not null and m2.media_url = p_url))
         and not public.is_blocked_pair(me, m2.sender_id)
    ) then
      return jsonb_build_object('allowed', true, 'cacheable', false);
    end if;
    if exists (
      select 1 from circles c
        join circle_members cm on cm.circle_id = c.id
       where cm.member_id = me
         and (c.cover_url = p_path or (p_url is not null and c.cover_url = p_url))
    ) then
      return jsonb_build_object('allowed', true, 'cacheable', false);
    end if;
    return jsonb_build_object('allowed', false, 'cacheable', false);
  end if;

  return jsonb_build_object('allowed', false, 'cacheable', false);
end $$;

-- Post photos and Circle files had no rule here at all: their authors could
-- not clear an upload that was never saved.
create or replace function public.can_manage_media(p_path text, p_url text default null)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  v_kind text := split_part(ltrim(coalesce(p_path, ''), '/'), '/', 1);
  v_folder text := split_part(ltrim(coalesce(p_path, ''), '/'), '/', 2);
begin
  if me is null then return false; end if;

  -- Paths are minted server-side as `kind/<profile id>/…`. You may only ever
  -- touch your own folder, checked before anything else — otherwise passing
  -- your own path alongside somebody else's file URL would be enough to
  -- delete their photo.
  if v_kind not in ('photos', 'moments', 'messages', 'posts', 'circles') or v_folder <> me::text then
    return false;
  end if;

  -- The same guard on the URL form: both arguments must describe the same file
  -- in your own folder. Without this, your own path paired with somebody else's
  -- file URL would slip past the folder check above.
  if p_url is not null
     and split_part(ltrim(regexp_replace(p_url, '^https?://[^/]+/', ''), '/'), '/', 2) <> me::text then
    return false;
  end if;

  -- Still referenced? Then only the owner of that row may remove it.
  if v_kind = 'photos' and exists (
    select 1 from photos where url = p_path or (p_url is not null and url = p_url)
  ) then
    return exists (
      select 1 from photos where user_id = me
        and (url = p_path or (p_url is not null and url = p_url))
    );
  end if;

  if v_kind = 'moments' and exists (
    select 1 from moments where media_url = p_path or (p_url is not null and media_url = p_url)
  ) then
    return exists (
      select 1 from moments where user_id = me
        and (media_url = p_path or (p_url is not null and media_url = p_url))
    );
  end if;

  if v_kind = 'messages' and exists (
    select 1 from messages where media_url = p_path or (p_url is not null and media_url = p_url)
  ) then
    return exists (
      select 1 from messages where sender_id = me
        and (media_url = p_path or (p_url is not null and media_url = p_url))
    );
  end if;

  if v_kind = 'posts' and exists (
    select 1 from posts where media_url = p_path or (p_url is not null and media_url = p_url)
  ) then
    return exists (
      select 1 from posts where author_id = me
        and (media_url = p_path or (p_url is not null and media_url = p_url))
    );
  end if;

  if v_kind = 'circles' then
    if exists (
      select 1 from circle_messages where media_url = p_path or (p_url is not null and media_url = p_url)
    ) then
      return exists (
        select 1 from circle_messages where sender_id = me
          and (media_url = p_path or (p_url is not null and media_url = p_url))
      );
    end if;
    -- The cover of a room you started, and nothing else.
    if exists (
      select 1 from circles where cover_url = p_path or (p_url is not null and cover_url = p_url)
    ) then
      return exists (
        select 1 from circles where owner_id = me
          and (cover_url = p_path or (p_url is not null and cover_url = p_url))
      );
    end if;
  end if;

  -- Nothing references it any more and it sits in your own folder: an orphan
  -- (a photo replaced before it was saved, say) you are allowed to clear.
  return true;
end $$;

revoke all on function public.is_circle_member(bigint, bigint) from public, anon, authenticated;
grant execute on function public.is_circle_member(bigint, bigint) to authenticated, service_role;
revoke all on function public.my_circles() from public, anon, authenticated;
grant execute on function public.my_circles() to authenticated, service_role;
revoke all on function public.circle_space(bigint) from public, anon, authenticated;
grant execute on function public.circle_space(bigint) to authenticated, service_role;
revoke all on function public.create_circle(text, text, bigint[]) from public, anon, authenticated;
grant execute on function public.create_circle(text, text, bigint[]) to authenticated, service_role;
revoke all on function public.rename_circle(bigint, text) from public, anon, authenticated;
grant execute on function public.rename_circle(bigint, text) to authenticated, service_role;
revoke all on function public.delete_circle(bigint) from public, anon, authenticated;
grant execute on function public.delete_circle(bigint) to authenticated, service_role;
revoke all on function public.add_circle_member(bigint, bigint) from public, anon, authenticated;
grant execute on function public.add_circle_member(bigint, bigint) to authenticated, service_role;
revoke all on function public.remove_circle_member(bigint, bigint) from public, anon, authenticated;
grant execute on function public.remove_circle_member(bigint, bigint) to authenticated, service_role;
revoke all on function public.leave_circle(bigint) from public, anon, authenticated;
grant execute on function public.leave_circle(bigint) to authenticated, service_role;
revoke all on function public.circle_feed(bigint, integer, bigint) from public, anon, authenticated;
grant execute on function public.circle_feed(bigint, integer, bigint) to authenticated, service_role;
revoke all on function public.send_circle_message(bigint, text, text, text) from public, anon, authenticated;
grant execute on function public.send_circle_message(bigint, text, text, text) to authenticated, service_role;
revoke all on function public.circle_messages(bigint, integer, bigint) from public, anon, authenticated;
grant execute on function public.circle_messages(bigint, integer, bigint) to authenticated, service_role;
revoke all on function public.read_circle(bigint) from public, anon, authenticated;
grant execute on function public.read_circle(bigint) to authenticated, service_role;
revoke all on function public.create_post(text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.create_post(text, text, text, bigint) to authenticated, service_role;
