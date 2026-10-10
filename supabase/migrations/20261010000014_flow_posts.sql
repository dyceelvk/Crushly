-- Flow: posts that do not expire.
--
-- Moments are what you share with people you know; they are gone in a day. Flow
-- is what you share to be read — a thought, a photo, an update — by people you
-- have not met yet. It is the difference between talking to your connections
-- and being part of a place.
--
-- Two audiences, and the safe one is the default: a post reaches your
-- Connections, unless you deliberately choose Everyone. Nothing here is
-- readable by someone who is not signed in — not the text, not the photos. That
-- is not an oversight, it is the point: for men who are not out everywhere, a
-- public-facing feed is a risk, not a feature.

create table if not exists public.posts (
  id          bigint generated always as identity primary key,
  author_id   bigint not null references public.profiles(id) on delete cascade,
  body        text not null default '',
  media_url   text,
  audience    text not null default 'connections'
                check (audience in ('connections', 'everyone')),
  created_at  bigint not null default public.now_ms()
);

create index if not exists posts_created_idx on public.posts (created_at desc, id desc);
create index if not exists posts_author_idx on public.posts (author_id, created_at desc);

alter table public.posts enable row level security;

-- Posts are read through flow_feed, which applies the audience and block rules.
-- Direct access is limited to your own, so a stray client query cannot sweep
-- the table.
drop policy if exists posts_select_own on public.posts;
create policy posts_select_own on public.posts
  for select to authenticated using (author_id = public.me_id());

-- Who may read a post, in one place.
create or replace function public.can_view_post(p_post public.posts, p_viewer bigint)
returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if p_viewer is null then return false; end if;
  if p_post.author_id = p_viewer then return true; end if;
  if public.is_blocked_pair(p_viewer, p_post.author_id) then return false; end if;
  if p_post.audience = 'everyone' then
    return exists (
      select 1 from profiles p join privacy pr on pr.user_id = p.id
       where p.id = p_post.author_id and p.onboarded and p.status = 'active'
         and pr.profile_visibility = 'everyone' and not pr.incognito
    );
  end if;
  return public.is_connected_pair(p_viewer, p_post.author_id);
end $$;

-- The Flow: newest first, only what you are allowed to see.
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
     where (p_after is null or po.created_at < (select p2.created_at from posts p2 where p2.id = p_after)
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

create or replace function public.create_post(
  p_body text default '', p_media_url text default null, p_audience text default 'connections'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.me_id();
  clean_body text := left(btrim(coalesce(p_body, '')), 500);
  clean_media text := nullif(coalesce(p_media_url, ''), '');
  new_id bigint;
  n int;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  if clean_body = '' and clean_media is null then
    perform public.crushly_fail(400, '', 'Write something, or add a photo.');
  end if;
  if p_audience not in ('connections', 'everyone') then
    perform public.crushly_fail(400, '', 'Choose who can see this.');
  end if;

  -- A post is not a Moment: it stays. So the ceiling is lower — ten an hour is
  -- more than anyone posts and nowhere near enough to fill a feed.
  select count(*) into n from posts where author_id = me and created_at > public.now_ms() - 3600 * 1000;
  if n >= 10 then
    perform public.crushly_fail(429, '', 'That’s a lot of posting — try again in a little while.');
  end if;

  insert into posts (author_id, body, media_url, audience)
  values (me, clean_body, clean_media, p_audience)
  returning id into new_id;

  return (
    select jsonb_build_object(
      'id', po.id, 'body', po.body, 'mediaUrl', po.media_url, 'audience', po.audience,
      'createdAt', po.created_at, 'author', public.public_profile(me, po.author_id, false), 'mine', true
    )
    from posts po where po.id = new_id
  );
end $$;

create or replace function public.delete_post(p_post_id bigint)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.me_id();
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  delete from posts where id = p_post_id and author_id = me;
  return found;
end $$;

-- Photos on a post live in the same private bucket as everything else, behind
-- the same Worker, so a post that is only for your Connections cannot be
-- fetched by someone who is not one.
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
  if p_kind not in ('photos', 'moments', 'messages', 'posts') then
    perform public.crushly_fail(400, '', 'Unsupported media kind.');
  end if;

  v_ext := public.media_extension(p_content_type);
  if v_ext is null then
    perform public.crushly_fail(415, '', 'That file type isn’t supported.');
  end if;
  if p_kind in ('photos', 'moments', 'posts') and v_ext not in ('jpg', 'png', 'webp') then
    perform public.crushly_fail(415, '', 'Photos must be JPEG, PNG or WebP.');
  end if;

  v_limit := case when p_kind = 'messages' then 25 * 1024 * 1024 else 8 * 1024 * 1024 end;
  if coalesce(p_bytes, 0) <= 0 then
    perform public.crushly_fail(400, '', 'That file looks empty — try picking it again.');
  elsif p_bytes > v_limit then
    perform public.crushly_fail(413, '', 'That file is too large to send.');
  end if;

  select (select count(*) from photos where user_id = me and created_at > public.now_ms() - 3600 * 1000)
       + (select count(*) from moments where user_id = me and created_at > public.now_ms() - 3600 * 1000)
       + (select count(*) from messages where sender_id = me and created_at > public.now_ms() - 3600 * 1000)
       + (select count(*) from posts where author_id = me and created_at > public.now_ms() - 3600 * 1000)
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
  -- Connections-only never leaves the pair.
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

  return jsonb_build_object('allowed', false, 'cacheable', false);
end $$;
