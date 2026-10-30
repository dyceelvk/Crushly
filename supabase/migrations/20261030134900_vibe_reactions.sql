-- 20261030134900 vibe_reactions
--
-- RECONSTRUCTED 2026-10-30 from the live production catalog (columns,
-- pg_constraint, pg_policy, pg_get_functiondef). Idempotent.
--
-- What this migration owns: liking a Vibe.
--   * vibe_reactions table (vibe_id, user_id) — one row per person per Vibe
--   * react_to_vibe(vibe_id, liked)
--   * serialize_vibe() gains `liked` and `likeCount`
--   * can_view_vibe() re-asserted alongside it
--
-- RLS is ON with NO policies, exactly as in production. A Vibe's likes are only
-- ever read through serialize_vibe(), which is SECURITY DEFINER: the client
-- gets a boolean and a count, never the list of who. A select policy here would
-- hand out the identity of everyone who reacted.
--
-- Note the rule react_to_vibe() enforces and the post path does not: you cannot
-- like your own Vibe. Vibes are the broadcast surface, so a self-like is only
-- ever a vanity metric.

create table if not exists public.vibe_reactions (
  vibe_id    bigint not null references public.vibes(id) on delete cascade,
  user_id    bigint not null references public.profiles(id) on delete cascade,
  created_at bigint not null default public.now_ms(),
  primary key (vibe_id, user_id)
);

alter table public.vibe_reactions enable row level security;

create or replace function public.can_view_vibe(p_vibe vibes, p_viewer bigint)
returns boolean
language plpgsql
stable security definer
set search_path to 'public'
as $function$
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
end $function$;

create or replace function public.react_to_vibe(p_vibe_id bigint, p_liked boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare me bigint := public.me_id(); vibe public.vibes;
begin
  if me is null then
    perform public.crushly_fail(401, 'unauthorized', 'Please sign in again.');
  end if;
  select * into vibe from public.vibes where id = p_vibe_id;
  if not found or vibe.expires_at <= public.now_ms() or not public.can_view_vibe(vibe, me) then
    perform public.crushly_fail(404, '', 'That Vibe isn’t available.');
  end if;
  if vibe.author_id = me then
    perform public.crushly_fail(400, '', 'You can’t like your own Vibe.');
  end if;
  if coalesce(p_liked, false) then
    insert into public.vibe_reactions(vibe_id, user_id) values (vibe.id, me) on conflict do nothing;
  else
    delete from public.vibe_reactions where vibe_id = vibe.id and user_id = me;
  end if;
  return jsonb_build_object('liked', coalesce(p_liked, false),
    'likeCount', (select count(*) from public.vibe_reactions where vibe_id = vibe.id));
end $function$;

create or replace function public.serialize_vibe(p_vibe vibes, p_viewer bigint)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  return jsonb_build_object(
    'id', p_vibe.id, 'body', p_vibe.body, 'mediaUrl', p_vibe.media_url,
    'coverUrl', p_vibe.cover_url, 'durationMs', p_vibe.duration_ms,
    'audience', p_vibe.audience, 'createdAt', p_vibe.created_at,
    'expiresAt', p_vibe.expires_at, 'edit', p_vibe.edit,
    'author', public.public_profile(p_viewer, p_vibe.author_id, false),
    'mine', p_vibe.author_id = p_viewer,
    'seen', p_vibe.author_id = p_viewer or exists (
      select 1 from vibe_views vv where vv.vibe_id = p_vibe.id and vv.viewer_id = p_viewer),
    'viewCount', case when p_vibe.author_id = p_viewer
      then (select count(*) from vibe_views vv where vv.vibe_id = p_vibe.id) else null end,
    'liked', case when p_viewer = public.me_id() then exists (
      select 1 from vibe_reactions vr where vr.vibe_id = p_vibe.id and vr.user_id = p_viewer) else false end,
    'likeCount', (select count(*) from vibe_reactions vr where vr.vibe_id = p_vibe.id)
  );
end $function$;

-- Execution grants, matching production pg_proc.proacl.
revoke all on function public.react_to_vibe(bigint, boolean) from public, anon, authenticated;
grant execute on function public.react_to_vibe(bigint, boolean) to authenticated, service_role;

notify pgrst, 'reload schema';
