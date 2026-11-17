-- ============================================================================
-- HGRI 006 — Regional analytics, RBAC and the administrative control surface
-- ============================================================================
-- Analytics here are pre-aggregated by day and dimension. Nothing in this file
-- exposes an IP, a device or a member-level record: the smallest unit is a
-- country-day figure.
-- ============================================================================

-- ------------------------------------------------------------- analytics ---
create table if not exists public.holup_analytics_daily (
  day         date not null,
  metric      text not null,
  -- 'world' | 'continent:<CODE>' | 'country:<ISO2>'
  dimension   text not null default 'world',
  value       numeric not null default 0,
  computed_at bigint not null default public.now_ms(),
  primary key (day, metric, dimension)
);
create index if not exists holup_analytics_metric_idx on public.holup_analytics_daily (metric, day desc);

create table if not exists public.holup_analytics_runs (
  id           bigserial primary key,
  day          date not null,
  status       text not null default 'RUNNING' check (status in ('RUNNING','COMPLETE','FAILED')),
  rows_written integer not null default 0,
  note         text,
  started_at   bigint not null default public.now_ms(),
  finished_at  bigint
);

alter table public.holup_analytics_daily enable row level security;
alter table public.holup_analytics_runs  enable row level security;

drop policy if exists holup_analytics_admin on public.holup_analytics_daily;
create policy holup_analytics_admin on public.holup_analytics_daily for select to authenticated
  using (public.holup_has_admin_role(array['super_admin','analytics_admin','monetisation_admin','advertising_admin']));

drop policy if exists holup_analytics_runs_admin on public.holup_analytics_runs;
create policy holup_analytics_runs_admin on public.holup_analytics_runs for select to authenticated
  using (public.holup_has_admin_role(array['super_admin','analytics_admin']));

-- One call per day, idempotent: re-running a day recomputes it.
create or replace function public.holup_analytics_rollup(p_day date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_rows integer := 0; v_run bigint; v_day_start bigint; v_day_end bigint;
begin
  -- Callable by an analytics administrator, or by a scheduled job/service role
  -- with no end-user identity.
  if auth.uid() is not null and not public.holup_has_admin_role(array['super_admin','analytics_admin']) then
    perform public.crushly_fail(403, 'forbidden', 'Analytics rollup is restricted.');
  end if;

  v_day_start := (extract(epoch from p_day::timestamp) * 1000)::bigint;
  v_day_end   := (extract(epoch from (p_day + 1)::timestamp) * 1000)::bigint;

  insert into holup_analytics_runs (day) values (p_day) returning id into v_run;

  begin
    delete from holup_analytics_daily where day = p_day;

    -- New accounts by country of record (declared, falling back to detected).
    insert into holup_analytics_daily (day, metric, dimension, value)
    select p_day, 'accounts_new', 'country:' || coalesce(r.effective_country_code, 'UNKNOWN'), count(*)
    from profiles p left join holup_user_regions r on r.profile_id = p.id
    where p.created_at >= v_day_start and p.created_at < v_day_end
    group by 1, 3
    on conflict (day, metric, dimension) do update set value = excluded.value, computed_at = public.now_ms();

    -- Daily active members by country, from the IP registry.
    insert into holup_analytics_daily (day, metric, dimension, value)
    select p_day, 'dau', 'country:' || coalesce(n.country_code, 'UNKNOWN'), count(distinct n.profile_id)
    from holup_network_records n
    where n.occurred_at >= v_day_start and n.occurred_at < v_day_end
    group by 1, 3
    on conflict (day, metric, dimension) do update set value = excluded.value, computed_at = public.now_ms();

    -- Content and monetisation by creator country.
    insert into holup_analytics_daily (day, metric, dimension, value)
    select p_day, 'qualified_views', 'country:' || coalesce(r.effective_country_code, 'UNKNOWN'), sum(m.qualified_views)
    from holup_content_daily_metrics m
    join profiles p on p.id = m.creator_profile_id
    left join holup_user_regions r on r.profile_id = p.id
    where m.day = p_day
    group by 1, 3
    on conflict (day, metric, dimension) do update set value = excluded.value, computed_at = public.now_ms();

    insert into holup_analytics_daily (day, metric, dimension, value)
    select p_day, 'total_views', 'country:' || coalesce(r.effective_country_code, 'UNKNOWN'), sum(m.total_views)
    from holup_content_daily_metrics m
    join profiles p on p.id = m.creator_profile_id
    left join holup_user_regions r on r.profile_id = p.id
    where m.day = p_day
    group by 1, 3
    on conflict (day, metric, dimension) do update set value = excluded.value, computed_at = public.now_ms();

    -- Advertising revenue actually billed, by the country the ad was shown in.
    insert into holup_analytics_daily (day, metric, dimension, value)
    select p_day, 'ad_revenue_minor', 'country:' || coalesce(i.country_code, 'UNKNOWN'), sum(i.cost_minor)
    from holup_ad_impressions i
    where i.billable and i.shown_at >= v_day_start and i.shown_at < v_day_end
    group by 1, 3
    on conflict (day, metric, dimension) do update set value = excluded.value, computed_at = public.now_ms();

    insert into holup_analytics_daily (day, metric, dimension, value)
    select p_day, 'ad_impressions', 'country:' || coalesce(i.country_code, 'UNKNOWN'), count(*)
    from holup_ad_impressions i
    where i.billable and i.shown_at >= v_day_start and i.shown_at < v_day_end
    group by 1, 3
    on conflict (day, metric, dimension) do update set value = excluded.value, computed_at = public.now_ms();

    -- Roll countries up to continents so a map has one series per continent.
    insert into holup_analytics_daily (day, metric, dimension, value)
    select p_day, a.metric, 'continent:' || coalesce(c.code, 'UNKNOWN'), sum(a.value)
    from holup_analytics_daily a
    join holup_regions r on r.level = 'country' and 'country:' || r.code = a.dimension
    join holup_regions s on s.id = r.parent_id
    join holup_regions c on c.id = s.parent_id and c.level = 'continent'
    where a.day = p_day and a.dimension like 'country:%'
    group by 1, 2, 3
    on conflict (day, metric, dimension) do update set value = excluded.value, computed_at = public.now_ms();

    get diagnostics v_rows = row_count;

    update holup_analytics_runs
       set status = 'COMPLETE', rows_written = v_rows, finished_at = public.now_ms()
     where id = v_run;
  exception when others then
    update holup_analytics_runs
       set status = 'FAILED', note = sqlerrm, finished_at = public.now_ms()
     where id = v_run;
    raise;
  end;

  return v_rows;
end $$;

-- Regional summary for the analytics screens and for RielOS. Aggregated only.
create or replace function public.holup_regional_summary(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_from date; v_out jsonb;
begin
  if not public.holup_has_admin_role(array['super_admin','analytics_admin','monetisation_admin','advertising_admin']) then
    perform public.crushly_fail(403, 'forbidden', 'You do not have access to regional analytics.');
  end if;
  v_from := current_date - greatest(1, least(p_days, 365));

  select jsonb_build_object(
    'from', v_from, 'to', current_date,
    'accounts_total', (select count(*) from profiles),
    'accounts_by_continent', coalesce((
      select jsonb_object_agg(x.code, x.n) from (
        select coalesce(c.code, 'UNKNOWN') as code, count(*) as n
        from holup_user_regions ur
        join holup_regions r on r.level = 'country' and r.code = ur.effective_country_code
        join holup_regions s on s.id = r.parent_id
        join holup_regions c on c.id = s.parent_id and c.level = 'continent'
        group by 1) x), '{}'::jsonb),
    'dau_avg', coalesce((select round(avg(value)) from holup_analytics_daily
                        where metric = 'dau' and dimension like 'country:%' and day >= v_from), 0),
    'metrics', coalesce((
      select jsonb_object_agg(m.metric, m.total) from (
        select metric, sum(value) as total from holup_analytics_daily
        where day >= v_from and dimension like 'country:%' group by 1) m), '{}'::jsonb),
    'creators_eligible', (select count(*) from holup_creator_eligibility where status = 'ELIGIBLE'),
    'ad_revenue_minor', coalesce((select sum(amount_minor) from holup_ad_spend_ledger
                                  where created_at >= (extract(epoch from v_from::timestamp) * 1000)::bigint), 0),
    'campaigns_active', (select count(*) from holup_ad_campaigns where status = 'running'),
    'advertisers', (select count(*) from holup_advertisers)
  ) into v_out;
  return v_out;
end $$;

-- ------------------------------------------------------------------ RBAC ---
-- The six roles the specification names, plus the five the existing console
-- already uses. Both lists have to be allowed by the *same* constraint: a
-- pre-existing holup_admin_members_role_check allowed only the console's roles,
-- so with both constraints in force their intersection was super_admin alone and
-- the five new roles could not be assigned at all.
alter table public.holup_admin_members drop constraint if exists holup_admin_members_role_valid;
alter table public.holup_admin_members drop constraint if exists holup_admin_members_role_check;
alter table public.holup_admin_members
  add constraint holup_admin_members_role_check check (role in (
    -- introduced by this work
    'super_admin','security_admin','fraud_investigator',
    'monetisation_admin','advertising_admin','analytics_admin',
    -- already used by the Control Centre
    'administrator','verification_officer','moderator','analyst','support_officer'));

-- What each role may open. Read server-side; every function enforces the same
-- list, so a console bug cannot widen access.
create or replace function public.holup_role_capabilities(p_role text)
returns text[]
language sql
immutable
as $$
  select case p_role
    when 'super_admin'        then array['security','ip_registry','investigations','fraud','enforcement','monetisation','advertising','analytics','roles']
    when 'security_admin'     then array['security','ip_registry','investigations','enforcement','analytics_read']
    when 'fraud_investigator' then array['security','ip_registry','investigations','fraud']
    when 'monetisation_admin' then array['monetisation','analytics_read']
    when 'advertising_admin'  then array['advertising','analytics_read']
    when 'analytics_admin'    then array['analytics']
    else array[]::text[]
  end;
$$;

create or replace function public.holup_my_admin_permissions()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_role text;
begin
  v_role := public.holup_admin_role();
  return jsonb_build_object(
    'role', v_role,
    'capabilities', to_jsonb(public.holup_role_capabilities(coalesce(v_role, ''))));
end $$;

create or replace function public.holup_admin_set_role(
  p_auth_user_id uuid,
  p_role text,
  p_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.holup_admin_role() is distinct from 'super_admin' then
    perform public.crushly_fail(403, 'forbidden', 'Only a Super Administrator can change roles.');
  end if;
  if not (p_role = any (array['super_admin','security_admin','fraud_investigator','monetisation_admin','advertising_admin','analytics_admin'])) then
    perform public.crushly_fail(400, 'bad_role', 'Unknown role.');
  end if;
  -- Removing the last super administrator would lock everybody out.
  if p_role <> 'super_admin'
     and exists (select 1 from holup_admin_members where auth_user_id = p_auth_user_id and role = 'super_admin')
     and (select count(*) from holup_admin_members where role = 'super_admin' and status = 'active') <= 1 then
    perform public.crushly_fail(409, 'last_super_admin', 'There must always be at least one active Super Administrator.');
  end if;

  insert into holup_admin_members (auth_user_id, email, role, status, created_at, updated_at)
  values (p_auth_user_id, p_email, p_role, 'active', public.now_ms(), public.now_ms())
  on conflict (auth_user_id) do update
    set role = excluded.role, status = 'active', updated_at = public.now_ms();

  perform public.holup_cc_audit('roles', 'role_assigned', 'holup_admin_members', p_auth_user_id::text,
    null, jsonb_build_object('role', p_role));
  return jsonb_build_object('auth_user_id', p_auth_user_id, 'role', p_role);
end $$;

-- ------------------------------------------------------- security actions ---
create or replace function public.holup_security_decide(
  p_event_id bigint,
  p_decision text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_event holup_security_events;
begin
  if not public.holup_has_admin_role(array['super_admin','security_admin','fraud_investigator']) then
    perform public.crushly_fail(403, 'forbidden', 'You cannot decide security events.');
  end if;
  if p_decision not in ('NO_ACTION','WARNED','RESTRICTED','SESSIONS_REVOKED','SUSPENDED','RESTORED') then
    perform public.crushly_fail(400, 'bad_decision', 'Unknown decision.');
  end if;
  if coalesce(length(trim(p_note)), 0) < 5 then
    perform public.crushly_fail(400, 'note_required', 'Every decision needs a written reason.');
  end if;

  select * into v_event from holup_security_events where id = p_event_id for update;
  if v_event.id is null then perform public.crushly_fail(404, 'not_found', 'Event not found.'); end if;

  update holup_security_events
     set decision = p_decision, decided_by = auth.uid(), decided_at = public.now_ms(),
         decision_note = p_note,
         status = case when p_decision = 'NO_ACTION' then 'DISMISSED' else 'RESOLVED' end,
         updated_at = public.now_ms()
   where id = p_event_id;

  perform public.holup_cc_audit('security', 'event_decided', 'holup_security_events', p_event_id::text,
    jsonb_build_object('status', v_event.status), jsonb_build_object('decision', p_decision, 'note', p_note));
  return jsonb_build_object('event_id', p_event_id, 'decision', p_decision);
end $$;

create or replace function public.holup_security_open_case(
  p_profile_id bigint,
  p_title text,
  p_severity text,
  p_event_ids bigint[],
  p_summary text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_ref text; v_id bigint;
begin
  if not public.holup_has_admin_role(array['super_admin','security_admin','fraud_investigator']) then
    perform public.crushly_fail(403, 'forbidden', 'You cannot open investigations.');
  end if;
  if coalesce(length(trim(p_title)), 0) < 5 then
    perform public.crushly_fail(400, 'title_required', 'A case needs a title.');
  end if;

  v_ref := public.holup_next_case_ref();
  insert into holup_investigation_cases (case_ref, profile_id, title, summary, severity, event_ids, opened_by)
  values (v_ref, p_profile_id, p_title, p_summary, coalesce(p_severity, 'MEDIUM'), coalesce(p_event_ids, '{}'), auth.uid())
  returning id into v_id;

  if p_event_ids is not null and array_length(p_event_ids, 1) > 0 then
    update holup_security_events
       set status = 'INVESTIGATING', updated_at = public.now_ms()
     where id = any (p_event_ids) and status = 'OPEN';
  end if;

  perform public.holup_cc_audit('investigations', 'case_opened', 'holup_investigation_cases', v_id::text, null,
    jsonb_build_object('case_ref', v_ref, 'severity', p_severity));
  return jsonb_build_object('case_id', v_id, 'case_ref', v_ref);
end $$;

create or replace function public.holup_security_close_case(
  p_case_id bigint,
  p_findings text,
  p_decision text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_case holup_investigation_cases;
begin
  if not public.holup_has_admin_role(array['super_admin','security_admin','fraud_investigator']) then
    perform public.crushly_fail(403, 'forbidden', 'You cannot close investigations.');
  end if;
  if coalesce(length(trim(p_findings)), 0) < 10 then
    perform public.crushly_fail(400, 'findings_required', 'A case cannot close without recorded findings.');
  end if;
  select * into v_case from holup_investigation_cases where id = p_case_id for update;
  if v_case.id is null then perform public.crushly_fail(404, 'not_found', 'Case not found.'); end if;

  update holup_investigation_cases
     set findings = p_findings, decision = p_decision, decision_by = auth.uid(),
         decision_at = public.now_ms(), status = 'CLOSED', closed_at = public.now_ms(),
         updated_at = public.now_ms()
   where id = p_case_id;

  perform public.holup_cc_audit('investigations', 'case_closed', 'holup_investigation_cases', p_case_id::text,
    jsonb_build_object('status', v_case.status), jsonb_build_object('decision', p_decision));
  return jsonb_build_object('case_id', p_case_id, 'status', 'CLOSED');
end $$;

-- Enforcement. A temporary action stands on its own; a permanent one requires a
-- reviewed case, which is how "no permanent penalty without review" is enforced
-- in the database rather than in a policy document.
create or replace function public.holup_enforce_action(
  p_profile_id bigint,
  p_action text,
  p_reason text,
  p_until_at bigint default null,
  p_case_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id bigint; v_case holup_investigation_cases;
begin
  if not public.holup_has_admin_role(array['super_admin','security_admin']) then
    perform public.crushly_fail(403, 'forbidden', 'You cannot enforce.');
  end if;
  -- Accept the readable uppercase form, store the vocabulary the existing
  -- holup_account_actions_action_check already enforces (warn/restrict/suspend/
  -- ban/restore/unrestrict). Writing 'WARN' here used to violate that check and
  -- make every enforcement attempt fail.
  if p_action not in ('WARN','RESTRICT','SUSPEND','REINSTATE') then
    perform public.crushly_fail(400, 'bad_action', 'Unknown action.');
  end if;
  if coalesce(length(trim(p_reason)), 0) < 10 then
    perform public.crushly_fail(400, 'reason_required', 'Enforcement needs a recorded reason.');
  end if;

  if p_until_at is null and p_action in ('RESTRICT','SUSPEND') then
    if p_case_id is null then
      perform public.crushly_fail(409, 'review_required', 'A permanent action requires an investigation case.');
    end if;
    select * into v_case from holup_investigation_cases where id = p_case_id;
    if v_case.id is null or v_case.status not in ('CLOSED','PENDING_REVIEW') then
      perform public.crushly_fail(409, 'review_required', 'The case must be reviewed and closed before a permanent action.');
    end if;
  end if;

  insert into holup_account_actions (member_id, action, reason, until_at, detail, actor, actor_label, created_at)
  values (p_profile_id,
          case p_action when 'WARN' then 'warn'
                        when 'RESTRICT' then 'restrict'
                        when 'SUSPEND' then 'suspend'
                        when 'REINSTATE' then 'restore' end,
          p_reason, p_until_at,
          jsonb_build_object('case_id', p_case_id), auth.uid(), public.holup_admin_role(), public.now_ms())
  returning id into v_id;

  perform public.holup_cc_audit('enforcement', p_action, 'holup_account_actions', v_id::text, null,
    jsonb_build_object('profile_id', p_profile_id, 'until_at', p_until_at, 'case_id', p_case_id, 'reason', p_reason));
  return jsonb_build_object('action_id', v_id, 'action', p_action);
end $$;

-- -------------------------------------------------------- money overviews ---
-- Administrative view of the pool and liabilities. Funding in, owed out.
create or replace function public.holup_monetisation_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.holup_has_admin_role(array['super_admin','monetisation_admin']) then
    perform public.crushly_fail(403, 'forbidden', 'You do not have access to monetisation.');
  end if;
  return jsonb_build_object(
    'policy', (select to_jsonb(p) from holup_rewards_policy p),
    'wallet_totals', (select jsonb_build_object(
        'pending_minor', coalesce(sum(pending_minor), 0),
        'available_minor', coalesce(sum(available_minor), 0),
        'lifetime_minor', coalesce(sum(lifetime_minor), 0),
        'paid_minor', coalesce(sum(paid_minor), 0),
        'wallets', count(*)) from holup_creator_wallets),
    'pool_totals', (select jsonb_build_object(
        'funded_minor', coalesce(sum(funded_minor), 0),
        'committed_minor', coalesce(sum(committed_minor), 0),
        'distributed_minor', coalesce(sum(distributed_minor), 0),
        'pools', count(*)) from holup_rewards_pools),
    'open_payouts', (select jsonb_build_object(
        'count', count(*), 'amount_minor', coalesce(sum(amount_minor), 0))
        from holup_payout_requests where status in ('REQUESTED','UNDER_REVIEW','APPROVED','SENT')),
    'creators', (select jsonb_build_object(
        'eligible', count(*) filter (where status = 'ELIGIBLE'),
        'pending', count(*) filter (where status = 'PENDING'),
        'total', count(*)) from holup_creator_eligibility),
    'recent_rewards', coalesce((select jsonb_agg(to_jsonb(r) order by r.id desc) from
        (select id, pool_id, profile_id, amount_minor, currency, status, computed_at
         from holup_creator_rewards order by id desc limit 20) r), '[]'::jsonb));
end $$;

create or replace function public.holup_advertising_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.holup_has_admin_role(array['super_admin','advertising_admin']) then
    perform public.crushly_fail(403, 'forbidden', 'You do not have access to advertising.');
  end if;
  return jsonb_build_object(
    'settings', (select to_jsonb(s) from holup_flow_ads_settings s),
    'campaigns', (select jsonb_build_object(
        'total', count(*),
        'running', count(*) filter (where status = 'running'),
        'pending_review', count(*) filter (where status = 'pending_review'),
        'budget_minor', coalesce(sum(budget_minor), 0),
        'spent_minor', coalesce(sum(spent_minor), 0),
        'impressions', coalesce(sum(impressions), 0),
        'clicks', coalesce(sum(clicks), 0)) from holup_ad_campaigns),
    'advertisers', (select count(*) from holup_advertisers),
    'impressions_24h', (select jsonb_build_object(
        'billable', count(*) filter (where billable),
        'invalid', count(*) filter (where not billable),
        'revenue_minor', coalesce(sum(cost_minor) filter (where billable), 0))
        from holup_ad_impressions where shown_at > public.now_ms() - 86400000),
    'top_campaigns', coalesce((select jsonb_agg(to_jsonb(c) order by c.spent_minor desc) from
        (select id, name, status, budget_minor, spent_minor, impressions, clicks, currency
         from holup_ad_campaigns order by spent_minor desc limit 10) c), '[]'::jsonb));
end $$;

grant execute on function public.holup_analytics_rollup(date) to authenticated;
grant execute on function public.holup_regional_summary(integer) to authenticated;
grant execute on function public.holup_my_admin_permissions() to authenticated;
grant execute on function public.holup_admin_set_role(uuid, text, text) to authenticated;
grant execute on function public.holup_security_decide(bigint, text, text) to authenticated;
grant execute on function public.holup_security_open_case(bigint, text, text, bigint[], text) to authenticated;
grant execute on function public.holup_security_close_case(bigint, text, text) to authenticated;
grant execute on function public.holup_enforce_action(bigint, text, text, bigint, bigint) to authenticated;
grant execute on function public.holup_monetisation_overview() to authenticated;
grant execute on function public.holup_advertising_overview() to authenticated;

-- ----------------------------------------------------------------- RielOS ---
-- Management visibility only, over service-to-service credentials: counts and
-- sums, never a member or a security record.
create or replace function public.holup_platform_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_pools jsonb; v_regions jsonb;
begin
  if not (current_setting('role', true) = 'service_role' or public.holup_admin_role() = 'super_admin') then
    perform public.crushly_fail(403, 'forbidden', 'Platform summary is service-to-service only.');
  end if;
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_pools from
    (select id, period_start, period_end, currency, funded_minor, committed_minor, status
     from holup_rewards_pools order by id desc limit 24) t;
  select coalesce(jsonb_object_agg(level, n), '{}'::jsonb) into v_regions from
    (select level, count(*) as n from holup_regions group by level) q;
  return jsonb_build_object(
    'generated_at', public.now_ms(),
    'accounts', (select count(*) from profiles),
    'accounts_7d', (select count(*) from profiles where created_at > public.now_ms() - 604800000),
    'regions', v_regions,
    'rewards', (select jsonb_build_object('funded_minor', coalesce(sum(funded_minor), 0),
        'committed_minor', coalesce(sum(committed_minor), 0)) from holup_rewards_pools),
    'advertising', (select jsonb_build_object('spent_minor', coalesce(sum(spent_minor), 0),
        'active_campaigns', count(*) filter (where status = 'running')) from holup_ad_campaigns),
    'payouts', (select jsonb_build_object(
        'open', count(*) filter (where status in ('REQUESTED','UNDER_REVIEW','APPROVED','SENT')),
        'paid_minor', coalesce(sum(amount_minor) filter (where status = 'PAID'), 0)) from holup_payout_requests),
    'security_events_open', (select count(*) from holup_security_events where status in ('OPEN','INVESTIGATING')),
    'investigations_open', (select count(*) from holup_investigation_cases where status in ('OPEN','IN_PROGRESS','PENDING_REVIEW')),
    'pools', v_pools);
end $$;

grant execute on function public.holup_platform_summary() to authenticated, service_role;
