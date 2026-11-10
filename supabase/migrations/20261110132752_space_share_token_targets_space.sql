-- A token names the Space being shared, not necessarily the person sharing it.
--
-- The previous revision minted a token for "me", which would have made every
-- share button on somebody else's Space hand out a link to your own. The target
-- is now explicit and defaults to you.
--
-- Minting is not open to the world: it needs a signed-in member who can already
-- see that Space (load_visible_profile), so a link can never be created for a
-- profile its owner has hidden, and an anonymous crawler never reaches this
-- routine at all. The token stays one per Space, so the link people share is the
-- same one, and revoking it kills every copy in circulation.
create or replace function public.holup_space_share_token(p_target bigint default null) returns text
language plpgsql security definer set search_path=public as $$
declare me bigint := public.me_id(); who bigint := coalesce(p_target, public.me_id()); tok text;
begin
  if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
  if public.load_visible_profile(me, who, false) is null then
    perform public.crushly_fail(404,'','Space not available.'); end if;
  select token into tok from public.space_share_links
   where user_id = who and revoked_at is null;
  if found then return tok; end if;
  tok := replace(gen_random_uuid()::text, '-', '');
  insert into public.space_share_links(user_id, token, created_at, revoked_at)
    values(who, tok, public.now_ms(), null)
  on conflict(user_id) do update
    set token = excluded.token, created_at = excluded.created_at, revoked_at = null
  returning token into tok;
  return tok;
end $$;

-- Revoking is the owner's alone: you cut off links to your own Space.
create or replace function public.holup_revoke_space_share_token() returns boolean
language plpgsql security definer set search_path=public as $$
declare me bigint := public.me_id();
begin
  if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
  update public.space_share_links set revoked_at = public.now_ms()
   where user_id = me and revoked_at is null;
  return found;
end $$;

revoke all on function public.holup_space_share_token(bigint), public.holup_revoke_space_share_token() from public;
grant execute on function public.holup_space_share_token(bigint), public.holup_revoke_space_share_token() to authenticated, service_role;
