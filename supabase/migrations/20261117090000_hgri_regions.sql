-- ============================================================================
-- HGRI 001 — the region registry, member regions and change history
-- ============================================================================
-- One self-referencing table rather than four, because every level answers the
-- same questions (code, name, parent, is it a market) and four tables would mean
-- four sets of policies and four joins that all look alike.
--
--   world → continent → subregion → country
--
-- The registry is reference data: readable by the app so it can show why a
-- country is or is not eligible, writable by nobody but a migration.
--
-- Member regions keep the declared country and the measured country apart. They
-- are allowed to disagree — that is the whole point — and `effective_country_code`
-- is derived from them rather than replacing either.
-- ============================================================================

create table if not exists public.holup_regions (
  id               serial primary key,
  level            text not null check (level in ('world','continent','subregion','country')),
  code             text not null,
  name             text not null,
  iso3             text,
  source_subregion text,
  parent_id        integer references public.holup_regions(id) on delete restrict,
  is_market        boolean not null default true,
  created_at       bigint not null default public.now_ms(),
  unique (level, code)
);
create index if not exists holup_regions_parent_idx on public.holup_regions (parent_id);
create index if not exists holup_regions_level_idx on public.holup_regions (level);

comment on table public.holup_regions is
  'ISO 3166-1 countries grouped by UN M49 subregion, continent and world. Antarctica is classified but is never a market.';

create table if not exists public.holup_user_regions (
  profile_id             bigint primary key references public.profiles(id) on delete cascade,
  -- What the member said, at sign-up or in settings.
  selected_country_code  text,
  -- What the last IP observation actually measured.
  detected_country_code  text,
  -- selected ?? detected. Never silently overwritten by a detection.
  effective_country_code text,
  continent              text,
  subregion              text,
  state_region           text,
  city                   text,
  timezone               text,
  detection_method       text not null default 'IP_GEOLOCATION'
                         check (detection_method in ('IP_GEOLOCATION','MANUAL','ACCOUNT_IMPORT','NONE')),
  detection_confidence   smallint check (detection_confidence between 0 and 100),
  detection_provider     text,
  region_status          text not null default 'UNVERIFIED'
                         check (region_status in ('IDENTIFIED','UNVERIFIED','MISMATCH','SUSPECTED_VPN','NEEDS_REVIEW')),
  last_detected_at       bigint,
  created_at             bigint not null default public.now_ms(),
  updated_at             bigint not null default public.now_ms()
);
create index if not exists holup_user_regions_detected_idx on public.holup_user_regions (detected_country_code);
create index if not exists holup_user_regions_effective_idx on public.holup_user_regions (effective_country_code);
create index if not exists holup_user_regions_continent_idx on public.holup_user_regions (continent);

-- Append-only. A region change is history, not a column that gets overwritten.
create table if not exists public.holup_region_history (
  id                    bigserial primary key,
  profile_id            bigint not null references public.profiles(id) on delete cascade,
  previous_country_code text,
  new_country_code      text,
  previous_continent    text,
  new_continent         text,
  reason                text not null
                        check (reason in ('DETECTION','SELECTION','CORRECTION','TRAVEL','PROVIDER_CHANGE')),
  detection_provider    text,
  detection_confidence  smallint,
  note                  text,
  created_at            bigint not null default public.now_ms()
);
create index if not exists holup_region_history_profile_idx on public.holup_region_history (profile_id, created_at desc);

-- --------------------------------------------------------------- helpers ---
-- The role of the caller, read from holup_admin_members, falling back to the
-- older holup_admins allowlist so existing administrators keep working.
create or replace function public.holup_admin_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select m.role from holup_admin_members m where m.auth_user_id = auth.uid() and m.status = 'active'),
    case when exists (select 1 from holup_admins a where a.auth_user_id = auth.uid()) then 'super_admin' end
  );
$$;

create or replace function public.holup_has_admin_role(roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select coalesce(public.holup_admin_role() = any (roles), false); $$;

-- The caller's own region, for the member-facing settings screen.
create or replace function public.holup_my_region()
returns table (
  selected_country_code text, detected_country_code text, effective_country_code text,
  continent text, subregion text, region_status text, last_detected_at bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select r.selected_country_code, r.detected_country_code, r.effective_country_code,
         r.continent, r.subregion, r.region_status, r.last_detected_at
  from holup_user_regions r
  join profiles p on p.id = r.profile_id
  where p.auth_user_id = auth.uid();
$$;

-- ------------------------------------------------------------------- RLS ---
alter table public.holup_regions        enable row level security;
alter table public.holup_user_regions   enable row level security;
alter table public.holup_region_history enable row level security;

drop policy if exists holup_regions_admin_read on public.holup_regions;
drop policy if exists holup_regions_public_read on public.holup_regions;
drop policy if exists holup_user_regions_admin on public.holup_user_regions;
drop policy if exists holup_region_history_admin on public.holup_region_history;

-- The world row is an implementation detail (it exists to hang continents from);
-- nobody needs to read it.
create policy holup_regions_public_read on public.holup_regions
  for select to anon, authenticated
  using (level <> 'world');

create policy holup_user_regions_admin on public.holup_user_regions
  for select to authenticated
  using (public.holup_is_admin());

create policy holup_region_history_admin on public.holup_region_history
  for select to authenticated
  using (public.holup_is_admin());

-- No client write policies anywhere in this file: regions are written by the
-- region-intel function using server credentials, never by a browser.

grant execute on function public.holup_admin_role() to authenticated;
grant execute on function public.holup_has_admin_role(text[]) to authenticated;
grant execute on function public.holup_my_region() to authenticated;
