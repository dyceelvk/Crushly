-- A shared Space link must not be a member directory.
--
-- Profile ids are sequential, so a preview answered by id would let anyone
-- enumerate /s/1, /s/2, ... and harvest names, cities and bios with no sign-in.
-- Every member's privacy row defaults to profile_visibility 'everyone', so the
-- visibility gate alone does not protect against that - it was never designed to
-- resist enumeration, only to answer "may this viewer see this profile".
--
-- So a preview is answered by a token the member themselves minted, at the moment
-- they tapped share. Tokens are revocable, one per member, and unguessable; the
-- id never appears in a preview URL.
create table if not exists public.space_share_links (
  user_id    bigint primary key references public.profiles(id) on delete cascade,
  token      text not null unique,
  created_at bigint not null default public.now_ms(),
  revoked_at bigint
);

alter table public.space_share_links enable row level security;

-- No policies at all: this table is only ever read through the two security
-- definer routines below. A member cannot enumerate other members' tokens, and
-- an anonymous visitor cannot read the table.
revoke all on public.space_share_links from public, anon, authenticated;

create or replace function public.holup_space_share_token() returns text
language plpgsql security definer set search_path=public as $$
declare me bigint := public.me_id(); tok text;
begin
  if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
  select token into tok from public.space_share_links
   where user_id = me and revoked_at is null;
  if found then return tok; end if;
  -- gen_random_uuid is core since PostgreSQL 13, so this needs no extension.
  tok := replace(gen_random_uuid()::text, '-', '');
  insert into public.space_share_links(user_id, token, created_at, revoked_at)
    values(me, tok, public.now_ms(), null)
  on conflict(user_id) do update
    set token = excluded.token, created_at = excluded.created_at, revoked_at = null
  returning token into tok;
  return tok;
end $$;

-- Cutting a link off: the member's own toggle. The next share mints a new one.
create or replace function public.holup_revoke_space_share_token() returns boolean
language plpgsql security definer set search_path=public as $$
declare me bigint := public.me_id();
begin
  if me is null then perform public.crushly_fail(401,'unauthorized','Please sign in again.'); end if;
  update public.space_share_links set revoked_at = public.now_ms()
   where user_id = me and revoked_at is null;
  return found;
end $$;

-- The anonymous card. Same shape as before, but reached only by holding a token.
-- Still gated on the member's own choices, so withdrawing visibility withdraws
-- the card even while a link is in circulation.
create or replace function public.public_space_preview(p_token text)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'id', p.id,
    'name', nullif(p.name, ''),
    'username', nullif(p.username, ''),
    'city', case when pr.show_city then nullif(p.city, '') else null end,
    'bio', nullif(left(coalesce(p.bio, ''), 200), ''),
    'verified', p.verification = 'verified',
    'badgeTier', case
      when p.badge_tier = 'diamond' then 'diamond'
      when p.badge_tier = 'gold' then 'gold'
      when p.verification = 'verified' then 'verified'
      else 'none'
    end
  )
  from public.space_share_links l
  join public.profiles p on p.id = l.user_id
  join public.privacy pr on pr.user_id = p.id
  where l.token = nullif(trim(p_token), '')
    and l.revoked_at is null
    and p.onboarded
    and p.status = 'active'
    and pr.profile_visibility = 'everyone'
    and not pr.incognito
  limit 1
$$;

-- The id-only version from the previous revision is retired: it was the
-- enumerable form. Dropped rather than left reachable.
drop function if exists public.public_space_preview(bigint);

revoke all on function public.holup_space_share_token(), public.holup_revoke_space_share_token(), public.public_space_preview(text) from public;
grant execute on function public.holup_space_share_token(), public.holup_revoke_space_share_token() to authenticated, service_role;
grant execute on function public.public_space_preview(text) to anon, authenticated, service_role;
