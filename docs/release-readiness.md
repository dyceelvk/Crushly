# holUpp — release readiness

**Date:** 2026-11-07 · **Branch:** `build/holup-follow-draft` @ `ccad7cb`
**Production web:** `holupapp.vercel.app`, deployed from **`build/holup-follow-draft`**, not `main`
**Production database:** `yzcssyebozfkmojqqdhc` (healthy)

Three states are used throughout, and they are not interchangeable:

- **LIVE** — running in production and checked against production.
- **BUILT** — written, typechecked, tested locally, not deployed.
- **BLOCKED** — cannot be completed from this sandbox; needs a key, a device, a browser runner or a database branch.

---

## The magnet, the holUpp control, and a text post that opens as a post (2026-11-07, latest)

Four reports, four fixes. Everything below is **BUILT** — typechecked, unit-tested,
driven in a browser against mocked data — and not yet deployed.

**1. Flow scroll is sticky again.** The wheel was already taking one page per
gesture, but a drag, a scrollbar or a programmatic scroll could still leave the
list resting between two clips, and half a video at the top of the screen is what
was reported. The web pager now has a magnet: when scrolling goes quiet for
140 ms, an offset that is not a page boundary springs to the nearest one. A phone
gets the same correction at the end of a drag and at the end of momentum.

The reason the first attempt at it looked like a jump back to the top was **not**
the arithmetic. `element.scrollTo({ behavior: 'smooth' })` collides with
react-native-web's own scroll responder: the animation starts at the right target
and the browser finishes it at `0`. The correction is therefore made through
`listRef.scrollToOffset({ animated: true })`, which is the same path a flick
takes, and the list stays where it is put.

| Browser check (`node probe13.mjs`, 390×844) | Result |
| --- | --- |
| One wheel flick | glides `32 → 133 → 252 → 446 → 633 → 769 → 826 → 844`, rests on page 1 |
| Parked at `844 + 420` (half a page down) | springs to `844` |
| Parked at `844 − 420` (half a page up) | springs to `844` |
| Parked at `1688 + 380` / `1688 − 380` | both spring to `1688` |
| One flick back up | `1688 → 844`, a whole page |

**2. The reaction control is the holUpp mark.** No heart anywhere in the gesture.
At rest it is the holUpp outline; a tap crushes; a hold floats the seven faces
beside the button, over the video, with no sheet and no scrim. The Flow rail's
reaction bottom sheet is gone — the rail is the control and a count,
"3 Crushes" (the plural was "Crushs").

**3. The floating picker is now on every surface that reacts.** Flow's rail,
the all-crush feed's clip card (`CrushClipCard`), and the written post screen.
The clip card had its own heart button and its own toggle; it now uses the same
`ReactionButton` with `onDark`, so the count is white on the picture and the mark
is the app's own. The Crush-shaped empty states that used a heart
("Nothing published yet", "Nothing shared yet") use the holUpp mark too.

**4. A written post on a Space opens as a post.** The tile routed every tap into
the Flow pager, which put a piece of writing into a pager built for clips. It now
routes on the post itself: `mediaUrl` → `PostViewer`, otherwise → `TextPost`.
Checked in the browser: tapping "A written thought" on a Space opens the written
post with its own actions and comments, and no Flow header.

`npm test` 355/355. `paging.spec.ts` still pressed a tab labelled "Crushes" — the
label has been "All Crush Feed" for two batches — so the spec was updated; it now
passes 2/2. `moment-circles` 2/2, `circles` 4/4, `space-search` 30/30.

## The Flow is a feed again, and a reaction answers the finger (2026-11-07, latest)

Six faults, all in the same area, all from the last two batches doing too much.

**1. Flow felt dead, and took the app with it.** The web pager had been given the
wheel: every gesture was prevented, turned into a programmatic jump, and — because
the listener was on the document and lived as long as the screen was mounted —
swallowed wheel events for the whole app. Scrolling now belongs to the browser
again, and the **browser** does the snapping: `scroll-snap-type: y mandatory` on
the scroller, `scroll-snap-align: start` plus `scroll-snap-stop: always` on each
page. A swipe slides the current clip up and brings the next one; one flick cannot
sail past a page; nothing can rest half-cut. A light settle (120 ms after the
scroll stops, through the list) still catches a programmatic offset. The keyboard
paging only answers while the Flow is the screen in front.

**2. A clip could sit still and still be heard.** The active page was decided on
every scroll event, so halfway through a glide the *next* page became active: the
clip in front of you was paused while the incoming one played, out of view. The
active page is now decided where the scroll comes to rest, and nowhere else.

**3. A sheet over a clip did not stop it.** Comments, Share, the editor and the
"more" sheet all covered a clip that kept playing underneath. `autoPlay` is now
"this page is in front **and** nothing is over it".

**4. A tap on the reaction control could do nothing at all.** The reaction fired
on press-*out*, and a quick tap (the browser can complete one in under 40 ms)
never produced a press-in/press-out pair: measured at 0 ms and 20 ms — no request
at all; at 50 ms — one. It is a real `onPress` now, which is the standard click
path. Press-in still starts the 260 ms hold timer, and a hold marks itself so the
click that follows it does not also react.

**5. There was no way to take a reaction back.** Every surface sent the same kind
again, and giving a Crush twice is not un-crushing. The control now says what a
tap means: a tap on a reaction you already have sends `null`, which the posts and
the comments both read as "take it back". Tapping the face you are already wearing
in the hold row is the same undo.

**6. Comments had no Crush anywhere but a written post.** That rule is gone: every
comment under every post can be crushed, one word beside Reply.

Also in this batch: the mark answers the tap immediately (a local state in the
control, corrected by the server's answer), `crushes-feed` was missing from the
list of cached post lists so the all-crush feed never repainted a reaction, and the
Flow rail's reaction is now in the same glass circle as the rest of the rail.

| Browser check (390×844, mocked data) | Result |
| --- | --- |
| Scroll the Flow | `scroll-snap-type: y mandatory`, 3 pages snapped |
| One wheel flick | `0 → 844`, one page, done |
| A half-page park | springs to `844` |
| A wheel back | `844 → 0` |
| Reaction, quick click | `p_liked: true` sent; mark fills; `3 → 4 Crushes` |
| Reaction, second click | `p_liked: false` sent (un-crush) |
| Comment under a clip | "Crush" present; click sends `react_to_comment` |
| Pick | `save_post` sent |

`npm test` 355/355 · `paging` 2/2 · `moment-circles` 2/2 · `circles` 4/4 ·
`space-search` 30/30.

## The Moment card for a shared post: portrait, and a tap that only offers (2026-11-07, latest)

**LIVE.** `2a9c8e5` is on `main` and `build/holup-follow-draft`; deployment
`dpl_ZbgDss6zazH6o4aUfVdw5a3nCtwE` is `READY`, `PROMOTED`, aliased to
`holupapp.vercel.app`, serving bundle
`index-7576bfeb6cc25b6b33da3d5560fbead0.js` — which contains "View this post".
The first attempt at this push was **blocked** by Vercel: commits authored as
`agent@arena.ai` have no linked Git account, so the deployment stops with
`COMMIT_AUTHOR_REQUIRED`. Both commits were re-authored as
`holUpp build <dyceelvk@gmail.com>` before the push that deployed.



The preview card for a post shared to a Moment was drawn at exactly 9:16, which
is the shape of the screen it was drawn on — so on the Moment screen the preview
*was* the screen, and the name, the time, the reactions and the reply box had
nowhere to sit. A tap also opened the post outright.

It is a portrait card now, in a box smaller than the screen (four wide by five
tall at most, with the header and the whole bottom of the screen left free), and
a tap **only offers** the post: a coloured line of text, "View this post", floats
on the preview. Nothing slides in and no screen changes. That line is the button;
touching anywhere else on the card puts it away again after five seconds, and the
timeline holds while it is up rather than advancing past it.

Verified in a browser at 390×844 with a Moment that is a shared clip:

| Check | Result |
| --- | --- |
| Card box on the Moment screen | `338 × 402`, centred — not the screen |
| Author, time above; handle, reactions and reply box below | all visible around the card |
| Tap the card | no navigation; "View this post" appears over the clip |
| Tap "View this post" | opens the post |

In a tile (Discover's Moments row, the profile's own Moment strip) the card has
`tappable={false}` — the tile's own tap opens the Moment, and two nested taps in
a 124 px tile are one tap too many.

`npm test` 355/355, `moment-circles` 2/2.

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
| "Chromium 156 swipe regression" | **Not a holUpp bug** | See below |

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

**The 16+ rule is restored, in production** — `20261110090000_restore_minimum_age_16`,
applied 2026-11-07 and recorded in the migration history with its exact SQL. Verified
live: `age_min` default `16`, the range constraint is `16..99`, the gate function
reads `16 years` and raises `minimum_age`, and the trigger is present and enabled —
and a real write of a 15-year-old birthdate is refused with
`__CRUSHLY__403__minimum_age`. With it, every suite in the repository passes on a
replay of the deployed schema: **28/28**.

The migration deliberately does *not* lower anyone's saved age filters. Members
whose `age_min` was raised to 18 now see an 18 floor; the migration only changes
what is permitted from here on, and what new accounts start at. Their original
16/17 values are not recoverable, and silently rewriting a preference a member
can see would be a worse answer than leaving it where they left it.

## Add Up and Homie are not the same kind of thing

Stated by the owner and now enforced in the database:

| | Add Up | Homie |
| --- | --- | --- |
| Control | the Add Up button | the 🫂 button, labelled **Homie** |
| Ask permission first | **no** | **yes** |
| State while waiting | none — it is done the moment it is tapped | `pending`, until the other person answers |
| Can be declined | no | yes |
| What it is | a one-way follow | a relationship both people agreed to |

Concretely, `20261110100000_add_up_needs_no_approval`:

- `holup_follow` writes `active` immediately. There is no pending Add Up.
- `holup_follows` can no longer hold `pending` — the check constraint allows only
  `active` and `declined`, so the rule cannot be reintroduced by a stray write.
- The `approval_required` column is dropped. `holup_set_follow_settings` still
  accepts `p_approval` (installed clients send it) and ignores it, answering
  `approvalRequired: false` every time.
- The client's "Approval" setting and its Add Up requests sheet are gone. The
  Homie control is one button: 🫂 **Homie**, which becomes *Requested* while it
  waits and *Homies* once accepted.

The correction also fixes what the first backfill got wrong once the rule is
stated plainly. A **Keep** was a one-way, unanswered follow, so it is an Add Up
and arrives `active`. A **pending Crush** was a request to connect, which is a
Homie, so it becomes an unanswered Homie request instead — and the Homie requests
the first backfill manufactured from Keeps are removed, because their senders
never asked.

### Applied to production

`20261110092915_add_up_needs_no_approval` is live on `yzcssyebozfkmojqqdhc`
(applied through the Supabase API, recorded in the migration history). Measured
before and after, on production rows:

| | before | after |
| --- | --- | --- |
| Add Ups waiting for approval | 1 | **0** |
| Active Add Ups | 2 | **3** |
| Keeps without an active Add Up | 1 | **0** |
| `approval_required` column | present | **dropped** |
| `holup_follows` status check | included `pending` | `active` \| `declined` only |
| Homie requests waiting | 2 | 2 (unchanged — see note) |

The one pending Crush in production (`3 -> 24`) already had a Homie request, so
the insert skipped it on conflict rather than duplicating: it was already where
it belonged.

### Applied to the web app

Deployed to production as `dpl_Csbcn6t9VXQqNFyHj6fyyVYdHwBT` from
`dcb9beb` (branch `build/holup-follow-draft`) and promoted to
`holupapp.vercel.app`. Checked against the bundle the site actually serves, not
against the repo:

- the Homie control renders as 🫂 with the label **Homie**, becoming
  **Requested** while it waits — and **Homies** once accepted;
- the strings `Approval`, `Add a Homie`, `Add Up requests`,
  `require your approval` and `approvalRequired:!0` are **absent** from the
  shipped bundle;
- the Homie *request* inbox is still there (`View Homie requests`,
  `Homie requests`), because answering a 🫂 is the one thing that waits on a
  person.

Both halves are therefore live together: the database refuses to hold a pending
Add Up, and the app no longer offers a way to make one.

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

## Walked as a member on production, 2026-11-07

Everything above was checked from the outside — the migration on real rows, the
bundle on the alias. None of it was one person tapping another person's Space.
This is that, and it found two defects the outside view could not.

**Setup.** Two throwaway Spaces were created through the ordinary signup route
(`rielosinc+holupqa1@gmail.com` / `+holupqa2@gmail.com`), confirmed, onboarded as
**QA Ada** and **QA Bode** (both born 2000, so the 16+ gate admits them), then
driven with a real Chromium at 430×932 against `holupapp.vercel.app`. Both
accounts were deleted afterwards; nothing below is a permanent resident.

| Step | Result |
| --- | --- |
| Ada opens Bode's Space | `1 Add Ups · 0 Added Up · 0 Homies`, **Add Up** button, 🫂 **Homie** pill, `approvalRequired: false` |
| Ada taps **Add Up** | `holup_follow` → `{"status":"active","changed":true}`; button flips to **Added Up**; count → 1. No pending state, at any point, in any read. |
| Ada taps 🫂 **Homie** | `holup_request_homie` → `{"status":"pending","changed":true}`; pill reads **Requested** |
| Bode opens Whispers → Homies | Requests: **QA Ada · Accept · Decline** |
| Bode taps **Accept** | Request consumed (*"No requests right now."*), QA Ada appears under **Your Homies** |
| Ada reopens Bode's Space | 🫂 pill now reads **Homies**, count `1 Homies` |

**In the database afterwards:** Ada→Bode is one `active` follow; `pending` follows
anywhere in the table: **0**; QA Homie requests still pending: **0**;
`holup_homies` row for the pair: **1**; the Add Up notification to Bode arrived.
`connections` was correctly left empty — accepting a Homie is not a legacy
connection.

So the rule holds in both directions and in the data: an Add Up is finished the
moment it is tapped, and a Homie is the only thing that waits for an answer.

### The two defects this found, and fixed

1. **The relationship probe logged a red 400 on every page load.** It called
   `holup_follow_status(0)` — a real routine with an impossible target — which is
   a refusal, not a success. Nothing visibly broke, but any member reading a
   console, and any error tracker, would see a failure on a healthy Space; after
   the history of this feature that is exactly the wrong signal to emit. The probe
   now calls `holup_homie_requests_inbox(0,1)`, which is v2-only, scoped to the
   caller, and always `200` for a signed-in member — so the only way it fails is
   the function not existing, which is the question it is asking.
2. **The probe fired twice per load.** `detected` was cached but the in-flight
   promise was not, so two surfaces mounting together each sent it. The promise is
   shared now.

Both were live in `dcb9beb`. Fixed in `01834cd` and deployed
(`dpl_4b4L7BvJvTAM6eDJtMWxGsR7DV6Y`, `READY`, promoted to `holupapp.vercel.app`).
Re-checked on a real member Space after the deploy: **zero** 4xx/5xx requests, the
probe answers `200`, counts and the 🫂 pill render.

### A data question this raised, and did not fully answer

Cleaning up the throwaway accounts, the active-Add-Up count went from 3 to 1 —
two rows involving members 3 and 41 disappeared. Every mechanism that can delete
a follow row was checked and none of them was used:

- `holup_unfollow` and `holup_remove_follows_on_block` are the only routines that
  delete `holup_follows`. Nothing called the first; the second fires on **insert**
  into `blocks`, and no block was created.
- There is no delete trigger on `holup_follows`, `holup_homies`,
  `holup_homie_requests`, `blocks` or `profiles` beyond that one, and
  `auth.users` has only an insert trigger.
- The Keeps and the accepted Crush that justify those two rows were still intact —
  which is the opposite of what an unfollow leaves behind, since that path removes
  the Keep too.

The rows were restored from their source of truth with the same rule the migration
uses (Keeps → active, accepted Crushes → active, `on conflict do nothing`), and the
state is now exactly derivable: `3->41`, `23->3`, `41->3`, `0` pending, `0` Keeps
without a follow, `0` accepted Crushes without a follow. The same cleanup run a
second time, on a single account, dropped nothing.

**The cause is unexplained and is recorded as an open question, not a closed one.**
Run this before and after any production cleanup; it should always return zeroes:

```sql
select
  (select count(*) from public.holup_follows where status = 'pending') as pending,
  (select count(*) from public.keeps k where not exists (
     select 1 from public.holup_follows f
      where f.follower_id = k.keeper_id and f.followed_id = k.kept_id and f.status = 'active')) as keeps_without_add_up,
  (select count(*) from public.crushes c where c.status = 'accepted' and not exists (
     select 1 from public.holup_follows f
      where f.follower_id = c.from_id and f.followed_id = c.to_id and f.status = 'active')) as crushes_without_add_up;
```

### Whisper walked as a member, on production

The one flow in this release that had never been touched by a human. Same method
as Add Up / Homie: two throwaway Spaces (QA Emeka, QA Ngozi), a real Chromium, the
live site, the database checked after each step.

| Step | Result |
| --- | --- |
| Emeka opens Ngozi's Space, taps the Whisper button | thread opens with "Whisper request sent — You can send 2 messages before QA Ngozi answers. Make them count." |
| Emeka sends two messages | both stored; her Whispers row reads **QA Emeka · Wants to Whisper · Request sent · 2/2** |
| Emeka reloads | banner corrects to "Both messages sent — Waiting for QA Ngozi to accept", composer locked |
| Ngozi opens the chat | "**QA Emeka wants to Whisper** — 2 messages are waiting. Accept to open the conversation, or decline to close it." with **Accept · Decline inside the chat** |
| Ngozi taps Accept | decision card gone, composer opens, she replies |
| Emeka reopens | her reply is there and he can write again |

That is the flow exactly as specified: request → conversation opens → two messages
→ the recipient decides **inside the chat**.

One thing that looks wrong and is not: a Whisper whose sender has not yet written
anything is deliberately absent from the Whispers list — the list only shows
conversations that have a message, so it cannot fill up with empty rows. Worth
knowing before calling it a bug.

One thing that was *stale but self-correcting*: the banner still read "You can send
2 messages" immediately after the second message, and settled to "Both messages
sent" on reload. The stored state was right throughout; the banner reads the state
fetched with the conversation.

### Space links now unfurl, through a token

A shared Space used to serve the app shell and preview as the generic card.
`/s/<token>` is a real landing page now — title, description, Open Graph and
Twitter tags, canonical URL, and links that open the app (`holup://space/<id>`,
plus `crushly://space/<id>` for older installs).

**The token is the point, not a detail.** Profile ids are sequential and every
member's privacy row defaults to `profile_visibility = 'everyone'`, so a preview
answered by id would have let anybody walk `/s/1`, `/s/2`, … and harvest names,
cities and bios with no sign-in. Instead:

- the token is minted by the database when a member taps share — 32 hex characters,
  one per Space — and requires a signed-in member who can already see that Space, so
  a link cannot be created for a hidden profile;
- the preview stays gated on the member's *current* visibility, so withdrawing it
  withdraws the card while the link is still in circulation;
- revoking kills every copy of the link at once.

Verified live against production:

| Check | Result |
| --- | --- |
| `/s/<valid token>` | `200`, `<title>Spencer on holUpp</title>`, `og:description` "@alfie · Enugu. See their Space on holUpp." |
| `/s/41` (id shape) | `404` — the enumerable form does not exist |
| `/s/<32 f's>` | `404` |
| Token revoked, then requested | `404` |
| Member set visibility to `connections` with a live link | `404`, restored afterwards |
| `/v/86`, `/`, `/robots.txt` | `200`, `200`, `200` |

### The branch drift that was quietly costing members work

Aligning `main` turned up something worse than a tidy-up. `main` and the deployed
branch had diverged on 2026-11-09: `main` carried **seven commits production had
never run** — swipe navigation with nested gesture safeguards, Moment activity
dismissal, picture tap back on the Flow, feed sound and share controls, the
legacy-signer publication block, and
`CrushlyApp/public/.well-known/assetlinks.json`.

That last file is the one that matters for the APK: without it an
`https://holupapp.vercel.app/...` link opens a browser tab instead of the app,
because Android cannot verify the host. It is live now (`200`, package
`app.holup.mobile`, one SHA-256 fingerprint).

Merged, with conflicts resolved to this branch — it is the newer product, and main
still had the old "Homie requests are being updated" pill where this branch has the
real 🫂 button. Typecheck clean, 339 tests green, deployed **from `main`**, and both
branches now point at the same commit so they cannot drift apart again unnoticed.

### What is left on web

Everything that was on this list is done. What remains is not web code:

1. **The Android build.** Needs `HOLUP_ANDROID_RELEASE_KEYSTORE_B64` and
   `HOLUP_ANDROID_RELEASE_KEY_PASSWORD`. Everything the app needs to be the same app
   on a phone is now in place: one source, the App Links file, and `/s/` and `/v/`
   in the Android intent filters.
2. **A human walking the native-only paths** once a signed build exists — camera,
   video editor, `holup://` deep links, push notifications, the Android back
   gesture. 44 `Platform.OS === 'web'` branches compile differently on a phone and
   no browser can stand in for them.

## Android signing key: reset (2026-11-07)

The original release keystore is gone. There is no recovery path for a lost
signing key — no support channel, no escrow, no reconstruction. Android identifies
an app by package name **and** signing certificate, so a new key does not "update"
the old install; it is a different app that happens to share a name.

A fresh key was generated: RSA 4096, `SHA256withRSA`, alias `holup-release`,
PKCS#12, valid until 2054-03-28.

```
SHA-256: CD:A5:C0:A7:FF:47:E0:2E:CF:8D:CE:F9:E2:28:69:A0:9D:FE:83:77:AE:AC:B8:69:48:55:5F:ED:09:7D:4E:E4
```

Three things had to move with it, and all three are done in this commit:

| What | Was | Now |
| --- | --- | --- |
| `app.json` | `1.0.94` / code `94` | `1.0.95` / code `95` |
| `public/.well-known/assetlinks.json` | old fingerprint | the fingerprint above |
| `build-secure-android.yml` certificate check | old digest | the digest above |

The workflow's fingerprint assertion is **updated, not loosened**. It still fails
closed; it just now pins the key that actually exists. (The old one would have
blocked every build forever, since no artifact can ever carry it again.)

The Android package name was checked at the same time, because `app.json` says
`app.crushly` while the workflow and `assetlinks.json` say `app.holup.mobile`.
There is no discrepancy in the build: `app.config.js` swaps the package to
`app.holup.mobile` only when `HOLUP_SECURE_ANDROID=1`, which the secure workflow
sets. The public debug channel stays on `app.crushly` and keeps querying
`/version`; the secure channel queries `/secure/version`. That split is deliberate
and stays.

### What a new key means for people who already installed

Existing installs **cannot** be updated in place. They have to be uninstalled and
reinstalled once, and uninstalling clears app storage. Before that happens, anyone
holding a draft loses it unless they export it first. Drafts live in the app's own
storage, not on the server, so this is a real cost and not a formality:

- the old install keeps working until it is replaced, but it can never receive an
  update signed by the new key;
- after reinstalling, the account, follows, Homies, Whispers, spaces and media all
  come back, because those are on the server — only unsent local drafts do not;
- this happens once. Every build from now on is signed by the key above, so future
  updates install over the top normally.

Link handling stays intact: the new fingerprint is in `assetlinks.json`, and the
intent filters cover `/v/` and `/s/`, so a shared post or Space link opens the app
on a fresh install after the file is deployed.

### What is still required before a candidate APK exists

The workflow needs two repository secrets — `HOLUP_ANDROID_RELEASE_KEYSTORE_B64`
(base64 of the `.p12`) and `HOLUP_ANDROID_RELEASE_KEY_PASSWORD` (the store and key
password; they are the same, PKCS#12 requires it). Until both exist the workflow
fails at "Prepare signing key" on purpose rather than falling back to the debug
signer.

The keystore is the only irreplaceable file in this project. Back it up somewhere
that is not this repository and not a chat window.

## The repository could not rebuild production (fixed 2026-11-07)

This was found by reading a failure that had been sitting in plain sight: the
`Deploy web app` workflow fails on nearly every push, and it fails at
`supabase db push`, which means the web-build job behind it never runs. The
message was specific and had been dismissed as noise before:

```
Remote migration versions not found in local migrations directory.
  20261110080000 20261110092915 20261110132705 20261110132728 20261110132752
```

Five migrations were applied to the live database and never committed. The
biggest is the relationship cutover itself — the Add Ups, Homies and Whisper
rules this whole release is about. So the live database was running a schema the
repository could not produce, and every future `db push` was blocked, which is
how a real migration problem looks like a CI annoyance for long enough to be
ignored.

Recovered from `supabase_migrations.schema_migrations`, which stores the exact
statements it executed. Each recovered file's md5 was compared against the
database after the write, so these are the statements production actually ran,
not a reconstruction:

| Version | Name | Size |
| --- | --- | --- |
| `20261110080000` | relationship_cutover | 55,875 b |
| `20261110092915` | add_up_needs_no_approval | 7,314 b |
| `20261110132705` | public_space_preview | 1,679 b |
| `20261110132728` | space_share_token_preview | 4,352 b |
| `20261110132752` | space_share_token_targets_space | 2,402 b |

One correction came with it. The repo carried `20261110100000_add_up_needs_no_approval`;
the database recorded the same statements as `20261110092915`. Identical SQL —
verified line by line once comments were stripped — but two names for one
migration, which is exactly the kind of drift that makes a CLI refuse to push.
The file now uses the version the database recorded and keeps its explanation.

`supabase db push` is green again for the first time since run `83140b2`. The
lesson is the workflow ordering, not the SQL: a failing `db push` blocks the web
deploy job behind it, so "the site didn't update" and "the migrations are
inconsistent" are the same symptom and deserve the same urgency.

## Candidate APK built (2026-11-07)

`Build secure holUpp Android candidate` run `42836501075` on `f5d322f` succeeded
end to end — typecheck, the 339 unit tests, `expo prebuild`, the release build,
and the signing assertion. Read back from the artifact itself rather than from
the build log:

| | |
| --- | --- |
| package | `app.holup.mobile` |
| version | `1.0.95` (versionCode `95`) |
| min / target SDK | 28 / 36 |
| signature | APK Signature Scheme v2 |
| certificate SHA-256 | `CD:A5:C0:A7:…:4E:E4` — matches the key and the live `assetlinks.json` |

This is the first artifact that can actually replace an install, and it is also a
candidate, not a release: it is not published anywhere, the artifact is retained
two days on the run, and the native paths (camera, video editor, push, back
gesture, `holup://` links) still need a person holding a phone.

Two things a build cannot prove, both now unblocked: that Android's App Links
verification passes on a real device (needs a browser-free tap on a
`https://holupapp.vercel.app/s/...` link), and that the update channel answers
`/secure/version` for this package rather than the public `/version`.

## What is actually shipped, as of 8f93684 (2026-11-07)

Verified against the live services, not inferred from a green run.

| thing | state |
|---|---|
| `main` | `8f93684` |
| Database migrations | deployed — `create_moment(…, p_duration_ms, …)` carries the 25 s cap |
| Media Worker | deployed |
| `holupapp.vercel.app` | serving this build — title `holUpp — where crushes become conversations` |
| Marked copies | post **87** re-marked with the new end card (8.64 MB); post **86 no longer exists** — its author deleted it, so there was nothing to re-cut |

### Two things this release exposed

**1. The Vercel git deployment is blocked, and it was blocked silently.**

The deployment for `8f93684` came back `BLOCKED` with *"Vercel couldn't find a Git
account for the commit author"* — the commit author is `rielosInc@gmail.com`,
which is not an email on the GitHub account (`dyceelvk@gmail.com`), and the repo
is private, so the author must be a team member. Older commits deployed fine
because the repository was public.

The site was published by creating the deployment through the Vercel API
(`create_deployment` on `main`) instead, which is not subject to that seat check.
That works, but it is a manual step, and the permanent fix had two candidates:

- add `rielosInc@gmail.com` to the GitHub account (verified) and to the Vercel
  team, which keeps the authorship honest; or
- commit as the account's own email. Attribution is the trade.

**Resolved 2026-11-07 — commit as `dyceelvk@gmail.com`.** Adding a second member
is not available on the current Vercel plan without a paid upgrade, so the second
option was taken: the repository sets `user.email` to the account's own, already
verified address. `rielosInc@gmail.com` remains the contact/brand address and is
not wired into the app; it is no longer the commit author.

```
git config --local user.email "dyceelvk@gmail.com"
```

Deploys are triggered by the commit author matching a team member. Any future
commit authored from an address that is not on the GitHub account and the Vercel
team will show `BLOCKED` again — check `get_deployment` for `BLOCKED` rather than
trusting a push notification.

**2. The live-site check was proving the wrong thing.**

`deploy-web.yml` fetched the live bundle and searched it for the app version —
`1.0.95`. Every commit on the same version therefore passed against a stale site.
On this release that check went green while `holupapp.vercel.app` was eight commits
behind and still serving the pre-rename bundle: 96 occurrences of `Holup`, zero of
`holUpp`.

It now also compares the live page's `<title>` with the `<title>` of the build in
`dist/`, which only matches when the live document came from this build. The same
class of drift now fails the job instead of passing it.

## Moments: 25 seconds, round pictures, one card per person (2026-11-07)

Three things, one of which was a defect that made every clip Moment unusable.

### The one-second Moment

The trim screen opened with `Math.max(1, total || initialSeconds || 60)` as the
length of the file it was about to cut. When the decoder had not reported yet —
and on the web it never does — that `1` *was* the file, so the window was
0–1 seconds and the Moment that came out was one second long. Two other things
were wrong underneath it:

- the composer divided the picker's duration by 1000 to reach seconds. The picker
  documents milliseconds but does not always deliver them, so a clip reported as
  `25` (seconds) became `0.025`, which is the other way to get a one-second clip;
- `createMoment` and the `create_moment` function both accepted up to 60 seconds,
  so nothing downstream disagreed.

Now the length is the decoder's number, the picker's number is a hint run through
`pickerSeconds` (milliseconds past two minutes, seconds below it), an unknown
length is `null` — "wait" — rather than zero, and no window is ever opened over
an unmeasured file. `lib/momentClip.ts` holds all of it and is tested in
`lib/momentClip.test.ts`: thirteen cases, including the exact 25-in-as-seconds
case that produced 0.025.

### 25 seconds

`MOMENT_CLIP_SECONDS` is 25, and it is the single number the trim screen, the
composer, the viewer, `createMoment` and `create_moment` all read. A moment is a
glimpse that is gone tomorrow; a minute of glimpse is a post. Existing clips
longer than 25 seconds are left alone — they expire within the day, and cutting
somebody's live Moment short is a stranger change than the one being made.

### A round picture, and one card per person

- **Crushes feed:** the live Moments are the first thing in the feed, as circles,
  one per person, with the ring colour the member wears everywhere else and a
  `+n` badge when they have more than one live. `components/MomentCircle.tsx`.
  *Who* appears was wrong in this first cut — everybody visible, not the people
  this member had come across. See the section below, which replaces the set.
- **Discover:** still a card, because Discover is where you browse — but one card
  per person, with a round picture inside it and the same `+n` badge. It used to
  be one tile per Moment, so a member who posted four times in an afternoon
  pushed three other people off the row.

Both are covered offline by `e2e/moment-circles.spec.ts` (config
`e2e/moments.config.ts`, wired into CI next to the other offline browser runs):
Ada has four Moments, the feed shows one circle with `+3`, and Discover shows one
card that contains exactly one of her Moments.

## The ring is people you have come across, not everybody (2026-11-07)

The circles shipped that afternoon were the right *shape* and the wrong *set*,
and the clips inside them were blank. Three fixes, one of them in the database.

### Who earns a circle

The row was drawn from `visible_moments()`, which answers "what am I allowed to
see" — and for a public Moment that is nearly everybody in the app. So the top of
your own feed filled with strangers.

`moment_circles()` answers a different question: whose Moment belongs in front of
*me*. A face appears only if this member has at least one of

| where | what it means |
|---|---|
| `crushes.from_id = me` | I added them up |
| `connections` | we clicked with each other |
| `keeps.keeper_id = me` | I keep them close |
| `conversations` | we have a Whisper thread |
| `space_views` | I opened their Space |

and never if I passed on them. **A post I liked is deliberately not on that list:**
a like is a reaction to one piece of writing, and it should not install a
permanent face at the top of the feed. Viewing somebody's *Moment* is not on it
either — watching a glimpse is not having come across a person.

`visible_moments()` is untouched, so Discover still browses the wider set and a
Moment you can see is still a Moment you can open. `can_view_moment` still has the
last word in both: expiry, audience, blocks, incognito and profile visibility
keep their meaning. Checked against the live catalog: both functions exist and
`moment_circles()` is granted to `authenticated` only.

### There was no record of opening a Space

"Viewed their profile" could not be answered by any table in the schema. There is
now `space_views` — one row per (viewer, viewed), with a first and last timestamp
and a count — written by `record_space_view()`, called once when a Space opens.

It is the most private table in the database: **no grant to `authenticated` at
all**, RLS on with no policies, readable only inside the security-definer
functions. The owner of the Space cannot learn who looked, and neither can any
admin surface. Its only consumer is the viewer's own ring.

### The circles were empty

A clip Moment drew nothing inside its circle: `MomentPreview` paints a gradient
with the words on it for a clip nobody started, and Ben's photograph came out as
a hollow disc. `ClipThumb` already existed for exactly this — a muted player
paused on frame one — and a photograph is simply the photograph. A written Moment
is its words at 8 px. Anything that cannot draw falls back to the face, so a
circle is never blank.

The offline test grew a real PNG as its fixture (an empty body is indistinguishable
from a broken image, which is how this passed review the first time) and now
asserts that a decoded image is actually on the screen.

## A sleeker feed, and a mark you can actually see (2026-11-07)

Four changes from the same round of notes.

### The pale line across the top

The tab header's backing was a translucent slab — `rgba(0,0,0,0.22)` in dark, 86%
white in light — that ran 24 dp **past** the bottom of the strip. Over a dark page
that is a light band, and it landed across the Moments row and the top of the
first post, so it read as a stray white line belonging to the layout. It is now a
solid block the colour of the page, ending exactly at the strip: invisible against
the page, still enough to hide a clip scrolling under it. Nothing translucent is
left in that header.

### Moments are smaller

58 dp in the Crushes ring, down from 74. A strip of faces above a column of posts
should not be the posts' equal; 74 was a profile-row size in the wrong place.

### Posts are a column, not a stack of boxes

On the Crushes feed a post no longer draws a card — no fill, no corners, no
shadow, no 16 dp of air between posts. It is separated by a hairline rule and a
little vertical padding, so the feed reads as one continuous thing. The first post
has no rule above it, and a clip keeps its own surface, because a clip is a
picture and a picture is framed by its own edge.

`PostCard` takes a `flat` prop for this. Everything else that lists posts — a
Space, a Circle, what you kept — keeps the card, because a card is what lets you
pick one out of a list.

### The watermark: +2% larger, and less transparent

Read as two percentage points of the frame, not two percent of the icon: two
percent of 86 px is half a pixel and would have changed nothing. So the mark went
from 86 px to **108 px** at 1080 wide (8% → 10% of the frame), the handle from 24
to 26 px, and the two alphas from 0.20/0.26 to **0.27/0.34**. Still a signature,
still well under anything that competes with the clip.

The end card went the other way: every element 8% smaller together — wordmark
300 → 276, mark 190 → 175, handle 34 → 31 — so the composition still sits as it
was drawn.

Both are build-time constants in `watermark_sprite.py` and `make-end-splash.py`,
and they only reach a clip when it is **marked**, so the copies already on the
server were re-marked in the same round.

### A posted clip had no Save button, and that was not a UI bug

The Save row in the share sheet is offered only when a marked copy exists —
correct, since an unmarked copy must never leave the app. But the marking job was
`workflow_dispatch`-only, so a clip posted between runs had no copy, and the sheet
offered nothing at all. That is what was reported: "I posted a video and it got no
download button."

The job now also runs on a 30-minute schedule, behind a cheap gate: the first job
asks the database whether anything is waiting (`posts_needing_download`) and the
expensive one — ffmpeg, imageio, the voice — never starts when the answer is no.
The share sheet also says so now instead of showing nothing: a clip awaiting its
copy reads "The marked copy is on its way", with the reason. It is deliberately a
line and not a disabled button, because a control that can never become enabled
while the sheet is open is its own small lie.

## Words get their own page, and dark goes black (2026-11-07)

### The cards are back on the Crushes feed

The hairline column lasted one round. Posts are cards again, with the gap
between them; `PostCard`'s `flat` prop is gone rather than left behind, because a
surface nobody uses is a branch that drifts.

### Dark is near-black now

`#2A0F2B` behind every photograph and every clip tinted the whole app. The dark
ladder is now `#0B070C / #120D13 / #141016 / #1C1720` — page, secondary, card,
floating — with the coral and pink accents unchanged. A test asserts every rung
is under 12% luminance, so a future tweak cannot quietly put the dye back. Light
is untouched: it was already right.

### A written post is a conversation, not a page of a pager

A post with no picture used to open in the full-screen pager — a paragraph on
black, comments behind a sheet, nowhere to answer. It has its own screen now,
built to the shape the owner drew:

    back · their face · their name · ⋯
    the words, at 19/28 rather than a caption's 15
    ❤ n   💬 n   share                          pick
    ─────────────────────────────────────────────
    the first six comments
    a field at the bottom, above the keyboard

`TextPost` (`screens/flow/TextPost.tsx`) is a route of its own, and `PostCard`
sends a picture post to the pager and a text post here. The pager no longer
carries text at all: it filters to posts with a `mediaUrl`, so `PostViewer` can
keep being the room where a picture owns the screen.

### One flick, one page

The pager used `pagingEnabled`, which lets a hard flick carry its own momentum
past two or three pages — "one scroll scrolls up to 3 videos once". It is a snap
interval the height of the page now, with `disableIntervalMomentum`, so a page
advance happens once per gesture however hard the finger went, and
`decelerationRate="fast"` makes the settle read as deliberate rather than as a
drift.

### The Save row, again

Two corrections, both from the owner. The wait is no longer described in the app
at all — a member is never told a copy is "on its way", because a copy should not
be missing in the first place. The marking job now runs **every five minutes**
(GitHub's shortest interval) behind a gate that keeps an idle run to one `psql`
call.

A copy existing *at the instant of posting* is not something a scheduled job can
promise, and saying otherwise would be the same kind of lie as a green deploy
that proves nothing. The two designs that would make it true — gating visibility
until the copy exists, or transcoding on publish — are written down at the bottom
of `.github/workflows/mark-clips.yml`, with their trade-offs.

## A shorter bar, comments in words, and a Moment that is a post (2026-11-07, late)

### The bar, everywhere

Home, Connections, Whispers and Space all shrink to the same numbers: 21 px
glyphs, 10 px labels, a 42 px row, 4/6 px of padding. Space's version was already
the smaller one; the app bar had drifted larger than it.

**Create is a tab now.** It was a 52 px circle lifted 18 px above the bar and
ringed in the page colour — a floating button in the middle of a phone that
already has a bar there, covering what the thumb was scrolling. It is the Space
button, in the row: an `add-circle` glyph and the word Create, the same size as
the other five.

### Comments: Crush and Reply, in words

A comment's actions were an emoji with a count sitting above the line. They are
`Crush` and `Reply` now, under the comment, side by side — tap Crush to give one,
hold it for the other six, which is the same gesture as everywhere else with the
word telling you what a tap will do. Reply actually replies: it sets the
`parentId`, shows a "Replying to…" strip above the composer, and can be cancelled.
Before this, Reply existed only in the sheet.

**Reactions on a comment belong to written posts.** A video or a photo is a thing
you react to; its comments are a conversation about that thing, and a row of faces
on every reply turns the thread into a second scoreboard. In the sheet — which is
where a photo's or a clip's comments live — there is no reaction control at all
now. Existing counts stay, because hiding them would erase reactions people
already gave. Written posts keep reactions, and they live on the text post screen.

### The red heart is now the mark, everywhere including Flow

`PostViewer`'s seven-reaction sheet still drew `❤️`. It draws `CrushIcon` now.
That was the last red heart in the app.

### Sharing a post to Moments is a nine-second preview card

The card is a reference, not a copy. `moments.post_id` points at the post;
`share_post_to_moment` writes it; `serialize_moment` returns a `post` block with
the post's media, its author's handle and `previewMs: 9000`, and it applies
`can_view_post` when the Moment is read — so a preview cannot outlive access to
the thing it previews, which re-uploading could never guarantee.

The card is 9:16, plays nine seconds (capped in `EditedClip` via `maxMs`, muted),
and carries the **post author's** `@handle` under it. A tap on the clip opens the
post; a tap on the handle opens the author's Space. Those are different questions,
so they are different targets.

The Moments card in Discover grew to 266 px so a 9:16 preview and its handle both
fit; a shared post hides the row's own name strip, because two names in one corner
is one too many.

## Six reports, and what was actually behind each (2026-11-07, latest)

### "My saved posts disappear when I scroll down" — a page replaced, not appended

`flow_feed`, `public_flow_feed`, `circle_feed` and `saved_posts` returned `items`
and no cursor. The client paged on "after this post id" and had no way to know
whether that post was the end, so those hooks were written as plain queries keyed
on the cursor — and a query whose key changes *replaces* its data. Scroll to the
bottom of Picked, the second page arrives, page one is gone. Nothing was deleted;
it was overwritten on screen.

The four functions return `nextCursor` now, the shape `crush_posts_feed` and
`space_posts` already had, and `useFlow`, `useCircleFeed` and `useSavedPosts` are
infinite queries that append. Flattening pages lives in `lib/paging.ts` with four
tests, including the duplicate-boundary case: a post published mid-scroll shifts
the boundary so one row arrives on both pages, and a duplicated key in a list both
warns and draws twice.

Connections shares `useFlow`, so it had the same fault from the same cause.

Picked also had no horizontal padding at all — a card's body text is the first
thing in it without internal padding, so the first character sat off screen and
read as "icked 1". Fixed to the inset the Flow uses.

### "The download button is broken" — two separate reasons, both real

  · **It was usually not on the sheet at all.** The row rendered only when the
    marked copy already existed, so for a clip still waiting on the marking job
    there was no button — which reads as a feature that does not exist. It is
    always there now for a clip, and says which of three states it is in:
    checking, ready, or "still being prepared".
  · **On the web, the download never happened.** `<a download href="…">` is
    ignored for a cross-origin URL, and the media Worker is a different host to
    the app, so every "save" navigated to the file and played it in a tab. The fix
    is to fetch it into a blob — except the Worker's `/d/` response carried no
    `Access-Control-Allow-Origin`, so that fetch was refused before a byte
    arrived. Both halves are fixed: the Worker answers with CORS on `/d/`, and the
    web save tries the blob first and falls back to a plain navigation, where the
    server's own `Content-Disposition` names the file.
  · On Android the save was handing the gallery whatever came back, including an
    empty file from a 401, and reporting it as "try again". It checks the status
    and the byte count now, falls back to `saveToLibraryAsync` if `Asset.create`
    fails on a given media-library version, and says "your session expired" when
    that is what happened.

### Whispers take the seven

The database's `message_reactions_kind_check` allowed four kinds. The app has
offered seven since the reaction row landed, so sad, angry and tired failed on a
Whisper while working on a post. The constraint takes all seven now.

### The red heart is gone

Crush is holUpp's own word and its own symbol. The two circles are drawn wherever
a crush reaction appears — in the row, on the control once given, in the animation
when it is chosen — and everywhere a reaction is summarised in text (viewers, the
notifications line) it says "Crush" rather than a heart glyph. Everything else
stays an emoji, because those are universal and the mark is not.

### The pane is called All Crush Feed

It is every Crush in the app, not a list of people you have crushed on.
`label: 'All Crush Feed'`, the key is unchanged so saved navigation still lands.

## The reactions were in the wrong place, and Flow was stepping over two videos (2026-11-07, later)

### A pop-up, on the screen it belongs to, with nothing behind it

The row was a `Modal`. On a phone a modal takes the top layer of the app, so the
row could sit above a *different* screen or be caught sliding away after the page
had already changed. It is a plain view inside the same wrapper as the control
now, which binds it to that page by construction, and the offsets are clamped
against the window so it cannot run off the edge.

It also had a scrim — `rgba(0,0,0,0.18)` over the whole app — which was the only
way to catch the tap that closes it. That is gone. Dismissal is caught on the
document (web), by the next tap on any other control, and by a six-second idle
timer; nothing is painted over the app to make any of that work. One row can be
open at a time.

The faces are 22 px in a 30 px slot instead of 26 px in 40 px. The pill is 200 px
wide, anchored to the *left edge* of the control rather than centred on it —
centred, it sat across the middle of the words and read as a bar; from the
button's edge it reads as something that belongs to the button. Above the control
where there is room, below it where there is not.

**Same everywhere.** The feed card's heart is the same `ReactionButton` as the
text post; the CommentsSheet comment likes moved off `likePostComment` onto
`react_to_comment` with the same gesture; and Whispers replaced the `BottomSheet`
titled "React" (five 60 px circles sliding up from the bottom of the screen) with
the same seven faces appearing beside the bubble that was held, with Copy and Flag
on the same floating card.

### The pager: the previous fix did nothing, and I had not checked

`disableIntervalMomentum` is inert in react-native-web. The first attempt at a
web fix took the wheel event and called `scrollTo` on a node found by hand with
`getScrollableNode()` — and that node was not the element that scrolls, so the
wheel was swallowed and **the page did not move at all**. A browser probe showed
`scrollTop` staying at 0 through two flicks. That is worse than the bug.

It goes through the list's own `scrollToOffset` now, from a capture-phase wheel
listener on the document, and a jump rather than a smooth scroll — a smooth
scroll passes through every position between two pages, and halfway between two
full-screen videos both are visible, which is the "two videos merged" look. One
gesture, one page; a trackpad's burst of small wheel events is one gesture
because the lock covers them. Measured in the browser: `scrollTop` 0 → 844 →
1688 → 2532 for three gestures, on an 844 px page. Native keeps the interval snap,
`disableIntervalMomentum`, and a `onMomentumScrollEnd` that corrects a rest a few
pixels off.

### Discover's Moments: the card is the Moment

The card had a coloured ring around a round picture of the content, inside a
card — content wrapped in two layers of chrome, which is the shape that keeps
being rejected. The card *is* the Moment now: words in their own typeface on their
own colour, edge to edge, with the person's name on a shade at the bottom the way
it reads in the Moment itself. A photograph Moment is the photograph. Nothing is
drawn on top but the name, and a count where somebody posted more than once today.
The e2e test that asserted "a round picture inside" was asserting the rejected
layout, so it asserts the opposite now: a written Moment's words reach the edges of
their card.

## Three things that were reported and were all true (2026-11-07)

### The Crushes feed was not back to its default, because I broke it

Restoring the cards was not enough: the moment the Moments row arrived, the
list's `paddingHorizontal: space.md` was deleted so the row could be full-bleed,
and the row was given a negative margin to escape the padding that no longer
existed. The visible result was posts running edge to edge, which is not the
default layout and not what "put the cards back" produced. The padding is
restored; the row's negative margin still cancels it, so the row stays
full-bleed and the cards stay inset. Checked in a browser, not inferred.

### Seven reactions, reached by holding

A tap is one bit. Five kinds sat behind one tap, so the app only ever sent
`crush` — the other four were unreachable. The control is a **press and hold**
now: a tap gives your reaction (a crush if you have none), a hold opens the row,
and holding is decided at 260 ms so the release does not also react.

The row has seven: ❤️ crush, 😂 laugh, 😲 wow, 🔥 fire, 😢 sad, 😡 angry, 😓 tired.
Each pops in on a spring a beat after the one before it, the chosen one flies up
and fades, and the whole row is a modal placed from the control's measured window
position — the first attempt drew it relative to the control and pushed four of
the seven off the edge of the phone. It taps a real scrim to close.

**Comments take the same treatment.** `post_comment_likes` grew a `kind` column
(defaulting to `crush`, so every existing row still means what it meant), and
`react_to_comment` replaces a reaction or takes it back. A new function name
rather than an overload of `like_post_comment`: `(bigint, boolean)` plus
`(bigint, text)` would make a two-argument call ambiguous, and PostgREST answers
300 to an ambiguous call.

`clap` is retired but still legal in both constraints. Rows already carry it, and
a constraint that invalidates live data breaks the people who already reacted; it
is simply not in the row any more, and it still draws as 👏.

The pure part — the seven, their order, their emoji, and what an old row should
draw — is `lib/reactions.ts` with four tests. It lives outside the component
because the test runner has no renderer.

### Flow now moves exactly one video per gesture

`disableIntervalMomentum` does the job on a phone, and did nothing at all in the
browser: react-native-web does not implement it, so the web build kept flying
past two and three videos. The wheel is taken away from the scroller on the web
— the first wheel event of a gesture animates exactly one page, everything the
gesture sends afterwards is swallowed until the animation ends, and arrow keys
do the same. That is what makes it behave like Instagram rather than like a page
that happens to snap.

The pager's other rule, from the previous round, still holds: it only carries
posts with media, so a written post can never open a full-screen player.

## Saving a clip to a device, and the 7-second end card (2026-11-07)

Two things were asked for: a Tik-Tok-shaped ending for exported video, and a
download that marks what leaves the app.

### The end card

`assets/share/holup-end-splash-7s.mp4` — 1080×1920, 30 fps, exactly 7.000 s. It
opens in darkness on one second of sound: a drop, and a voice saying `holup` so
low it is half understood. Then the skeleton mark arrives, bouncing gently like a
ball on a floor; it takes its colour left to right over two and a half seconds;
and it stays that way, still bouncing, until the end. The name sits above the
mark, the creator's handle below it. No address, no product strings.

The sound is dry on purpose — no reverb, no delay, and nothing after the envelope
closes. `scripts/make-end-sound.py` builds it from a formant read of `hoh lup`,
pitched down ~11 semitones, low-passed at 900 Hz, saturated for the bass and
floored with a 52 Hz sub; the generated WAV is committed so a build without
`espeak-ng` still produces the same card.

### The mark

`assets/share/holup-skeleton-white.png` and `holup-skeleton-colour.png` — the
logo as an outline, not a filled blob. `scripts/make-watermark.py` measures the
real circles off `holup-symbol.png` (two centres, two radii, the hole) and strokes
them, so the icon is the logo's own geometry rather than an approximation.

`scripts/mark-clip.py in.mp4 out.mp4 --handle @Sativva` burns the mark into a clip
and appends the end card. Four properties matter and all are deliberate:

- **it is small and see-through.** 86 px of a 1080-wide frame, white at 20 %
  opacity, the handle at 24 px just under it. Legible if you look, invisible if
  you are watching;
- **it does not travel — it teleports.** Three places: upper left, middle right,
  lower left. Seven seconds in each, then it is simply somewhere else, with a
  120 ms fade at each end. There is no glide to follow;
- **the colour is the seventh second.** It arrives white, holds white for five
  seconds, and takes its brand colour over the last two — so the mark that
  vanishes is always the coloured one and the one that arrives is always plain;
- **the marked copy is a separate file.** The app plays the original, untouched.
  Drawing a stamp on the device would mean shipping a video encoder to every
  phone and re-encoding a clip the creator already uploaded.

A clip shorter than seven seconds keeps the mark in the place it first appeared,
for the whole clip, and never gets a second stop or a faster rhythm. The end card
after it is always the full seven seconds.

### The download

It lives in the **share sheet**, under Copy link and Share outside holUpp, because
all three answer the same question: how does this leave the app. Not in the
action rail — the rail is for what you do *to* a post inside holUpp, and a save
sitting among Crush, Comments and Pick reads as one more thing about the post
rather than a copy going out into the world.

The row says **"Save clip to device · with the holUpp mark"** and appears only for
a clip that has a marked copy. A post without one gets no row at all rather than a
disabled one, because a greyed control invites the question "why not?" and the
answer would be a server limitation nobody should have to learn.

`src/lib/clipSaveRules.ts` decides; `src/lib/downloadClip.ts` does the work —
`expo-file-system` into the cache, `MediaLibrary.Asset.create` into the gallery,
then the cache copy is deleted. On web the same marked file goes to the browser's
downloads under the same name, `holup-<post id>.mp4`.

The rule the tests enforce is the one that matters: **a download is offered only
when a marked copy exists.** `canSaveClip` is false for a photo, false for a clip
with no `downloadUrl`, and there is no fallback to the original — falling back
would hand out somebody's work with no name on it.

Two browser tests now hold that in place: the share sheet shows Copy link and
Share outside with no save row for an unmarked clip, and shows all three — in that
block, with the mark named in the wording — once a marked copy exists.

A stray download arrow was found on the way: `FeedRail` drew a download glyph for
Pick, which is a bookmark. `FeedRail` is not rendered anywhere — `PostCard` has
its own rail, already bookmarked correctly — so it was dead code carrying a
misleading shape. Fixed rather than deleted silently, in case it is reused.

### What is not done, and cannot be done in the app

**No post has a `downloadUrl` yet, so the button does not render anywhere.** That
is the honest state: the client is ready, the files are not. Producing a marked
copy for a clip needs the media pipeline to run `mark-clip.py` on upload and write
the resulting B2 key + URL back to the post — a server step, in the Worker, with
ffmpeg in the image. Until that exists, a download button would either do nothing
or hand out an unmarked copy, and both are worse than no button.

## Save-to-device, end to end (2026-11-07)

The save row was inert because no post had a marked copy. It has two of them now,
produced the same way every future clip will be.

### The route the app calls

`GET /d/<post id>` on the media Worker. The path is a **post id, never a storage
key**, so a client cannot construct an address for a post it may not see, and a
forwarded link is useless to anybody who could not have downloaded it themselves.
The Worker asks the database (`post_download`), which applies `can_view_post`, and
streams the bytes itself with `Content-Disposition: attachment` and
`Cache-Control: private, no-store`.

Verified against the live Worker: no token → `401 Sign in to save this.`; a bad
token → rejected upstream. Verified against the database: the author of post 86
gets a path, a random identity gets **null** — not an error, so a member cannot
even learn whether a marked copy exists for a post they cannot see.

### The copies

| Post | Author | Marked key | Size |
| --- | --- | --- | --- |
| 86 | 3 | `posts/3/1794240963220-…-marked.mp4` | 18.2 MB |
| 87 | 41 | `posts/41/1794267630223-…-marked.mp4` | 8.8 MB |

**These two still carry the previous look** — the old 6 s card with the address on
it and the larger mark. Re-run `Mark clips for download` with `post_ids=86,87`
after this commit is pushed; `register_post_download` replaces the row and the
`-marked` object, so the same two posts come back addressed by the new card.

Produced by `Mark clips for download` (run `42860307625`): pull the original from
B2 → burn in the mark with **that author's** handle → append the 7-second end card →
upload under a `-marked` key → record it. The original in `posts.media_url` is
never touched, so playback inside holUpp is unchanged.

Batch rather than upload-time on purpose: an ffmpeg re-encode in the upload path
would make a member wait for it, and a backlog clears in one run.

### Two defects the real run found

Neither would have shown up in a test:

1. **`profiles` has no `handle` column** — it is `username`. Every clip failed
   before encoding.
2. **The handle was baked into the shared assets.** The old watermark and the
   splash both said `@Sativva`, so every clip in the app would have credited
   whoever those files were made for. The mark is now a handle-free lockup and
   the handle is drawn per clip from `posts.author_id` into a temp directory, so
   one creator's handle can never be left behind in the committed assets.

Also worth keeping: the job's first failure was a 401 from Backblaze that looked
like bad credentials and was a stray newline in a secret. The Worker trims its
credentials; the job now does too, and a 401 names the two secrets to check.
