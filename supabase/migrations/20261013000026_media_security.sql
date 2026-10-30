-- 20261013000026 media_security
--
-- RECONSTRUCTED 2026-10-30 from the live production catalog (project
-- yzcssyebozfkmojqqdhc). This migration was applied to production but its file
-- was never committed, so the body below is the current definition of each
-- object recovered via pg_get_functiondef / pg_policy rather than the original
-- authoring text. Replaying it on top of the earlier migrations reproduces the
-- production state; it is written to be idempotent so it is also safe to apply
-- to a database that already has these objects.
--
-- What this migration owns:
--   * media_object_path()  - one canonical way to turn a stored URL into an
--                            object path inside the private `media` bucket.
--   * can_manage_media()   - may I delete/overwrite this object? Folder first,
--                            then "is it still referenced".
--   * can_view_media()     - may I read this object? Re-checks the owning row's
--                            visibility on every request; nothing is cached.
--   * the four storage.objects policies for the `media` bucket.

create or replace function public.media_object_path(p_value text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select regexp_replace(
    ltrim(regexp_replace(split_part(split_part(coalesce(p_value, ''), '?', 1), '#', 1),
      '^https?://[^/]+/', ''), '/'),
    '^(m/|legacy/|storage/v1/object/(public|authenticated)/media/)', '');
$function$;

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
  if v_kind not in ('photos', 'moments', 'messages', 'posts', 'circles', 'vibes') or v_folder <> me::text then
    return false;
  end if;

  -- The same guard on the URL form: both arguments must describe the same file
  -- in your own folder. Without this, your own path paired with somebody else's
  -- file URL would slip past the folder check above.
  if p_url is not null
     and public.media_object_path(p_url) <> p_path then
    return false;
  end if;

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

  if v_kind = 'vibes' and exists (
    select 1 from vibes where public.media_object_path(media_url) = p_path or public.media_object_path(cover_url) = p_path
       or (p_url is not null and (media_url = p_url or cover_url = p_url))
  ) then
    return exists (
      select 1 from vibes where author_id = me
        and (public.media_object_path(media_url) = p_path or public.media_object_path(cover_url) = p_path
             or (p_url is not null and (media_url = p_url or cover_url = p_url)))
    );
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
  vibe public.vibes;
begin
  if me is null or p_path is null or p_path = ''
     or (p_url is not null and public.media_object_path(p_url) <> p_path) then
    return jsonb_build_object('allowed', false, 'cacheable', false);
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

  -- A Vibe's clip, and the still in front of it. Same audience as the Vibe,
  -- and nothing is cached: a clip is not a profile photo.
  if v_kind = 'vibes' then
    select v.* into vibe from vibes v
     where (public.media_object_path(v.media_url) = p_path or public.media_object_path(v.cover_url) = p_path
        or (p_url is not null and (v.media_url = p_url or v.cover_url = p_url)))
       and split_part(p_path, '/', 2) = v.author_id::text
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
end $function$;

-- Storage policies. The `media` bucket is private: every read goes through
-- can_view_media, every write through can_manage_media.
drop policy if exists media_private_read on storage.objects;
create policy media_private_read on storage.objects
  for select to authenticated
  using (bucket_id = 'media' and (can_view_media(name) ->> 'allowed')::boolean);

drop policy if exists media_insert_own on storage.objects;
create policy media_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media' and can_manage_media(name));

drop policy if exists media_update_own on storage.objects;
create policy media_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'media' and can_manage_media(name))
  with check (bucket_id = 'media' and can_manage_media(name));

drop policy if exists media_delete_own on storage.objects;
create policy media_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'media' and can_manage_media(name));

-- Execution grants, matching production pg_proc.proacl.
revoke all on function public.can_manage_media(text, text) from public, anon, authenticated;
grant execute on function public.can_manage_media(text, text) to authenticated, service_role;
revoke all on function public.can_view_media(text, text) from public, anon, authenticated;
grant execute on function public.can_view_media(text, text) to authenticated, service_role;
revoke all on function public.media_object_path(text) from public, anon, authenticated;
grant execute on function public.media_object_path(text) to authenticated, service_role;

notify pgrst, 'reload schema';
