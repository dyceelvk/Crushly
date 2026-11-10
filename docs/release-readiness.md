# Holup — release readiness

**Date:** 2026-11-07 · **Branch:** `build/holup-follow-draft` @ `63f1a6c`
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

## What is still BLOCKED

| Blocker | Why | What unblocks it |
| --- | --- | --- |
| Relationship cutover (Add Ups / Homies / Whispers) | The database half is now validated (above), but it is still not shippable alone: legacy `ensure_conversation` can reopen closed threads, `remove_connection` can close a Whisper via `disconnect_pair`, `messages_pair` RLS has no block predicate, `can_view_media` has no Whisper-consent state, `can_join_whisper` admits unblocked participants, and Realtime knows only membership. The candidates add state that no legacy API, notification, call, media or Realtime path reads yet. Your own rule — never ship the relationship migration independently of a compatible client — is what still blocks it. | The remaining build: rewire `send_message`/`open_conversation`/media/calls/Realtime/notifications onto the new state, gate legacy writes, ship the matching client, then apply the migration in the same release. The database validation that used to gate this is done. |
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

## Order of release

1. Web client copy (16+ wording, share fixes) — safe now, because the server is already 16+.
2. Relationship cutover — only after disposable-database validation and a coordinated client build; never piecemeal.
3. Secure Android release — after the keystore, the integrity metadata and the physical upgrade test.

Draft artefacts to review before anything ships: `docs/relationship-cutover-audit.md`, `docs/public-preview-audit.md`, `docs/release-readiness.md`, `/home/user/holup-public-preview-available.html`, `/home/user/holup-public-preview-unavailable.html`.
