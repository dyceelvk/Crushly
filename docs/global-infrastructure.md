# holUpp Global Infrastructure — what is live, what is not

_Last updated in this working session. Everything marked LIVE was executed against the production
project `yzcssyebozfkmojqqdhc` and verified by reading the result back._

---

## 1. What is actually running

### Region engine (HGRI)

| Item | State |
|---|---|
| `holup_regions` registry — world → continent → subregion → country | **LIVE**, 276 rows: 1 world, 7 continents, 18 subregions, 250 countries (ISO 3166-1 alpha-2 + alpha-3, UN M49 grouping) |
| `holup_user_regions` — selected vs detected country, effective, continent, subregion, state, city, timezone, method, provider, confidence, status | **LIVE** |
| `holup_region_history` — append-only change log (DETECTION / SELECTION / CORRECTION / TRAVEL / PROVIDER_CHANGE) | **LIVE** |
| `region-intel` edge function — the only place an IP becomes a place | **DEPLOYED** to `…/functions/v1/region-intel`, JWT required |
| Antarctica | Classified (`level='country'`, `is_market=false`) and `NOT_ELIGIBLE` for rewards |

Verified end to end with a real member session: the function resolved the calling address to
`US / Washington / Seattle`, ASN `AS16509`, ISP `Amazon.com`, confidence 70, wrote
`holup_network_records` row 1 (ip `99.82.171.73`, `ip_version 4`, retention `expires_at` set to +365d),
upserted `holup_user_regions` and appended one `holup_region_history` row with
`reason='DETECTION'`.

How the client address is chosen, since this is where these systems usually go wrong:

* `x-forwarded-for` is read **last entry first** — the hop Supabase's own proxy appends. The first
  entry is written by the caller and is therefore attacker-controlled text.
* If `TRUSTED_PROXY_CIDRS` is ever configured, the chain is walked from the right past those hops and
  `cf-connecting-ip` is believed only from a trusted peer.
* Private, loopback, link-local and carrier-grade-NAT ranges are **refused**, not geolocated.
* A provider miss returns `identified: false`. The declared country is never substituted for a
  measurement.

### Security intelligence

**LIVE:** `holup_network_records` (inet typed, IPv4/IPv6, ASN, ISP, device category, session id,
request id, event, provider, confidence, 365-day retention), `holup_security_events` (13 categories,
INFO→CRITICAL severity, 0–100 risk score, jsonb evidence, decision + decided_by + decision_note),
`holup_investigation_cases` (case refs issued by the database: `HLP-SI-001000`),
`holup_device_records`, `holup_prune_network_records()` for retention.

**Nothing here can ban anyone.** A geo mismatch raises a `LOW` / risk-20 `GEO_CHANGE` event, once per
seven days per member, with the note "Geographic mismatch only. Not sufficient for any enforcement."
attached to the evidence itself.

### Creator Rewards, pool and ledger

**LIVE:** `holup_rewards_policy` (single row, allocation in basis points, must total 10,000),
`holup_region_eligibility_rules` (continent → subregion → country resolution, most specific wins),
`holup_creator_eligibility` (an account cannot reach `ELIGIBLE` without `residence_verified_at` — a
database constraint, not a policy paragraph), `holup_eligibility_corrections`,
`holup_content_daily_metrics` (daily grain, never per-heartbeat), `holup_rewards_pools`,
`holup_pool_funding`, `holup_creator_rewards`, `holup_creator_wallets`, `holup_wallet_ledger`,
`holup_payout_methods`, `holup_payout_requests`.

Seeded eligibility policy (data, not frontend logic): **Africa ELIGIBLE · Europe ELIGIBLE ·
North America NOT_ELIGIBLE · South America / Asia / Oceania CONFIGURABLE · Antarctica NOT_ELIGIBLE.**

Ledger integrity: `holup_wallet_ledger` refuses `UPDATE` and `DELETE` by trigger, and every row commits
to the previous row's hash (`prev_hash` → `entry_hash`, SHA-256 over the entry). Rewriting history is a
detectable event, not a permission question.

Money paths verified in a rolled-back transaction:
* pool funded 1,000,000 minor → creator share 40% → **400,000 committed**, zero over-allocation;
* `holup_rewards_calculate` refuses an `APPROVED` pool, and asserts `sum(amount) <= available`.

### Sponsored Flow

**LIVE:** `holup_ad_creatives` (FLOW_CARD / SPONSORED_POST / CAROUSEL, "Sponsored" label, CTA set,
verified badge), `holup_ad_targeting` (worldwide → continent → subregion → country → state → city),
`holup_ad_impressions`, `holup_ad_clicks`, `holup_ad_spend_ledger` (append-only, separate from the
creator ledger), `holup_flow_ads_settings`, `holup_flow_ad_state`. `holup_ad_campaigns` extended with
`pricing_model`, `rate_minor`, `spent_minor`, `daily_budget_minor`, review and pause columns — the
existing table and its `impressions`/`clicks` counters were kept, and the existing lowercase status
vocabulary (`running`, `pending_review`, …) is reused rather than duplicated with an `ACTIVE` variant.

Delivery verified over a 26-video simulation: ads served at video positions **6, 13, 20** — i.e. none
in the first five, then one, then one after every seven. Billing verified: a 4-second view billed
5 minor at a 5,000 CPM; a 0.5-second view was written as `invalid_reason='VIEW_TOO_SHORT'` with
`cost_minor=0`; an unviewed impression stayed `PENDING_VIEW`. Frequency and money decisions are made
in SQL, so the client cannot ask twice for the same slot.

### Analytics

**LIVE:** `holup_analytics_daily` (day × metric × dimension, `country:NG` / `continent:AF` / world),
`holup_analytics_runs`, `holup_analytics_rollup(date)` (idempotent per day), `holup_regional_summary(days)`.
First real rollup produced `dau country:US = 1`, `dau continent:NA = 1`, `accounts_new country:UNKNOWN = 1`
— small because the platform is small, and derived from the one real network record, not invented.

No member-level row leaves these functions. The smallest unit is a country-day figure.

### RBAC

Six roles are now enforced by a check constraint on `holup_admin_members`: `super_admin`,
`security_admin`, `fraud_investigator`, `monetisation_admin`, `advertising_admin`, `analytics_admin`.
`holup_role_capabilities(role)` is the single source of module access, and every function re-checks the
role itself. `holup_my_admin_permissions()` returned, for the owner account:
`super_admin` with all nine capabilities.

Guards proven by rejection: calling `holup_security_overview` with no admin identity raises
`403 forbidden`; a permanent `SUSPEND`/`RESTRICT` without a closed investigation case raises
`409 review_required`; changing roles away from the last Super Administrator raises `409`.

### Admin functions available now (all `SECURITY DEFINER`, all audited)

`holup_security_overview`, `holup_security_events_list`, `holup_account_movement`,
`holup_security_decide`, `holup_security_open_case`, `holup_security_close_case`,
`holup_enforce_action`, `holup_monetisation_overview`, `holup_advertising_overview`,
`holup_regional_summary`, `holup_my_admin_permissions`, `holup_admin_set_role`,
`holup_platform_summary` (service-to-service only), `holup_rewards_calculate`, `holup_pool_approve`,
`holup_payout_request`, `holup_flow_request_ad`, `holup_ad_settle_impression`, `holup_ad_record_click`,
`holup_region_eligibility`, `holup_analytics_rollup`, `holup_prune_network_records`.

### App integration

`CrushlyApp/src/lib/region.ts` + 10 passing tests, wired into `src/state/auth.tsx` at session adopt
(`SESSION_REFRESH`) and after sign-in (`LOGIN`). No timer, no polling, no background task, one request
per 30 minutes per running app, failures silent, and **no location field is ever sent by the client** —
only `event`, `deviceCategory` and a request id.

---

## 2. What is deliberately switched off

| Switch | Value | Why |
|---|---|---|
| `holup_rewards_policy.enabled` | `false` | A pool that has never been funded cannot pay anybody. Turning it on before the first real funding event would let members request withdrawals against zero. |
| `holup_flow_ads_settings.enabled` | `false` | No advertiser, campaign or creative exists yet. Serving ads against an empty inventory returns "no eligible campaign" to every member for no benefit. |

Both are one-row admin updates, not releases. Flip them when the first funding event and the first
approved campaign exist.

---

## 3. What is not built yet, stated plainly

1. **Advertiser self-service.** `holup_advertisers` and campaign rows exist and the delivery/billing
   engine reads them, but there is no advertiser sign-up, campaign builder or performance screen.
   Advertisers can be created today only by an administrator.
2. **Admin console screens.** Every RPC the screens need is live and returning real data; the Control
   Centre UI for Security / IP Registry / Investigations / Monetisation / Advertising / Analytics has
   not been written in this pass.
3. **Creator-facing surfaces.** Wallet, eligibility and rewards reads are permitted and populated by
   policy, but there is no "Creator Rewards" screen in the app yet.
4. **Flow ad card UI.** The server decides and returns the creative; the renderer inside the existing
   full-screen Flow has not been added, so ads are not visible to members yet.
5. **Payout execution.** `holup_payout_request` enforces threshold, verified method, balance, wallet
   hold and idempotency. Actually moving money needs provider credentials:
   `holup_payment_providers` shows **flutterwave / paystack / stripe all `not_configured`**. Until one
   is configured with real keys, a request can be created and reviewed but not disbursed. No payout
   integration is presented as working.
6. **KYC linkage for payout accounts.** Identity verification uses the existing Didit integration; the
   payout account holder check (name on account vs verified identity) is designed but not connected.
7. **Scheduled jobs.** `holup_analytics_rollup`, `holup_prune_network_records`,
   `holup_rewards_calculate` are callable but not on a schedule yet — that needs a cron entry
   (`pg_cron` or the existing scheduled-workflow pattern).
8. **RielOS feed.** `holup_platform_summary()` is live and service-to-service only; RielOS still needs
   a signed endpoint on its side to consume it.
9. **GeoJSON / PostGIS.** Not used. Country- and continent-level analytics need no polygons, and
   `holup_regions` already carries the ISO codes a map library needs. Adding PostGIS now would be
   weight without a screen that requires it.
10. **Two IP-registry items** — encryption-at-rest and admin access logging. Admin reads are audited
    (`holup_admin_audit` rows on `region-intel` lookups). Encryption at rest is database-level on
    Supabase (AES at rest on the volume) but a column-level encryption strategy for `ip` was not added;
    `ip_hash` is provisioned for that path.

---

## 4. Test matrix — status

| Case | Status |
|---|---|
| NG / GH / EU / US registration, country selection | Registry resolves all four; selection path exists in data; **UI not built** |
| IP change / VPN mismatch | ✓ verified — mismatch raises LOW event, no enforcement |
| Multi-device | Device inventory table live; **parallel-session detection not implemented** |
| Suspicious login | Event category + decision workflow live; **detector not implemented** |
| Fake views | `VIEW_TOO_SHORT` rejection ✓; **velocity/bot detection not implemented** |
| Rewards calculation | ✓ 40% allocation, cap enforced, approved-pool lock |
| Pool funding | ✓ append-only funding events, no over-commit constraint |
| Ad delivery | ✓ positions 6/13/20 |
| Budget accounting | ✓ per-impression cost, ledger, no over-budget charge |
| Wallet calculation | ✓ ledger hash chain, append-only trigger |
| Payout verification | thresholds/method/idempotency ✓; **disbursement needs provider keys** |
| Analytics | ✓ rollup from real records |
| Admin restrictions | ✓ 403/409 guards proven |
| APK + web parity | Same React Native source; **not rebuilt — see below** |

---

## 5. Verification and release state

Migrations: the files were re-derived from the live project after a sandbox reset and then checked
back against it — **all 28 tables and all 31 functions declared in
`supabase/migrations/2026111709*.sql` exist in production**, the registry holds 276 rows, the
eligibility rules 7, the policy 1. CI also applies every migration **twice** to prove they are
re-runnable, and that step passes.

App: `npx tsc --noEmit` is clean and the full suite passes — 539 tests plus the auxiliary suites,
including the 10 new region tests. CI's "Typecheck, test & web build" job is green on this commit.

CI status, stated plainly: the **CI workflow as a whole is red, and was red before this work** — the
two failing jobs fail identically on `93b305a` (the shipped 1.0.129):

| Job | On 93b305a | Now |
|---|---|---|
| Typecheck, test & web build | success | **success** |
| Media Worker bundles & config | success | **success** |
| The offered build says what it changed | success | **success** |
| Database migrations & RLS smoke | failure | failure, **different reason** |
| Verification browser regression (offline) | failure | failure (unchanged) |

The database job used to fail inside `seed.sql` with `Whisper unavailable` raised by
`holup_whisper_insert_guard`. It still does — that is a pre-existing seed-versus-guard conflict, not
something this work touched, and it is the next thing to fix before CI can be green.

One real defect this work *did* find and fix: nine tables (`holup_admin_members`, `holup_admin_audit`,
`holup_account_actions`, `holup_advertisers`, `holup_ad_campaigns`, `holup_ads_settings`,
`holup_payment_providers`, `holup_payment_settings`, `holup_payment_transactions`) existed only in the
live database and had never been written into `supabase/migrations`. Production was fine; a database
built from the repository was not. They are now recorded in
`20261117080000_platform_console_tables.sql`, taken from the live catalogue.

Two further defects surfaced once those tables were in place, both fixed in production and in the
files:

* `holup_admin_members` carried **two** role constraints at once — the console's
  (`administrator`, `moderator`, `analyst`, …) and the new one (`security_admin`,
  `fraud_investigator`, …). Their intersection was `super_admin` alone, so five of the six roles the
  specification asks for could not be assigned to anybody. Now one constraint carrying both
  vocabularies.
* `holup_enforce_action` wrote `'WARN'` / `'SUSPEND'` into a column whose check accepts
  `warn/restrict/suspend/ban/restore/unrestrict`. Every enforcement action would have failed on
  insert. The function now accepts the readable uppercase form and stores the column's vocabulary.

Verified against the live project in a rolled-back transaction: warn succeeds; a permanent suspend is
refused with `409 review_required` until a case exists; opening a case, closing it with findings, then
suspending succeeds; all four steps land in `holup_admin_audit`.

The APK has **not** been rebuilt. These changes are database, edge function and client-library only;
nothing in them is visible to a member until the Flow ad renderer and the admin screens exist, so a new
binary now would carry no user-visible change. The next APK should be cut together with those surfaces,
or with the first real advertiser campaign.

## 6. Files written

```
supabase/migrations/20261117090000_hgri_regions.sql          registry, user regions, history, RLS
supabase/migrations/20261117090100_hgri_region_seed.sql       276-row registry seed
supabase/migrations/20261117091000_security_intelligence.sql  IP registry, events, cases, retention
supabase/migrations/20261117092000_creator_rewards.sql        policy, eligibility, pool, wallets, payouts
supabase/migrations/20261117093000_sponsored_flow.sql         creatives, targeting, delivery, billing
supabase/migrations/20261117094000_analytics_rbac_admin.sql   analytics, roles, admin control surface
supabase/functions/region-intel/index.ts                      geolocation + recording + signals
CrushlyApp/src/lib/region.ts                                  passive client-side trigger
CrushlyApp/src/lib/region.test.ts                             10 tests
CrushlyApp/src/state/auth.tsx                                 wired at session adopt and sign-in
```

The live database is authoritative where a migration file and the database differ; the files above have
been re-synced to the applied definitions where they diverged (status vocabulary, frequency threshold,
account-movement output columns, platform summary aggregates).
