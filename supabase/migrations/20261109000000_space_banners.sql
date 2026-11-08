-- Space banners are separate from the six profile photos and use the same
-- visibility and block rules. The Worker asks can_view_media on every read.
create table if not exists public.profile_banners (
  user_id bigint primary key references public.profiles(id) on delete cascade,
  url text not null,
  updated_at bigint not null default public.now_ms()
);
alter table public.profile_banners enable row level security;
revoke all on public.profile_banners from public, anon, authenticated;
-- A reservation is used at most once. Keep the reservation for the upload
-- rate window; deleting it immediately would permit unlimited banner uploads.
create table if not exists public.profile_banner_claims (
  path text primary key references public.media_upload_reservations(path) on delete cascade
);
alter table public.profile_banner_claims enable row level security;
revoke all on public.profile_banner_claims from public, anon, authenticated;


create or replace function public.can_manage_media(p_path text, p_url text default null::text)
returns boolean
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  me bigint := public.me_id();
  v_kind text := split_part(ltrim(coalesce(p_path, ''), '/'), '/', 1);
  v_folder text := split_part(ltrim(coalesce(p_path, ''), '/'), '/', 2);
begin
  if me is null or p_path is null or p_path = '' then return false; end if;

  -- Paths are minted server-side as `kind/<profile id>/…`. You may only ever
  -- touch your own folder, checked before anything else — otherwise passing
  -- your own path alongside somebody else's file URL would be enough to
  -- delete their photo.
  if v_kind not in ('photos', 'moments', 'messages', 'posts', 'circles', 'banners') or v_folder <> me::text then
    return false;
  end if;

  -- The same guard on the URL form: both arguments must describe the same file
  -- in your own folder. Without this, your own path paired with somebody else's
  -- file URL would slip past the folder check above.
  if p_url is not null
     and public.media_object_path(p_url) <> p_path then
    return false;
  end if;

  -- A referenced banner is never deletable directly: first replace/remove the
  -- row. This also protects an upload if its save response is lost in transit.
  if v_kind = 'banners' and exists (
    select 1 from public.profile_banners where public.media_object_path(url) = p_path
  ) then return false; end if;

  -- Still referenced? Then only the owner of that row may remove it.
  if v_kind = 'photos' and exists (
    select 1 from photos where public.media_object_path(url) = p_path or (p_url is not null and url = p_url)
  ) then
    return exists (
      select 1 from photos where user_id = me
        and (public.media_object_path(url) = p_path or (p_url is not null and url = p_url))
    );
  end if;

  if v_kind = 'moments' and exists (
    select 1 from moments where public.media_object_path(media_url) = p_path or (p_url is not null and media_url = p_url)
  ) then
    return exists (
      select 1 from moments where user_id = me
        and (public.media_object_path(media_url) = p_path or (p_url is not null and media_url = p_url))
    );
  end if;

  if v_kind = 'messages' and exists (
    select 1 from messages where public.media_object_path(media_url) = p_path or (p_url is not null and media_url = p_url)
  ) then
    return exists (
      select 1 from messages where sender_id = me
        and (public.media_object_path(media_url) = p_path or (p_url is not null and media_url = p_url))
    );
  end if;

  if v_kind = 'posts' and exists (
    select 1 from posts where public.media_object_path(media_url) = p_path or (p_url is not null and media_url = p_url)
  ) then
    return exists (
      select 1 from posts where author_id = me
        and (public.media_object_path(media_url) = p_path or (p_url is not null and media_url = p_url))
    );
  end if;

  if v_kind = 'circles' then
    if exists (
      select 1 from circle_messages where public.media_object_path(media_url) = p_path or (p_url is not null and media_url = p_url)
    ) then
      return exists (
        select 1 from circle_messages where sender_id = me
          and (public.media_object_path(media_url) = p_path or (p_url is not null and media_url = p_url))
      );
    end if;
    -- The cover of a room you started, and nothing else.
    if exists (
      select 1 from circles where public.media_object_path(cover_url) = p_path or (p_url is not null and cover_url = p_url)
    ) then
      return exists (
        select 1 from circles where owner_id = me
          and (public.media_object_path(cover_url) = p_path or (p_url is not null and cover_url = p_url))
      );
    end if;
  end if;

  -- Nothing references it any more and it sits in your own folder: an orphan
  -- (a photo replaced before it was saved, say) you are allowed to clear.
  return true;
end $function$;

create or replace function public.can_view_media(p_path text, p_url text default null::text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  me bigint := public.me_id();
  v_kind text := split_part(ltrim(coalesce(p_path, ''), '/'), '/', 1);
  m public.moments;
  msg public.messages;
  post public.posts;
begin
  if me is null or p_path is null or p_path = ''
     or (p_url is not null and public.media_object_path(p_url) <> p_path) then
    return jsonb_build_object('allowed', false, 'cacheable', false);
  end if;

  if v_kind = 'banners' then
    return jsonb_build_object('allowed', exists (
      select 1 from public.profile_banners b
      join public.profiles pf on pf.id = b.user_id
      join public.privacy pr on pr.user_id = b.user_id
      where public.media_object_path(b.url) = p_path
        and split_part(p_path, '/', 2) = b.user_id::text
        and (b.user_id = me or (
          pf.onboarded and pf.status = 'active'
          and not public.is_blocked_pair(me, b.user_id)
          and (pr.profile_visibility = 'everyone' or public.is_connected_pair(me, b.user_id))
          and (not pr.incognito or public.is_connected_pair(me, b.user_id))
        ))
    ), 'cacheable', false);
  end if;

  if v_kind in ('photos', 'seed') then
    return jsonb_build_object('allowed', exists (
      select 1 from photos ph join profiles pf on pf.id = ph.user_id
        join privacy pr on pr.user_id = pf.id
       where public.media_object_path(ph.url) = p_path
         and (v_kind = 'seed' or split_part(p_path, '/', 2) = ph.user_id::text)
         and (ph.user_id = me or (
           pf.onboarded and pf.status = 'active'
           and not public.is_blocked_pair(me, ph.user_id)
           and (pr.profile_visibility = 'everyone' or public.is_connected_pair(me, ph.user_id))
           and (not pr.incognito or public.is_connected_pair(me, ph.user_id))
         ))
    ), 'cacheable', false);
  end if;

  if v_kind = 'moments' then
    select * into m from moments mo where public.media_object_path(mo.media_url) = p_path
      and split_part(p_path, '/', 2) = mo.user_id::text limit 1;
    if not found and p_url is not null then
      select * into m from moments mo where mo.media_url = p_url
        and split_part(p_path, '/', 2) = mo.user_id::text limit 1;
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
    return jsonb_build_object('allowed', true, 'cacheable', false);
  end if;

  if v_kind = 'messages' then
    select ms.* into msg from messages ms
      join conversations c on c.id = ms.conversation_id
      where public.media_object_path(ms.media_url) = p_path and (c.user_a = me or c.user_b = me)
        and split_part(p_path, '/', 2) = ms.sender_id::text
        and not public.is_blocked_pair(c.user_a, c.user_b)
      limit 1;
    if not found and p_url is not null then
      select ms.* into msg from messages ms
        join conversations c on c.id = ms.conversation_id
        where ms.media_url = p_url and (c.user_a = me or c.user_b = me)
          and split_part(p_path, '/', 2) = ms.sender_id::text
        and not public.is_blocked_pair(c.user_a, c.user_b)
        limit 1;
    end if;
    if not found then
      return jsonb_build_object('allowed', false, 'cacheable', false);
    end if;
    return jsonb_build_object('allowed', true, 'cacheable', false);
  end if;

  -- Media belongs to the original uploader's row, not an arbitrary row that
  -- copied its URL. Visibility is checked again on every request.
  if v_kind = 'posts' then
    select po.* into post from posts po
     where (public.media_object_path(po.media_url) = p_path or (p_url is not null and po.media_url = p_url))
       and split_part(p_path, '/', 2) = po.author_id::text
     limit 1;
    if not found then
      return jsonb_build_object('allowed', false, 'cacheable', false);
    end if;
    if not public.can_view_post(post, me) then
      return jsonb_build_object('allowed', false, 'cacheable', false);
    end if;
    return jsonb_build_object('allowed', true, 'cacheable', false);
  end if;

  -- Inside a Circle: the messages people sent, and the room's cover.
  if v_kind = 'circles' then
    if exists (
      select 1 from circle_messages m2
        join circle_members cm on cm.circle_id = m2.circle_id
       where cm.member_id = me
         and (public.media_object_path(m2.media_url) = p_path or (p_url is not null and m2.media_url = p_url))
         and split_part(p_path, '/', 2) = m2.sender_id::text
         and not public.is_blocked_pair(me, m2.sender_id)
    ) then
      return jsonb_build_object('allowed', true, 'cacheable', false);
    end if;
    if exists (
      select 1 from circles c
        join circle_members cm on cm.circle_id = c.id
       where cm.member_id = me
         and (public.media_object_path(c.cover_url) = p_path or (p_url is not null and c.cover_url = p_url))
         and split_part(p_path, '/', 2) = c.owner_id::text
    ) then
      return jsonb_build_object('allowed', true, 'cacheable', false);
    end if;
    return jsonb_build_object('allowed', false, 'cacheable', false);
  end if;

  return jsonb_build_object('allowed', false, 'cacheable', false);
end $function$;

-- Keep photo limits intact but let one-minute Moment clips upload.
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
  if p_kind is null or p_kind not in ('photos', 'moments', 'messages', 'posts', 'circles', 'banners') then
    perform public.crushly_fail(400, '', 'Unsupported media kind.');
  end if;

  v_ext := public.media_extension(p_content_type);
  if v_ext is null then
    perform public.crushly_fail(415, '', 'That file type is not supported.');
  end if;
  if not public.media_kind_allows(case when p_kind = 'banners' then 'photos' else p_kind end, v_ext) then
    perform public.crushly_fail(415, '', case
      when p_kind in ('photos', 'banners') then 'Photos must be JPEG, PNG or WebP.'
      when p_kind in ('moments', 'posts') then 'That takes a photo or a short clip.'
      when p_kind = 'circles' then 'Circles take photos, voice notes and clips.'
      else 'That file type is not supported.' end);
  end if;

  -- A Moment clip can be up to one minute: give video the same 80 MiB ceiling
  -- as other clips while retaining the 8 MiB ceiling for Moment photos.
  v_limit := case when p_kind in ('messages', 'circles', 'posts')
    or (p_kind = 'moments' and v_ext in ('mp4', 'webm', 'mov'))
    then 80 * 1024 * 1024 else 8 * 1024 * 1024 end;
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
       + (select count(*) from media_upload_reservations where user_id = me and path like 'banners/%' and created_at > public.now_ms() - 3600 * 1000)
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



-- Read a banner only when its bytes would also be readable to this viewer.
create or replace function public.space_banner(p_target_id bigint)
returns text language plpgsql stable security definer set search_path = public as $function$
declare me bigint := public.me_id(); v_url text;
begin
  if me is null then perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.'); end if;
  select url into v_url from public.profile_banners where user_id = p_target_id;
  if v_url is null then return null; end if;
  if coalesce((public.can_view_media(public.media_object_path(v_url), v_url)->>'allowed')::boolean, false) then
    return v_url;
  end if;
  return null;
end $function$;

-- Reservations are minted by the Worker upload ticket; the only acceptable
-- URL is a newly uploaded image in this member's own folder. Row lock makes
-- replacement atomic. Return the previous URL so the client can delete it.
create or replace function public.set_space_banner(p_url text default null)
returns text language plpgsql security definer set search_path = public as $function$
declare me bigint := public.me_id(); old_url text; v_path text;
begin
  if me is null then perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.'); end if;
  perform 1 from public.profiles where id = me for update;
  if p_url is not null then
    v_path := public.media_object_path(p_url);
    if p_url <> 'https://crushly-media.dyceelvk.workers.dev/m/' || v_path
       or split_part(v_path, '/', 1) <> 'banners'
       or split_part(v_path, '/', 2) <> me::text
       or not exists (select 1 from public.media_upload_reservations where path = v_path and user_id = me and created_at > public.now_ms() - 3600000)
       or exists (select 1 from public.profile_banner_claims where path = v_path)
    then perform public.crushly_fail(400, '', 'Please choose a new banner.'); end if;
  end if;
  select url into old_url from public.profile_banners where user_id = me;
  if p_url is null then
    delete from public.profile_banners where user_id = me;
  else
    insert into public.profile_banners(user_id, url, updated_at) values(me, p_url, public.now_ms())
    on conflict(user_id) do update set url = excluded.url, updated_at = excluded.updated_at;
    insert into public.profile_banner_claims(path) values (v_path);
  end if;
  return old_url;
end $function$;
revoke all on function public.space_banner(bigint) from public, anon;
revoke all on function public.set_space_banner(text) from public, anon;
grant execute on function public.space_banner(bigint) to authenticated, service_role;
grant execute on function public.set_space_banner(text) to authenticated, service_role;
