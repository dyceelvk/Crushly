-- Vibes: short clips that last a fortnight.
--
-- A Moment is a day: here for the people you know, then gone. A Vibe is a
-- short piece of video with a fortnight to live — long enough to say something
-- that is not a mood, short enough that nothing here becomes a permanent
-- record of a member's face and voice. Two weeks is a deliberate number: long
-- enough to be worth posting, short enough that it cannot be used against
-- somebody later.
--
-- The same rules that govern everything else govern these:
--
--   - The audience is chosen per Vibe, and the default is the safe one —
--     Connections, not Everyone.
--   - Cutting someone off hides you from them and them from you, and an
--     expired Vibe is deleted, not merely hidden: the row goes and the file
--     goes with it.
--   - Who watched is visible to the author alone. A view is not a public
--     number, and it is not something other members can browse.
--   - Clips are short. The ceiling is on the file, because that is the only
--     limit the database can actually hold someone to.

create table if not exists public.vibes (
  id          bigint generated always as identity primary key,
  author_id   bigint not null references public.profiles(id) on delete cascade,
  body        text not null default '',
  media_url   text not null,
  cover_url   text,                                  -- a still, so a grid is not all black
  duration_ms integer,                               -- what the phone recorded; never trusted for rules
  audience    text not null default 'connections'
                check (audience in ('connections', 'everyone')),
  created_at  bigint not null default public.now_ms(),
  expires_at  bigint not null
);

create index if not exists vibes_created_idx on public.vibes (created_at desc, id desc);
create index if not exists vibes_author_idx on public.vibes (author_id, created_at desc);
create index if not exists vibes_expires_idx on public.vibes (expires_at);

-- Who watched. Not a public counter: only the author may read it.
create table if not exists public.vibe_views (
  vibe_id     bigint not null references public.vibes(id) on delete cascade,
  viewer_id   bigint not null references public.profiles(id) on delete cascade,
  created_at  bigint not null default public.now_ms(),
  primary key (vibe_id, viewer_id)
);

create index if not exists vibe_views_vibe_idx on public.vibe_views (vibe_id, created_at desc);

alter table public.vibes enable row level security;
alter table public.vibe_views enable row level security;

-- Reads go through vibes_feed, which applies the audience, block and expiry
-- rules. Direct access is limited to your own, as with posts.
drop policy if exists vibes_select_own on public.vibes;
create policy vibes_select_own on public.vibes
  for select to authenticated using (author_id = public.me_id());

drop policy if exists vibe_views_select_own on public.vibe_views;
create policy vibe_views_select_own on public.vibe_views
  for select to authenticated using (viewer_id = public.me_id());

-- A Vibe lives fourteen days. Nothing here is trusted to expire on its own.
create or replace function public.vibe_lifetime_ms() returns bigint
language sql immutable as $$
  select 14::bigint * 24 * 60 * 60 * 1000
$$;

-- Who may watch one, in one place.
create or replace function public.can_view_vibe(p_vibe public.vibes, p_viewer bigint)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  owner record;
begin
  if p_viewer is null then return false; end if;
  if p_vibe.author_id = p_viewer then return true; end if;
  if p_vibe.expires_at <= public.now_ms() then return false; end if;
  if public.is_blocked_pair(p_viewer, p_vibe.author_id) then return false; end if;
  if p_vibe.audience = 'connections' and not public.is_connected_pair(p_viewer, p_vibe.author_id) then return false; end if;
  select p.status, p.onboarded, pr.profile_visibility into owner
    from profiles p join privacy pr on pr.user_id = p.id where p.id = p_vibe.author_id;
  if not found or owner.status <> 'active' or not owner.onboarded then return false; end if;
  if owner.profile_visibility = 'connections'
     and not public.is_connected_pair(p_viewer, p_vibe.author_id) then return false; end if;
  return true;
end $$;

create or replace function public.serialize_vibe(p_vibe public.vibes, p_viewer bigint)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return jsonb_build_object(
    'id', p_vibe.id,
    'body', p_vibe.body,
    'mediaUrl', p_vibe.media_url,
    'coverUrl', p_vibe.cover_url,
    'durationMs', p_vibe.duration_ms,
    'audience', p_vibe.audience,
    'createdAt', p_vibe.created_at,
    'expiresAt', p_vibe.expires_at,
    'author', public.public_profile(p_viewer, p_vibe.author_id, false),
    'mine', p_vibe.author_id = p_viewer,
    'seen', p_vibe.author_id = p_viewer or exists (
      select 1 from vibe_views vv where vv.vibe_id = p_vibe.id and vv.viewer_id = p_viewer
    ),
    'viewCount', case when p_vibe.author_id = p_viewer
      then (select count(*) from vibe_views vv where vv.vibe_id = p_vibe.id)
      else null end
  );
end $$;

-- The Vibes you can watch, newest first.
create or replace function public.vibes_feed(p_limit integer default 30, p_after bigint default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me    bigint := public.me_id();
  items jsonb := '[]'::jsonb;
  r     record;
  vibe  public.vibes;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;

  for r in
    select v.* from vibes v
     where v.expires_at > public.now_ms()
       and (
         p_after is null
         or v.created_at < (select v2.created_at from vibes v2 where v2.id = p_after)
         or (
           v.created_at = (select v2.created_at from vibes v2 where v2.id = p_after)
           and v.id < p_after
         )
       )
     order by v.created_at desc, v.id desc
     limit least(greatest(coalesce(p_limit, 30), 1), 60)
  loop
    -- The loop variable is a record, and a record will not cast itself to a
    -- row type — so the row is fetched again into one before it is judged.
    select * into vibe from vibes where id = r.id;
    if public.can_view_vibe(vibe, me) then
      items := items || jsonb_build_array(public.serialize_vibe(vibe, me));
    end if;
  end loop;

  return jsonb_build_object('items', items);
end $$;

create or replace function public.create_vibe(
  p_body text default '', p_media_url text default null, p_cover_url text default null,
  p_audience text default 'connections', p_duration_ms integer default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me      bigint := public.me_id();
  clean_body text := left(btrim(coalesce(p_body, '')), 200);
  clean_media text := nullif(coalesce(p_media_url, ''), '');
  clean_cover text := nullif(coalesce(p_cover_url, ''), '');
  new_id  bigint;
  vibe    public.vibes;
  n       int;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  if clean_media is null then
    perform public.crushly_fail(400, '', 'A Vibe needs a clip.');
  end if;
  if coalesce(p_audience, 'connections') not in ('connections', 'everyone') then
    perform public.crushly_fail(400, '', 'Choose who can see this.');
  end if;

  -- Video costs us storage and the member his data allowance, so the ceiling
  -- is lower than for photos: five clips an hour is more than anybody posts.
  select count(*) into n from vibes v
   where v.author_id = me and v.created_at > public.now_ms() - 3600 * 1000;
  if n >= 5 then
    perform public.crushly_fail(429, '', 'That’s a lot of clips — try again in a little while.');
  end if;

  insert into vibes (author_id, body, media_url, cover_url, duration_ms, audience, expires_at)
  values (
    me, clean_body, clean_media, clean_cover,
    case when p_duration_ms is null or p_duration_ms < 0 or p_duration_ms > 120000 then null else p_duration_ms end,
    coalesce(p_audience, 'connections'),
    public.now_ms() + public.vibe_lifetime_ms()
  )
  returning id into new_id;

  select * into vibe from vibes where id = new_id;
  return public.serialize_vibe(vibe, me);
end $$;

create or replace function public.delete_vibe(p_vibe_id bigint)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.me_id();
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  delete from vibes v where v.id = p_vibe_id and v.author_id = me;
  return found;
end $$;

create or replace function public.view_vibe(p_vibe_id bigint)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  me   bigint := public.me_id();
  vibe public.vibes;
begin
  select * into vibe from vibes where id = p_vibe_id;
  if not found or not public.can_view_vibe(vibe, me) then
    perform public.crushly_fail(404, '', 'This Vibe has passed.');
  end if;
  if vibe.author_id <> me then
    insert into vibe_views (vibe_id, viewer_id) values (vibe.id, me) on conflict do nothing;
  end if;
  return true;
end $$;

-- Who watched — the author's to see, and nobody else's.
create or replace function public.vibe_viewers(p_vibe_id bigint)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me bigint := public.me_id();
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  if not exists (select 1 from vibes v where v.id = p_vibe_id and v.author_id = me) then
    perform public.crushly_fail(404, '', 'Vibe not found.');
  end if;

  return (
    select jsonb_build_object('items', coalesce(jsonb_agg(
      jsonb_build_object(
        'member', public.public_profile(me, vv.viewer_id, false),
        'viewedAt', vv.created_at
      ) order by vv.created_at desc
    ), '[]'::jsonb))
    from vibe_views vv
    where vv.vibe_id = p_vibe_id and not public.is_blocked_pair(me, vv.viewer_id)
  );
end $$;

-- Expired Vibes are deleted, not filtered — the same promise a Moment makes.
-- A clip somebody saved a link to must stop working when the Vibe ends.
--
-- Mirrors cleanup_expired_moments: the row goes first, then the file, and every
-- attempt is logged so an orphan is visible instead of silent. A Vibe holds two
-- files (the clip and the still in front of it), so both are swept. Files in
-- the external object store are left to that bucket's own lifecycle rule, which
-- needs a rule for the `vibes/` prefix; anything that has not expired is never
-- touched.
create or replace function public.cleanup_expired_vibes(p_limit integer default 200)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_row record;
  v_deleted integer := 0;
  v_path text;
  v_has_storage boolean := to_regclass('storage.objects') is not null;
begin
  for v_row in
    select id, media_url, cover_url
      from public.vibes
     where expires_at <= public.now_ms()
     order by expires_at
     limit greatest(coalesce(p_limit, 200), 1)
  loop
    begin
      delete from public.vibes v where v.id = v_row.id;
      v_deleted := v_deleted + 1;

      foreach v_path in array array[v_row.media_url, v_row.cover_url]
      loop
        v_path := nullif(btrim(coalesce(v_path, '')), '');
        -- Absolute URLs point at the external object store, where the bucket's
        -- lifecycle rule owns deletion. Bare paths are Supabase Storage objects.
        if v_path is not null
           and v_path !~ '^(https?:|file:|blob:|data:)'
           and v_has_storage then
          begin
            delete from storage.objects o
             where o.bucket_id = 'media'
               and o.name = regexp_replace(v_path, '^/+', '');
            insert into public.media_cleanup_log (media_path, reason, ok)
              values (v_path, 'vibe_expired', true);
          exception when others then
            insert into public.media_cleanup_log (media_path, reason, ok, detail)
              values (v_path, 'vibe_expired', false, sqlerrm);
          end;
        end if;
      end loop;
    exception when others then
      -- One bad row must never stop the sweep, and must never be silent.
      insert into public.media_cleanup_log (media_path, reason, ok, detail)
        values (coalesce(v_row.media_url, ''), 'vibe_row', false, sqlerrm);
    end;
  end loop;

  return v_deleted;
end $$;

-- One sweep for both, so the hourly job has a single thing to call.
create or replace function public.cleanup_expired_media()
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return jsonb_build_object(
    'moments', public.cleanup_expired_moments(),
    'vibes', public.cleanup_expired_vibes()
  );
end $$;

-- ------------------------------------------------------------------- media

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
  if p_kind not in ('photos', 'moments', 'messages', 'posts', 'circles', 'vibes') then
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
  -- A Vibe is a clip, or the still that stands in for one. Nothing else.
  if p_kind = 'vibes' and v_ext not in ('mp4', 'webm', 'jpg', 'png', 'webp') then
    perform public.crushly_fail(415, '', 'Vibes are short video clips, with a still for the cover.');
  end if;

  v_limit := case when p_kind in ('messages', 'circles') then 25 * 1024 * 1024
                  when p_kind = 'vibes' then 25 * 1024 * 1024
                  else 8 * 1024 * 1024 end;
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
       + (select count(*) from vibes where author_id = me and created_at > public.now_ms() - 3600 * 1000)
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
  vibe public.vibes;
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

  -- A Vibe's clip, and the still in front of it. Same audience as the Vibe,
  -- and nothing is cached: a clip is not a profile photo.
  if v_kind = 'vibes' then
    select v.* into vibe from vibes v
     where v.media_url = p_path or v.cover_url = p_path
        or (p_url is not null and (v.media_url = p_url or v.cover_url = p_url))
     limit 1;
    if not found then
      return jsonb_build_object('allowed', false, 'cacheable', false);
    end if;
    if not public.can_view_vibe(vibe, me) then
      return jsonb_build_object('allowed', false, 'cacheable', false);
    end if;
    return jsonb_build_object('allowed', true, 'cacheable', false);
  end if;

  return jsonb_build_object('allowed', false, 'cacheable', false);
end $$;

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
  if v_kind not in ('photos', 'moments', 'messages', 'posts', 'circles', 'vibes') or v_folder <> me::text then
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

  if v_kind = 'vibes' and exists (
    select 1 from vibes where media_url = p_path or cover_url = p_path
       or (p_url is not null and (media_url = p_url or cover_url = p_url))
  ) then
    return exists (
      select 1 from vibes where author_id = me
        and (media_url = p_path or cover_url = p_path
             or (p_url is not null and (media_url = p_url or cover_url = p_url)))
    );
  end if;

  -- Nothing references it any more and it sits in your own folder: an orphan
  -- (a photo replaced before it was saved, say) you are allowed to clear.
  return true;
end $$;

revoke all on function public.vibe_lifetime_ms() from public, anon, authenticated;
grant execute on function public.vibe_lifetime_ms() to authenticated, service_role;
revoke all on function public.vibes_feed(integer, bigint) from public, anon, authenticated;
grant execute on function public.vibes_feed(integer, bigint) to authenticated, service_role;
revoke all on function public.create_vibe(text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.create_vibe(text, text, text, text, integer) to authenticated, service_role;
revoke all on function public.delete_vibe(bigint) from public, anon, authenticated;
grant execute on function public.delete_vibe(bigint) to authenticated, service_role;
revoke all on function public.view_vibe(bigint) from public, anon, authenticated;
grant execute on function public.view_vibe(bigint) to authenticated, service_role;
revoke all on function public.vibe_viewers(bigint) from public, anon, authenticated;
grant execute on function public.vibe_viewers(bigint) to authenticated, service_role;

-- The sweeps are infrastructure: nobody signed in to the app may call them.
revoke all on function public.cleanup_expired_vibes(integer) from public, anon, authenticated;
grant execute on function public.cleanup_expired_vibes(integer) to service_role;
revoke all on function public.cleanup_expired_media() from public, anon, authenticated;
grant execute on function public.cleanup_expired_media() to service_role;
