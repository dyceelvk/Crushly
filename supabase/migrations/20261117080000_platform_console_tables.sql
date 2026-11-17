-- ============================================================================
-- Platform console, advertising and payments tables — baseline
-- ============================================================================
-- These nine tables exist in the live project but were never written into the
-- migrations directory: they were created directly against the database while
-- the Control Centre was being built. The effect was invisible in production and
-- fatal to the repository's own test suite, which builds a database from the
-- migrations and therefore had no holup_admin_members to alter.
--
-- This file records them as they already are — column names, types, defaults,
-- keys, foreign keys and check constraints taken from the live catalogue — so
-- that a database built from this repository matches the one that is running.
--
-- Everything here is `if not exists`, so applying it to the live project changes
-- nothing. Columns added later by the Sponsored Flow migration are deliberately
-- NOT included here: that migration adds them, and including them in both places
-- would mean the baseline disagrees with itself over time.
-- ============================================================================

-- ------------------------------------------------------------- identities ---
alter table public.profiles
  add column if not exists country_code         text,
  add column if not exists country_source       text,
  add column if not exists country_verified_at  bigint,
  add column if not exists lat                  double precision,
  add column if not exists lng                  double precision;

-- The administrator allowlist the Control Centre reads.
create table if not exists public.holup_admins (
  auth_user_id uuid primary key,
  created_at   bigint not null default public.now_ms()
);

-- Administrator membership, with a role and per-member permissions.
create table if not exists public.holup_admin_members (
  auth_user_id uuid primary key,
  email        text,
  display_name text,
  role         text not null default 'administrator',
  permissions  jsonb not null default '{}'::jsonb,
  status       text not null default 'active',
  invited_by   uuid,
  invited_at   bigint,
  accepted_at  bigint,
  last_seen_at bigint,
  created_at   bigint not null default public.now_ms(),
  updated_at   bigint not null default public.now_ms()
);

alter table public.holup_admin_members drop constraint if exists holup_admin_members_status_check;
alter table public.holup_admin_members
  add constraint holup_admin_members_status_check check (status in ('active','suspended'));

-- The role vocabulary. The HGRI RBAC migration replaces this with a constraint
-- that also carries the security/monetisation/advertising/analytics roles; both
-- files agree on the five roles the console already used.
alter table public.holup_admin_members drop constraint if exists holup_admin_members_role_check;
alter table public.holup_admin_members
  add constraint holup_admin_members_role_check check (role in (
    'super_admin','administrator','verification_officer','moderator','analyst','support_officer',
    'security_admin','fraud_investigator','monetisation_admin','advertising_admin','analytics_admin'));

-- Append-only audit trail for administrative actions. Every `holup_cc_*` action
-- and every HGRI admin function writes here.
create table if not exists public.holup_admin_audit (
  id          bigserial primary key,
  actor       uuid,
  actor_email text,
  actor_label text,
  actor_role  text,
  module      text not null,
  action      text not null,
  target_type text,
  target_id   text,
  before      jsonb,
  after       jsonb,
  result      text not null default 'success',
  detail      text,
  ip          text,
  user_agent  text,
  created_at  bigint not null default public.now_ms()
);
create index if not exists holup_admin_audit_created_idx on public.holup_admin_audit (created_at desc);
create index if not exists holup_admin_audit_actor_idx on public.holup_admin_audit (actor, created_at desc);

-- Enforcement actions taken against a member's account.
create table if not exists public.holup_account_actions (
  id          bigserial primary key,
  member_id   bigint not null references public.profiles(id) on delete cascade,
  action      text not null,
  reason      text,
  until_at    bigint,
  detail      jsonb,
  actor       uuid,
  actor_label text,
  created_at  bigint not null default public.now_ms(),
  reverted_at bigint,
  reverted_by uuid
);
alter table public.holup_account_actions drop constraint if exists holup_account_actions_action_check;
alter table public.holup_account_actions
  add constraint holup_account_actions_action_check check (action in
    ('restrict','suspend','ban','restore','warn','unrestrict'));
create index if not exists holup_account_actions_member_idx on public.holup_account_actions (member_id, created_at desc);

-- ------------------------------------------------------------ advertising ---
create table if not exists public.holup_advertisers (
  id            bigserial primary key,
  name          text not null,
  contact_email text,
  status        text not null default 'pending',
  notes         text,
  created_by    uuid,
  created_at    bigint not null default public.now_ms()
);
alter table public.holup_advertisers drop constraint if exists holup_advertisers_status_check;
alter table public.holup_advertisers
  add constraint holup_advertisers_status_check check (status in ('pending','active','suspended'));

create table if not exists public.holup_ad_campaigns (
  id           bigserial primary key,
  advertiser_id bigint references public.holup_advertisers(id) on delete set null,
  name         text not null,
  objective    text,
  status       text not null default 'draft',
  budget_minor bigint not null default 0,
  currency     text not null default 'NGN',
  starts_at    bigint,
  ends_at      bigint,
  creative_url text,
  targeting    jsonb,
  impressions  bigint not null default 0,
  clicks       bigint not null default 0,
  created_by   uuid,
  created_at   bigint not null default public.now_ms(),
  updated_at   bigint
);
-- The lifecycle vocabulary is lowercase, and the Sponsored Flow migration uses
-- the same words rather than adding an 'ACTIVE' variant alongside it.
alter table public.holup_ad_campaigns drop constraint if exists holup_ad_campaigns_status_check;
alter table public.holup_ad_campaigns
  add constraint holup_ad_campaigns_status_check check (status in
    ('draft','pending_review','scheduled','running','paused','completed','rejected','disabled'));

-- Single-row switch for the advertising module as a whole.
create table if not exists public.holup_ads_settings (
  singleton  boolean primary key default true,
  enabled    boolean not null default false,
  notes      text,
  updated_by uuid,
  updated_at bigint,
  constraint holup_ads_settings_singleton_check check (singleton)
);
insert into public.holup_ads_settings (singleton) values (true) on conflict (singleton) do nothing;

-- --------------------------------------------------------------- payments ---
-- Which providers exist, and whether they are actually connected. `status` is
-- the honest field: everything starts at not_configured and nothing is presented
-- as working until it is not.
create table if not exists public.holup_payment_providers (
  key             text primary key,
  label           text not null,
  status          text not null default 'not_configured',
  supports_payouts boolean not null default false,
  notes           text,
  updated_by      uuid,
  updated_at      bigint not null default public.now_ms()
);
alter table public.holup_payment_providers drop constraint if exists holup_payment_providers_status_check;
alter table public.holup_payment_providers
  add constraint holup_payment_providers_status_check check (status in
    ('not_configured','pending_integration','sandbox','live','disabled'));

insert into public.holup_payment_providers (key, label, supports_payouts) values
  ('flutterwave', 'Flutterwave', true),
  ('paystack', 'Paystack', true),
  ('stripe', 'Stripe', false)
on conflict (key) do nothing;

create table if not exists public.holup_payment_settings (
  singleton        boolean primary key default true,
  default_currency text not null default 'NGN',
  module_status    text not null default 'pending',
  notes            text,
  updated_by       uuid,
  updated_at       bigint,
  constraint holup_payment_settings_singleton_check check (singleton)
);
alter table public.holup_payment_settings drop constraint if exists holup_payment_settings_module_status_check;
alter table public.holup_payment_settings
  add constraint holup_payment_settings_module_status_check check (module_status in
    ('disabled','pending','active'));
insert into public.holup_payment_settings (singleton) values (true) on conflict (singleton) do nothing;

create table if not exists public.holup_payment_transactions (
  id             bigserial primary key,
  provider       text not null,
  reference      text unique,
  user_id        bigint,
  kind           text,
  amount_minor   bigint not null default 0,
  currency       text not null default 'NGN',
  status         text not null default 'pending',
  failure_reason text,
  metadata       jsonb,
  created_at     bigint not null default public.now_ms()
);
alter table public.holup_payment_transactions drop constraint if exists holup_payment_transactions_status_check;
alter table public.holup_payment_transactions
  add constraint holup_payment_transactions_status_check check (status in
    ('pending','successful','failed','refunded','abandoned'));
create index if not exists holup_payment_transactions_user_idx on public.holup_payment_transactions (user_id, created_at desc);

-- ------------------------------------------------------------------- RLS ----
-- These tables were reachable only through SECURITY DEFINER functions, which is
-- why they had no policies. RLS is enabled here so that stays true even if
-- somebody later grants table access by mistake.
alter table public.holup_admins              enable row level security;
alter table public.holup_admin_members        enable row level security;
alter table public.holup_admin_audit          enable row level security;
alter table public.holup_account_actions      enable row level security;
alter table public.holup_advertisers          enable row level security;
alter table public.holup_ad_campaigns         enable row level security;
alter table public.holup_ads_settings         enable row level security;
alter table public.holup_payment_providers    enable row level security;
alter table public.holup_payment_settings     enable row level security;
alter table public.holup_payment_transactions enable row level security;

-- Administrators may read the console tables. Nothing is writable from a client.
drop policy if exists holup_admin_audit_read on public.holup_admin_audit;
create policy holup_admin_audit_read on public.holup_admin_audit
  for select to authenticated using (public.holup_is_admin());

drop policy if exists holup_admin_members_read on public.holup_admin_members;
create policy holup_admin_members_read on public.holup_admin_members
  for select to authenticated using (public.holup_is_admin());

drop policy if exists holup_account_actions_read on public.holup_account_actions;
create policy holup_account_actions_read on public.holup_account_actions
  for select to authenticated using (public.holup_is_admin());

drop policy if exists holup_advertisers_read on public.holup_advertisers;
create policy holup_advertisers_read on public.holup_advertisers
  for select to authenticated using (public.holup_is_admin());

drop policy if exists holup_ad_campaigns_read on public.holup_ad_campaigns;
create policy holup_ad_campaigns_read on public.holup_ad_campaigns
  for select to authenticated using (public.holup_is_admin());

drop policy if exists holup_ads_settings_read on public.holup_ads_settings;
create policy holup_ads_settings_read on public.holup_ads_settings
  for select to authenticated using (public.holup_is_admin());

drop policy if exists holup_payment_providers_read on public.holup_payment_providers;
create policy holup_payment_providers_read on public.holup_payment_providers
  for select to authenticated using (public.holup_is_admin());

drop policy if exists holup_payment_settings_read on public.holup_payment_settings;
create policy holup_payment_settings_read on public.holup_payment_settings
  for select to authenticated using (public.holup_is_admin());

drop policy if exists holup_payment_transactions_read on public.holup_payment_transactions;
create policy holup_payment_transactions_read on public.holup_payment_transactions
  for select to authenticated using (public.holup_is_admin());
