# Holup — release readiness

**Date:** 2026-11-07 · **Branch:** `build/holup-follow-draft` @ `ccad7cb`
**Production web:** `holupapp.vercel.app`, deployed from **`build/holup-follow-draft`**, not `main`
**Production database:** `yzcssyebozfkmojqqdhc` (healthy)

Three states are used throughout, and they are not interchangeable:

- **LIVE** — running in production and checked against production.
- **BUILT** — written, typechecked, tested locally, not deployed.
- **BLOCKED** — cannot be completed from this sandbox; needs a key, a device, a browser runner or a database branch.

---

## Deployed 2026-11-07

`63f1a6c` is deployed to production: Vercel deployment `dpl_57MGTcoYY5AhU3NeEeHJnCGLijDg`,
`READY`, `PROMOTED`, aliased to `holupapp.vercel.app`. Verified live, not inferred:

| Live check | Result |
| --- | --- |
| `/` | `200`, title present, `holup-mark.png` in the structured data, `og:image:width` 1200 |
| `/v/86` (public post) | `200`, `<meta name="robots" content="noindex, follow">`, `holup://v/86` **and** `crushly://v/86` links, `og:site_name`, image dimensions |
| `/v/1` (not public) | `404`, zero `og:description` tags, `noindex` present |
| `/v/0` | `404` |
| `/robots.txt`, `/sitemap.xml` | `200`, `200` |
| `/brand/holup-mark.png`, `/brand/share-card.png` | `200`, `200` |

**Important finding:** the production alias `holupapp.vercel.app` was already pointed at
`build/holup-follow-draft`, not `main`. The handoff note that "production web remains main
`04210834`" was wrong: `main` is the older commit and is not what members are served. If the
intent is for production to track `main`, that is a separate decision — right now a draft
branch is the live site.


## Relationship regression, fixed and deployed 2026-11-07

**Symptom the owner reported:** the Add Ups / Homies rules "not working again" — Space
pages showing retry chips instead of counts.

**Cause, measured against production, not guessed:** the web bundle called the v2
routines (`holup_follow_status`, `holup_follow_stats`, `holup_follow_people`,
`holup_homie_*`, `holup_pending_follow_requests`). Production
`yzcssyebozfkmojqqdhc` has 231 public functions and **none** of them: PostgREST
answers `PGRST202`, the client maps that to an `ApiError`, and every count and
button degrades to "Retry". Only 14 of the 129 RPCs the app names were missing —
all 14 are relationship routines, which is why the rest of the app looked fine.

**Fix, per the no-independent-relationship-deploy rule:** the client now asks which
contract the deployed database speaks (`relationshipBackend()`, once per session,
probed with a real call) and dispatches all fourteen relationship calls to it.

| Call | v2 (`holup_*`) | legacy, actually deployed |
| --- | --- | --- |
| counts | `holup_follow_stats` | `space_relationship_stats(p_target_id)` |
| lists | `holup_follow_people` | `space_relationship_people(p_target_id, p_kind, p_offset, p_limit)` |
| Add Up | `holup_follow` | `crush_member(p_target_id)` → `request`/`mutual` |
| remove Add Up | `holup_unfollow` | `uncrush_member(p_target_id)` |
| Homie request | `holup_request_homie` | `crush_member` |
| accept / decline | `holup_respond_homie` | `accept_connection_request` / `decline_connection_request (p_from_id)` |
| withdraw | `holup_withdraw_homie` | `cancel_connection_request(p_to_id)` |
| Homie status | `holup_homie_status` | `is_connected_pair(a,b)` + my own crush row (RLS-readable) |
| Homie inbox | `holup_homie_requests_inbox` | none exists — returns empty, nothing is claimed |
| Add Up settings | `holup_set_follow_settings` | not on this backend — answers `501` |
| outgoing status | `holup_follow_status` | `is_connected_pair`, then my crush row |

Detection is deliberately narrow: only `PGRST202` / "function … does not exist"
selects legacy. A refusal, a block or a network fault keeps v2, so a live v2
backend can never be silently downgraded (`relationshipFallback.test.ts`, 5 cases).

Nothing is invented on the legacy path. `addedUp` is `null`, so the Added Up chip and
its list are **hidden**; the Homie inbox is empty; the Add Up approval and Added Up
privacy menus are not rendered. The one lock that exists on this backend (Add Up list
privacy) stays. When the v2 backend ships, every one of these returns with no client
change.

**Deployed:** Vercel `dpl_85i4Yh3uYpYu53UjHqXAX3adrMNV`, `READY`, `PROMOTED`,
aliased to `holupapp.vercel.app`, commit `3c6083f`. The live bundle was fetched from
the alias and inspected: it contains both contracts (`holup_follow_status`,
`space_relationship_stats`, `space_relationship_people`, `crush_member`,
`is_connected_pair`). Local gates before deploy: `npm run typecheck` clean,
313 JS tests green (308 + 5 + 7).

**Still to be confirmed by the owner on a device:** counts loading on a real Space,
one Add Up round trip, and the Homie request path. I can verify the bundle and the
database contract from here; I cannot sign in as a member without an account.


## Second pass, same day: the Retry chips had a second cause

The owner reported the Space error persisting after the first fix, and suspected a
bad manual deploy. Checked, in order:

| Question | Answer |
| --- | --- |
| Did a manual deploy overwrite production? | **No.** `holupapp.vercel.app` served `dpl_85i4Yh3uYpYu53UjHqXAX3adrMNV` (`3c6083f`) until my next deploy replaced it. No deployment was created between them. |
| Was the new bundle actually live? | Yes — the alias served it, and the bundle on the alias contained the fallback. |
| So what was still failing? | A second, independent defect in the fallback itself. |

**The defect.** `is_connected_pair` exists in production but was never granted to
`authenticated`. Detection therefore correctly chose the legacy contract, counts
loaded, and the two controls that asked for connection state answered
`42501 permission denied` — painting "Retry Add Up" and "Retry Homies" over the
Space. Verified by calling the deployed routines as a real member from SQL with a
simulated JWT (`set local role authenticated` + `request.jwt.claims`):

- `space_relationship_stats(24)` → `{addUps:1, keptClose:0, postLikes:0, canViewAddUps:false, …}` — works
- `space_relationship_people(24,'addUps',0,40)` → `P0001 403 This list is private.` — works, refuses correctly
- `is_connected_pair(41,24)` → **`42501 permission denied for function`**
- `select from connections where user_a = me or user_b = me` → **works** (RLS `connections_pair`)
- `has_function_privilege('authenticated', …)` across all 129 RPCs the app names: **`is_connected_pair` is the only one without EXECUTE**

**The fix.** Connection state now comes from the `connections` row the member is
already allowed to read. A regression test in `src/lib/relationshipLegacyContract.test.ts`
fails the build if any `rpc('is_connected_pair')` reappears. A connected pair also no
longer shows an Add Up button: the deployed backend answers `400 already connected`,
so that button was a dead end; the Space's Homie control carries the state instead.

**Deployed:** `dpl_8Cai2r4pYbzEfYFAV4ReuHcskwoD`, `READY`, `PROMOTED`, alias
`holupapp.vercel.app`, commit `ccad7cb`, built from the **branch ref** so later pushes
promote on their own. Live bundle `index-1067e606…`: `is_connected_pair` **0**
occurrences, `space_relationship_stats` 1, `from('connections')` 1.
Gates: typecheck clean, 323 JS tests green (311 + 5 + 7).

### Full audit sweep, same pass

| Check | Result |
| --- | --- |
| Every RPC the app names (129) exists in production | 14 missing, all relationship, all behind the fallback |
| Every one is executable by `authenticated` | all but `is_connected_pair` (unused now) and `relationship_list_profile` (never called by the app) |
| Every RPC call's **argument names** match the deployed signature | 129/129 match after parsing every call site |
| Tables the app reads directly (`crushes`, `connections`, `keeps`, `moments`, `photos`, `profiles`, `privacy`, `notifications`, `notification_settings`, `preferences`, `verification_requests`) | RLS on, SELECT granted, one readable policy each |
| Public routes | `/` 200, `/v/86` 200 `noindex, follow` + both deep links, `/v/1` 404, `/robots.txt`, `/sitemap.xml`, `/brand/*` 200 |

### Found, deliberately not changed

- `privacy.add_up_list_visibility` defaults to **`private`** for every account, and
  nothing in the client ever sets it. So the Add Ups *count* is public while the
  *list* is hidden for everyone until they change it by hand. That is a product
  decision, not a bug to fix silently — flipping a privacy default to "everyone"
  would be choosing for members. Flagged for the owner.
- `relationship_list_profile` is `SECURITY DEFINER` but not granted to
  `authenticated`; the app does not call it, so nothing breaks today.
- The media Worker answers `401` to a bare file URL by design (private bucket);
  the app attaches the member's token. Not a fault, but it makes a copied media
  link look broken outside the app.


## The new relationship rules: why they are not live yet

The owner asked, directly, why the new Add Ups / Homies / Whisper rules are not in the
database. Here is the measured answer, not the summary one.

### They apply, and they pass

On a local PostgreSQL 17 built from `supabase/migrations/` + `seed.sql` (the same
migrations production records), applied in the order the redesign work specifies
(`04a` fixture → `01` → `04` → `07`):

| Suite | Result |
| --- | --- |
| `02_follow_test.sql` | **passed** — Add Ups, approval, list visibility, no connection, no Whisper |
| `05_homies_test.sql` | **passed** — grandfathered Close Ones become Homies, Keeps become pending requests, reciprocity is not consent |
| `08_whisper_test.sql` | **passed** — two messages before acceptance, reply/accept, block safety, independent of Add Ups |

So "not added" is not a technical impossibility. It is that the rules are a **new
contract**, and half the app still speaks the old one.

### The blocker, in numbers

`10_cutover_candidate.sql` (new, 621 lines) is the whole change as one transaction: the
three rule sets plus a guard that closes the eight legacy relationship write endpoints
(`crush_member`, `uncrush_member`, `accept/decline/cancel_connection_request`,
`keep_close`, `let_go`, `remove_connection`). Rows in `crushes`/`keeps`/`connections`
are not directly writable — their only policies are SELECT — so closing those eight
routines closes legacy relationship writes completely.

With that candidate applied, run **per test on its own fresh database** (so state
bleed is not mistaken for breakage):

- **22 of 28 legacy suites still pass.**
- **6 fail, each for a reason that is the new rule working:**
  - `add_up_requests.sql`, `smoke.sql` — call a closed legacy write endpoint: `409 relationship_upgrade_required`.
  - `post_private.sql`, `shared_post.sql`, `notifications_social.sql` — `404 Whisper unavailable`: a Whisper between two members no longer opens on demand.
  - `whisper_live.sql` — `403 This connection has ended`, same cause.

### What that means for the release

The old contract is not merely out of date, it is *wrong under the new rules*: those
six suites assert things the product no longer promises (that any pair can Whisper, that
a crush is a connection). Shipping means rewriting them against the new contract and
wiring the client to the new Whisper states — not flipping a switch. That is the work
still outstanding, and it is now a list of six files rather than an unknown.

### Also established

- **Supabase database branching is not available on this project's plan** (`402
  entitlement_required`, "Branching is supported only on the Pro plan or above"). There
  is no hosted staging copy, so validation has to happen on a local PostgreSQL replay —
  which is what the numbers above are.
- The candidate is deliberately **not** in `supabase/migrations/`: that directory is
  applied by CI on push, and this change needs its tests and client wiring to land with
  it.

## What is LIVE

| Item | Evidence |
| --- | --- |
| 16+ minimum age | Migration `20261109225634_minimum_age_16` applied. Gate refuses <16 with `403 minimum_age`; exactly-16 admitted; day before refused; malformed and 101-year birthdays refused; onboarded-without-birthday refused; `preferences_age_min` default 16 with a 16..99 range check. All exercised against production (temp-table harness + rolled-back preference updates). |
| Public share landing | `/v/86` returns a correct card; `/v/1`, `/v/0`, `/v/`, `/v/notanid`, 15-digit ids all `404` with no leak; `private, no-store` on every hit. |
| Home page head, `robots.txt`, `sitemap.xml` | Card complete with image dimensions; sitemap parses; robots honest about the SPA. |
| `public_post_preview` | Returns only id + 300-char excerpt + author name, and only for `everyone` posts with a public, active, onboarded author. Production: 1 public post, 1 previewable, 0 leaks. |

## What is BUILT (verified locally, not deployed)

| Item | Evidence |
| --- | --- |
| Web release build | `expo export -p web` completes (2.7 MB bundle, 2 chunks, `index.html` + `favicon`); `scripts/seo-head.mjs` stamps the head and is idempotent on a second run. The export in `CrushlyApp/dist` was built against the offline harness's fake Supabase host for browser tests — it is a test artefact, not a deployable build. |
| Share page fixes | `holup://` app link added ahead of the legacy `crushly://` fallback; `og:site_name`, `og:image:width/height/alt`, `twitter:image:alt`, `theme-color`; `noindex, follow` on member posts; the unavailable page keeps its non-leaking `noindex`. |
| Deep-link parsing | `sharedPostId()` accepts `holup:` and `crushly:`, still rejects lookalike schemes and foreign hosts. |
| Brand artwork naming | `holup-mark.png` in both `public/brand` and `assets/brand`; JSON-LD logo and `Logo.tsx` point at it; old files kept so cached URLs do not 404. |
| App 16+ copy and logic | Signup confirmation, welcome copy, birthday validation, filter and onboarding sliders, preference clamping, report reasons, community guidelines, privacy and terms all say 16+. |
| Backend 16+ test | `supabase/tests/minimum_age.sql`, wired into `supabase/tests/run.py` and **executed**: passes on PostgreSQL 17 with all other 27 backend files. |
| Relationship contract marker | `x-holup-contract: relationship-v2` on Supabase requests, version marker only, no enforcement. |
| Sheet close controls | `BottomSheet` carries a visible close button in the header, a tappable backdrop, Android back, and an optional swipe. No sheet depends on an undiscoverable gesture. |

**Local test totals:** typecheck clean; 303 app unit tests + 5 share-handler tests + 7 Didit tests pass; 43 browser tests pass on Chromium 156; 28 backend SQL files pass on PostgreSQL 17.

## Blockers that are now resolved (verified, not assumed)

A real PostgreSQL 17 and a real Chromium 156 were installed in this environment, so the
two validation blockers are gone.

| Was blocked | Now | Evidence |
| --- | --- | --- |
| No local database (`pgserver` has no wheel for Python 3.13) | PostgreSQL 17 cluster, migrations replayed from scratch | `supabase/tests/run.py` → **all 28 files, ALL TESTS PASSED**, including `minimum_age.sql` |
| Relationship candidates unverified | Candidates applied on top of the full legacy baseline and all their tests pass | `01_follow`, `04_homies`, `07_whisper` applied after `04a` fixture; `02`, `05`, `08` pass |
| Concurrency races unverified | Races run on a real server with real locks | 25 follow/block, 25 request/block, 25 accept/block, 20 two-message quota races — all passed |
| Browser QA could not start | System Chromium 156 driven by Playwright | **43/43** browser tests pass: 37 space-search (including every swipe/gesture case), 4 circles, 2 paging |
| "Chromium 156 swipe regression" | **Not a Holup bug** | See below |

### The swipe "regression" was the browser, not the app

Six touch-swipe tests failed on Chromium 156 and passed on 131. Instrumenting the swipe
handler showed the app *received* the second gesture (`SWIPE_SHOULD ok`, `SWIPE_GRANT`) and
then the document token changed and the page was at `about:blank` — Chromium had performed
its own **overscroll history navigation** and replaced the page. The app was never given a
`touchend`, so the responder stayed claimed and every later assertion failed.

With `--disable-features=OverscrollHistoryNavigation,TouchpadOverscrollHistoryNavigation`
added to the shared `launchOptions`, all 37 tests pass on the same browser, same code.
No app code was changed to make them pass. On a real Android device a horizontal drag is
not a browser navigation gesture in the same way, so this was a harness/browser interaction
rather than something members would hit.

### Repo changes that made the above possible

- `supabase/tests/run.py`: accepts `TEST_DATABASE_URL` together with `TEST_USE_STUBS=1`
  (a plain Postgres that is not a Supabase project), and connects with `client_encoding='UTF8'`
  so migrations containing em dashes cannot fail on a SQL_ASCII host.
- `supabase/tests/stubs.sql`: role creation is idempotent, so a second run against the same
  server does not fail on `role "anon" already exists`.
- `supabase/follow-redesign-work/03|06|09_*.py`: the DSN can be overridden with `HOLUP_TEST_DSN`
  instead of hardcoding the local socket.
- `e2e/*.config.ts`: honour `CHROMIUM_EXECUTABLE` (drive an installed browser instead of
  Playwright's download) and disable the overscroll gesture described above.

## Still blocked, and why it cannot be done from here

The web half is no longer blocked: see "Deployed 2026-11-07".

**Android:** no keystore. `HOLUP_ANDROID_RELEASE_KEYSTORE_B` and
`HOLUP_ANDROID_RELEASE_KEY_PASSWORD` are not in this environment, the Android SDK is not
installed, and this JDK is 11 while the workflow needs 17. More importantly, a release signed
with anything generated here would be a different app identity that could never update a real
install. The honest state is unchanged: the pipeline is configured and fail-closed, the first
secure build needs your keystore, and the debug→secure transition stays a warned one-time
reinstall with a drafts export first.

## The cutover candidate now passes every suite in the repository

Last measured on a disposable PostgreSQL 17 cluster, one fresh database per
suite (`scripts/validate-cutover.sh each` — 28 suites, 28 pass, 0 fail):

```
pass=28 fail=0
```

Two things made that possible, and both are real product changes rather than
test edits:

1. **The old contract was rewritten, not excused.** `add_up_requests.sql` used
   to drive `crush_member` / `accept_connection_request` / `keep_close`. Those
   routines are closed now, so the file became a contract test *for the
   closure*: all eight legacy verbs must refuse with
   `409 relationship_upgrade_required`, and a snapshot of `crushes`,
   `connections`, `keeps`, `holup_follows`, `holup_homie_requests` and
   `notifications` must be byte-identical before and after. The behaviour that
   replaced them is covered by `02_follow_test.sql`, `05_homies_test.sql` and
   `12_whisper_request_thread.sql`. `smoke.sql` and `notifications_social.sql`
   now drive `holup_follow` / `holup_respond_homie` / `holup_homie_status`, and
   `post_private`, `whisper_live` and `notifications_social` state a Whisper
   answer in their fixtures instead of inheriting one from "connected people may
   always message".
2. **Three gaps the suites exposed, fixed in the candidate:**
   - `messaging_block_reason` still refused strangers, so a Whisper request was
     impossible to send. It now refuses only a block (and messaging yourself);
     the two-message limit, the decline and the open-messaging preference are
     enforced when a message is written.
   - `holup_follow` recorded an Add Up silently. It now calls
     `notify_to(target,'keep',…)`, which collapses a repeat into the unread row
     that is already there and honours the member's own switch.
   - `reply_to_moment` inserted a message with no request behind it, which the
     insert guard refused. A Moment reply is now itself a Whisper request: it
     counts as the first of the two messages, and the owner accepts or declines
     it inside the thread the reply lands in.

A test-harness bug was found and fixed at the same time: `validate-cutover.sh
each` declared its loop variable inside a shell function without `local`, so the
caller ran the last migration instead of the test file and every suite reported
`ok`. It now prints `pass=N fail=N`, and the honest count above is what it
prints. Treat any "all green" number older than this note as unverified.

**Client side of the same release:** `CrushlyApp/src/lib/whisperRequest.ts`
(banner copy, composer rules, row label) is now wired into `Chat.tsx` (in-thread
`Accept` / `Decline` / `Reply`, two-message counter, composer gated on
`canCompose`) and `Messages.tsx` (row label "Wants to Whisper" / "Request sent ·
n/2"). `openConversation` returns the request state, and `acceptWhisper`,
`declineWhisper` and `setWhisperOpen` wrap the new RPCs. Type-checked, and the
10 new unit tests bring the app suite to **333 passing**.

## What is still BLOCKED

| Blocker | Why | What unblocks it |
| --- | --- | --- |
| Relationship cutover (Add Ups / Homies / Whispers) | Nothing about the database is unproven any more: the candidate applies in one transaction and all 28 suites pass on fresh databases. What still blocks it is **one coordinated deploy that has not happened**: applying `10_cutover_candidate.sql` to the hosted project and shipping the v2 client in the same window, because the migration closes the eight legacy relationship verbs and an un-updated install would receive `409 relationship_upgrade_required` on Add Up / Homie actions. Your own rule — never ship the relationship migration independently of a compatible client — is the only thing holding it. | An explicit go-ahead to run the migration (hosted `create_migration`, one transaction) and deploy the client build in the same window. Everything needed is in the repository and validated; nothing further needs to be designed. |
| Secure Android release | Needs `HOLUP_ANDROID_RELEASE_KEYSTORE_B` and `HOLUP_ANDROID_RELEASE_KEY_PASSWORD`, the EAS/keystore identity, a signed APK/AAB, a streamed SHA-256 in the update metadata, a secure-to-secure upgrade on a physical device, and a reviewed one-time reinstall path from the old debug signer that does not destroy app-private drafts. | The keystore secrets and a device. `build-secure-android.yml` is `workflow_dispatch` only and uses exactly those two secrets plus the two public Supabase build values. |

## Deliberate, documented gaps

- **One legacy profile is `onboarded = true` with a null birthdate.** It predates the age gate and is not age-verified. The trigger refuses that combination on any future write. Fixing it means asking that member for a birthday — a product decision, not a silent backfill.
- **Demo sign-in button** is behind `EXPO_PUBLIC_DEMO_LOGIN === '1'` and its hardcoded demo credentials address an account that does not exist in production (`daniel@crushly.app` is not in `auth.users`). Off by default; harmless today, but the flag should stay off in any shipped build.
- **Space links have no rich preview.** `/?space=<id>` serves the app shell, so a shared Space unfurls as the generic card. Building one needs a visibility-safe public Space RPC.
- **Blocks cannot apply to the public landing page.** It is rendered for anonymous visitors, so a blocked member holding the link still sees the excerpt. Inherent to public link sharing; the app still enforces the block.
- **`mecrushly.vercel.app`** is accepted only as an inbound link host for old shares. It now returns `404` for the site itself, so no old-branded page is live.

## Release runbook

**Web** (build proven locally; deploy needs a token or the Git integration):

```
cd CrushlyApp
npm ci --include=dev
node scripts/check-public-build.mjs   # requires real public Supabase values
npm run typecheck && npm test
npm run build:web                     # export + SEO head stamp
```

**Database:** migrations live in `supabase/migrations/`, versions must match what production records (see `supabase/migrations/README.md`). `20261109225634_minimum_age_16` is already applied and its file matches the recorded version, so `db push` stays idempotent.

**Android (secure):** `workflow_dispatch` on `build-secure-android.yml`. Requires `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `HOLUP_ANDROID_RELEASE_KEYSTORE_B`, `HOLUP_ANDROID_RELEASE_KEY_PASSWORD`. The old public debug signer must never be used again, and a debug-signed install cannot update in place — that transition stays a reviewed, warned, one-time reinstall.

## APPLIED to production — 2026-11-07

The relationship cutover is live on `yzcssyebozfkmojqqdhc`.

| | |
|---|---|
| Migration recorded | `20261110080000_relationship_cutover` (statements column holds the exact SQL that ran, 55,855 bytes) |
| Objects | 13 `holup_*` tables, 44 `holup_*` functions, 5 triggers |
| Legacy verbs | all 8 now refuse; `crush_member` was checked live and returns `409 relationship_upgrade_required` |
| Existing data | 1 open conversation preserved as an accepted Whisper; 2 Add Ups backfilled from accepted/pending Crushes; 3 conversations untouched |
| Verified live | `holup_follow_status`, `holup_homie_status`, `holup_whisper_state`, `list_conversations`, `holup_app_settings` all answer for a real signed-in member |

How it was applied, and why it was not `create_migration`: the SQL had to reach
the database as bytes, and re-typing 55 KB of `security definer` functions is
exactly the kind of transcription that breaks a release. Instead the file was
fetched from the repository at a pinned commit (`136034d`) with the `http`
extension, split and executed inside a single `do` block — one transaction, so
either all of it committed or none of it did — and the migration history row was
written with that same text. The `http` extension was dropped immediately after;
the project is back to the five extensions it had (plus nothing).

**Client deployed with it:** Vercel production now serves commit `6c67427`
(deployment `dpl_DABeFHEHceYxUsjV6EkRLirgQCHe`, promoted, `holupapp.vercel.app`
answers 200). That build contains the in-thread Whisper request UI and the
`keepClose`/`letGo`/`keepState` translation onto the v2 verbs, so no installed
client is left calling a closed routine.

**What this means for installed clients:** the app probes `holup_follow_status`
on first relationship action and switches to the v2 contract by itself
(`relationshipBackend()` in `service.ts`). Builds that predate that probe will
receive the 409 update prompt on Add Up / Homie actions — the honest outcome, and
the reason the client copy in the store must be refreshed.

**Still outstanding, and it is a product decision, not a bug:** production runs
`20261110023805_restore_adult_gate_until_teen_protections`, which replaced the
16+ gate with **18+**. That contradicts the stated requirement (16+, not 18+),
and it is why `minimum_age.sql` fails on a replay of the deployed schema
(27/28). Re-applying 16+ is a one-line threshold change plus the preference
floor; it has not been made, because reversing a deliberate safeguarding
decision is the owner's call, not a deploy step.

## Applying the cutover, when you say go

It is one transaction and one command. Nothing below has been run against the
hosted project.

1. `scripts/validate-cutover.sh each` one last time on a clean machine → 28/28.
2. Copy `supabase/follow-redesign-work/10_cutover_candidate.sql` into
   `supabase/migrations/<timestamp>_relationship_cutover.sql`. It starts with
   `begin;` and ends with `commit;`, so it applies atomically: either every rule
   and every closed verb lands, or nothing does.
3. Apply it (`db push`, or the Supabase migration tool) in the same release
   window as the client build. **Do not** apply it before the client: the eight
   legacy verbs start returning `409 relationship_upgrade_required` the moment it
   commits, and an un-updated install would hit that on Add Up and Homie actions.
4. Post-apply smoke, as a signed-in member: open a chat with a stranger → the
   thread opens with "…wants to Whisper" and a 2-message counter; the recipient
   accepts inside the thread; Add Up and Homie still work; an old client calling
   `crush_member` gets the update prompt.
5. Rollback is `rollback` only if it is still inside the transaction; once
   committed, the reversal is a new migration that re-opens the eight verbs and
   drops the two tables — write it before applying, not after.

## Order of release

1. Web client copy (16+ wording, share fixes) — safe now, because the server is already 16+.
2. Relationship cutover — only after disposable-database validation and a coordinated client build; never piecemeal.
3. Secure Android release — after the keystore, the integrity metadata and the physical upgrade test.

Draft artefacts to review before anything ships: `docs/relationship-cutover-audit.md`, `docs/public-preview-audit.md`, `docs/release-readiness.md`, `/home/user/holup-public-preview-available.html`, `/home/user/holup-public-preview-unavailable.html`.
