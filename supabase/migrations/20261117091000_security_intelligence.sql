-- ============================================================================
-- HGRI 003 — HolUpp Security Intelligence + the IP registry
-- ============================================================================
-- Three separate records, because they answer three different questions:
--
--   holup_network_records     — "what network did this request arrive on?"
--   holup_security_events     — "was that behaviour suspicious, and how much?"
--   holup_investigation_cases — "who looked into it, and what did they decide?"
--
-- The spec is explicit that an IP change, a VPN or a country mismatch must never
-- ban anybody on its own, so nothing here has an automatic enforcement path. An
-- event is a *question*; a case is a human answering it.
-- ============================================================================

-- ------------------------------------------------------------ IP registry ---
create table if not exists public.holup_network_records (
  id                   bigserial primary key,
  profile_id           bigint not null references public.profiles(id) on delete cascade,
  -- inet, not text: '102.89.33.1' and '102.089.033.001' must not become two rows.
  ip                   inet not null,
  ip_version           smallint generated always as (case when family(ip) = 6 then 6 else 4 end) stored,
  country_code         text,
  region               text,
  city                 text,
  -- Autonomous system and network organisation, where the provider returns them.
  asn                  text,
  isp                  text,
  device_category      text check (device_category in ('android','ios','web','desktop','unknown')),
  auth_session_id      uuid,
  request_id           text,
  -- REGISTER | LOGIN | SESSION_REFRESH | SENSITIVE_ACTION | WITHDRAWAL | SECURITY_EVENT
  event                text not null default 'LOGIN',
  -- The header the request actually arrived with, after the trusted-proxy rules
  -- in the region-intel function have been applied. Recorded so an investigation
  -- can see how an address was established.
  source_header        text,
  detection_provider   text,
  detection_confidence smallint check (detection_confidence between 0 and 100),
  -- Provisioned for the column-level encryption path; plaintext stays for
  -- investigation, this is what analytics and joins should use.
  ip_hash              text,
  occurred_at          bigint not null default public.now_ms(),
  -- Retention is enforced by holup_prune_network_records, not hoped for.
  expires_at           bigint
);

create index if not exists holup_network_profile_idx on public.holup_network_records (profile_id, occurred_at desc);
create index if not exists holup_network_ip_idx on public.holup_network_records (ip);
create index if not exists holup_network_country_idx on public.holup_network_records (country_code, occurred_at desc);
create index if not exists holup_network_expiry_idx on public.holup_network_records (expires_at)
  where expires_at is not null;

comment on table public.holup_network_records is
  'Internal IP registry. Never readable by ordinary members or advertisers; an IP is never shown to another user.';

-- ------------------------------------------------------- security events ---
create table if not exists public.holup_security_events (
  id                bigserial primary key,
  profile_id        bigint references public.profiles(id) on delete cascade,
  category          text not null check (category in (
                      'SUSPICIOUS_LOGIN','AUTH_FAILURES','MULTI_ACCOUNT','AUTOMATION',
                      'ENGAGEMENT_FRAUD','VIEW_FRAUD','SPAM','SESSION_HIJACK',
                      'DEVICE_CHANGE','GEO_CHANGE','WITHDRAWAL_RISK','API_ABUSE',
                      'MONETISATION_MANIPULATION')),
  severity          text not null default 'INFO' check (severity in ('INFO','LOW','MEDIUM','HIGH','CRITICAL')),
  -- Severity is what it means; risk is how much evidence supports it. Keeping
  -- them apart is what stops "it was a VPN" from becoming "it was fraud".
  risk_score        smallint not null default 0 check (risk_score between 0 and 100),
  headline          text not null,
  -- Everything the finding rests on: counts, thresholds crossed, row ids.
  evidence          jsonb not null default '{}'::jsonb,
  network_record_id bigint references public.holup_network_records(id) on delete set null,
  auth_session_id   uuid,
  country_code      text,
  continent         text,
  status            text not null default 'OPEN' check (status in ('OPEN','INVESTIGATING','RESOLVED','DISMISSED')),
  decision          text check (decision in ('NO_ACTION','WARNED','RESTRICTED','SESSIONS_REVOKED','SUSPENDED','RESTORED')),
  decided_by        uuid,
  decided_at        bigint,
  decision_note     text,
  created_at        bigint not null default public.now_ms(),
  updated_at        bigint not null default public.now_ms()
);

create index if not exists holup_security_events_profile_idx on public.holup_security_events (profile_id, created_at desc);
create index if not exists holup_security_events_status_idx on public.holup_security_events (status, created_at desc);
create index if not exists holup_security_events_severity_idx on public.holup_security_events (severity, created_at desc);
create index if not exists holup_security_events_category_idx on public.holup_security_events (category, created_at desc);

-- --------------------------------------------------------- investigations ---
create table if not exists public.holup_investigation_cases (
  id          bigserial primary key,
  case_ref    text not null unique,
  profile_id  bigint references public.profiles(id) on delete set null,
  title       text not null,
  summary     text,
  severity    text not null default 'MEDIUM' check (severity in ('LOW','MEDIUM','HIGH','CRITICAL')),
  status      text not null default 'OPEN' check (status in ('OPEN','IN_PROGRESS','PENDING_REVIEW','CLOSED','DISMISSED')),
  assigned_to uuid,
  -- The events this case is about: a working set, not a taxonomy.
  event_ids   bigint[] not null default '{}',
  findings    text,
  decision    text,
  decision_by uuid,
  decision_at bigint,
  opened_by   uuid,
  opened_at   bigint not null default public.now_ms(),
  updated_at  bigint not null default public.now_ms(),
  closed_at   bigint
);
create index if not exists holup_cases_status_idx on public.holup_investigation_cases (status, opened_at desc);
create index if not exists holup_cases_profile_idx on public.holup_investigation_cases (profile_id);

-- Case references are issued by the database so two investigators cannot mint
-- the same one.
create sequence if not exists public.holup_case_ref_seq start 1000;

create or replace function public.holup_next_case_ref()
returns text
language sql
volatile
as $$ select 'HLP-SI-' || lpad(nextval('public.holup_case_ref_seq')::text, 6, '0'); $$;

-- --------------------------------------------------------- device records ---
-- One row per (profile, device), not per request: this is an inventory.
create table if not exists public.holup_device_records (
  id              bigserial primary key,
  profile_id      bigint not null references public.profiles(id) on delete cascade,
  device_hash     text not null,
  device_category text check (device_category in ('android','ios','web','desktop','unknown')),
  label           text,
  first_seen_at   bigint not null default public.now_ms(),
  last_seen_at    bigint not null default public.now_ms(),
  trust           text not null default 'UNKNOWN' check (trust in ('UNKNOWN','TRUSTED','REVOKED')),
  unique (profile_id, device_hash)
);
create index if not exists holup_device_profile_idx on public.holup_device_records (profile_id, last_seen_at desc);

-- -------------------------------------------------------------- retention ---
-- A retention period that only exists in a document is not a retention period.
create or replace function public.holup_prune_network_records(p_batch integer default 5000)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare removed integer;
begin
  with doomed as (
    select id from holup_network_records
    where expires_at is not null and expires_at < public.now_ms()
    limit greatest(1, least(p_batch, 50000))
  )
  delete from holup_network_records n using doomed d where n.id = d.id;
  get diagnostics removed = row_count;
  return removed;
end $$;

-- ------------------------------------------------------------------- RLS ---
alter table public.holup_network_records     enable row level security;
alter table public.holup_security_events     enable row level security;
alter table public.holup_investigation_cases enable row level security;
alter table public.holup_device_records      enable row level security;

-- Read by administrators only, scoped by role: a monetisation administrator has
-- no business reading somebody's IP history.
drop policy if exists holup_network_admin on public.holup_network_records;
create policy holup_network_admin on public.holup_network_records
  for select to authenticated
  using (public.holup_has_admin_role(array['super_admin','security_admin','fraud_investigator']));

drop policy if exists holup_security_events_admin on public.holup_security_events;
create policy holup_security_events_admin on public.holup_security_events
  for select to authenticated
  using (public.holup_has_admin_role(array['super_admin','security_admin','fraud_investigator']));

drop policy if exists holup_cases_admin on public.holup_investigation_cases;
create policy holup_cases_admin on public.holup_investigation_cases
  for select to authenticated
  using (public.holup_has_admin_role(array['super_admin','security_admin','fraud_investigator']));

drop policy if exists holup_devices_admin on public.holup_device_records;
create policy holup_devices_admin on public.holup_device_records
  for select to authenticated
  using (public.holup_has_admin_role(array['super_admin','security_admin','fraud_investigator']));

-- Enforcement is written by functions, never by a client: no write policies.

-- ---------------------------------------------------------- admin surface ---
-- One function per screen, so the dashboard asks a question rather than
-- assembling a query in the browser. Each is SECURITY DEFINER and re-checks the
-- role itself — the RLS policy above is a second lock, not the only one.

create or replace function public.holup_security_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare out jsonb;
begin
  if not public.holup_has_admin_role(array['super_admin','security_admin','fraud_investigator']) then
    perform public.crushly_fail(403, 'forbidden', 'You do not have access to security intelligence.');
  end if;

  select jsonb_build_object(
    'events_total',        (select count(*) from holup_security_events),
    'events_open',         (select count(*) from holup_security_events where status in ('OPEN','INVESTIGATING')),
    'events_critical',     (select count(*) from holup_security_events where severity = 'CRITICAL' and status <> 'DISMISSED'),
    'events_high_7d',      (select count(*) from holup_security_events where severity in ('HIGH','CRITICAL')
                              and created_at > public.now_ms() - 604800000),
    'cases_open',          (select count(*) from holup_investigation_cases where status in ('OPEN','IN_PROGRESS','PENDING_REVIEW')),
    'suspicious_accounts', (select count(distinct profile_id) from holup_security_events
                              where risk_score >= 60 and status not in ('RESOLVED','DISMISSED')),
    'network_records',     (select count(*) from holup_network_records),
    'countries_seen',      (select count(distinct country_code) from holup_network_records where country_code is not null),
    'recent_actions',      coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'module', a.module, 'action', a.action, 'actor', a.actor_email,
        'target', a.target_id, 'at', a.created_at, 'result', a.result) order by a.id desc)
      from (select * from holup_admin_audit order by id desc limit 10) a), '[]'::jsonb)
  ) into out;
  return out;
end $$;

create or replace function public.holup_security_events_list(
  p_status   text default null,
  p_severity text default null,
  p_limit    integer default 50,
  p_offset   integer default 0
)
returns table (
  id bigint, profile_id bigint, member_name text, category text, severity text,
  risk_score smallint, headline text, country_code text, status text,
  decision text, created_at bigint, evidence jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.holup_has_admin_role(array['super_admin','security_admin','fraud_investigator']) then
    perform public.crushly_fail(403, 'forbidden', 'You do not have access to security intelligence.');
  end if;
  return query
    select e.id, e.profile_id, p.name, e.category, e.severity, e.risk_score, e.headline,
           e.country_code, e.status, e.decision, e.created_at, e.evidence
    from holup_security_events e
    left join profiles p on p.id = e.profile_id
    where (p_status is null or e.status = p_status)
      and (p_severity is null or e.severity = p_severity)
    order by e.created_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    offset greatest(0, coalesce(p_offset, 0));
end $$;

-- The account movement history the spec describes, as data rather than a
-- paragraph. The output columns are prefixed because unprefixed names collide
-- with the query's own columns, and the window is computed once in bigint
-- because computing it inline overflowed integer arithmetic.
create or replace function public.holup_account_movement(p_profile_id bigint, p_days integer default 30)
returns table (
  movement_day date, movement_country text, movement_country_name text,
  movement_device text, movement_records bigint, movement_first bigint, movement_last bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_since bigint;
begin
  if not public.holup_has_admin_role(array['super_admin','security_admin','fraud_investigator']) then
    perform public.crushly_fail(403, 'forbidden', 'You do not have access to account movement.');
  end if;
  v_since := public.now_ms() - (greatest(1, least(coalesce(p_days, 30), 365))::bigint * 86400000);
  return query
    select (to_timestamp(n.occurred_at / 1000.0))::date as movement_day,
           n.country_code, r.name, n.device_category,
           count(*) as movement_records, min(n.occurred_at), max(n.occurred_at)
    from holup_network_records n
    left join holup_regions r on r.level = 'country' and r.code = n.country_code
    where n.profile_id = p_profile_id and n.occurred_at > v_since
    group by 1, 2, 3, 4
    order by 1 desc, 6 desc;
end $$;

grant execute on function public.holup_security_overview() to authenticated;
grant execute on function public.holup_security_events_list(text, text, integer, integer) to authenticated;
grant execute on function public.holup_account_movement(bigint, integer) to authenticated;
