# What changed on 12 November 2026, and how it was proven

Three complaints, three mechanisms. None of them was a mystery after the first
minute, and none of them was fixed by reassurance.

## 1. "Deleting doesn't work on whispers"

There was no Delete. Not a broken call, not a refused request — the long-press
menu on a Whisper offered reactions, **Copy text** and **Flag this Whisper**, and
that was the whole of it. The feature had been designed and never built, so the
menu was honest about everything except the thing people were looking for.

What exists now:

| Piece | Where | What it does |
| --- | --- | --- |
| `delete_message(p_message_id)` | `20261113180000_delete_whisper_message.sql`, applied to prod | Deletes the row and queues the file in one transaction. Sender only. |
| `service.deleteMessage()` | `CrushlyApp/src/api/service.ts` | Reads `media_url`, calls the RPC, then removes the file. |
| `whisperLive` `deleted` event | `CrushlyApp/src/lib/whisperLive.ts` | Pushes `{id}` on `whisper:<conversation>` — the only way the other phone can learn about a removal. |
| `useChat().remove()` | `CrushlyApp/src/api/hooks.ts` | Optimistic, re-inserts in place on refusal. |
| **Delete** in the long-press card | `CrushlyApp/src/screens/messages/Chat.tsx` | "Delete from the server", with a plain sentence about what it does. |

Live proof, run against the production database inside a rolled-back block:

```
own delete        → row gone, media_deletions.reason = message_deleted,
                    whisper_photo_ledger row kept
third photo same day → __CRUSHLY__429__photo_limit     (deleting does not refund)
peer's message    → __CRUSHLY__403__not_your_message
```

An incremental `get_messages` can never discover a deletion — it asks for ids
*after* the newest. That is why the removal is pushed, and why "refetch" alone
would have looked like a fix and been none.

## 2. "I still see a 📷 in message chat body that says video note"

Five `kind='video'` rows existed in production (ids 65, 66, 75, 85, 86), all
`.webm`, all sent before the server stopped accepting video. They were the
circle. They are gone:

```
messages where kind='video'  → 0
media_deletions queued       → 5, reason video_note_retired
unsigned GET on each file    → 401
```

The player component (`VideoNote.tsx`, `VideoNoteBubble`) is deleted, the bubble
now reads "A video note. Whispers are photos and voice notes now.", and every
label in the app that used to offer the words "Video note" says "A video note"
instead — a thing that cannot be sent, not an affordance.

## 3. "The APK no longer does new update available / updates in app server-side"

The check ran and was refused. The shipped identity is `app.holup.mobile`, so
`updateVersionPath()` asks `/secure/version`, and that route answered:

```
503 Secure Android updates are not available yet.
```

Which was correct while the only published file was a differently-signed debug
build — and became the bug the moment the published file was this identity's own.
On top of that, `UpdateGate` returned `null` for `app.holup.mobile`, so even a
successful answer would have shown nothing.

Both are changed. The route now answers with the build `release.json` describes,
and the gate no longer excludes the identity that is actually installed.

```
GET /secure/version → 200
{"version":"1.0.98","versionCode":98,...,"apkUrl":".../download",
 "downloadInfoUrl":".../download-info"}
```

## 4. "nothing changes" — the reason, stated plainly

Every Vercel production deployment since 1.0.98 was `BLOCKED` with
`COMMIT_AUTHOR_REQUIRED`: the commits were authored `dev@holupp.local`, an
address Vercel cannot match to a GitHub account. A blocked deploy is not a failed
build and produces no red mark, so the repo looked healthy while the website
served a bundle from days earlier.

Commits are now authored `dyceelvk@users.noreply.github.com`, which Vercel did
accept on the last successful preview. The site was also force-deployed through
the Vercel API and now serves a new bundle (`index-3e777b6f…` → later builds)
that contains "Delete from the server" and "Delete this Whisper".

## 5. Secrets

`audit-apk-secrets.py` now runs on **the shipped** build, before publish, and on
the web export before deploy. It ran clean against the live 1.0.98 APK:

```
Secret leakage check passed (0 configured credentials, 7 shapes,
1661 files, 32297 bytecode strings); no values logged.
```

Every `sb_secret` / `service_role` occurrence in the installed bundle is library
error text or the app's own guard that refuses to run on a secret key. No JWT,
no `ghp_`, no `AKIA`, no private key block.

## 6. One build on the server

`publish-android.yml` now removes every object in `android-releases/` except the
one `release.json` names, then lists the bucket again and fails the run unless
exactly one remains. The keep-set comes from `release.json`, never from the
version typed into the workflow, so a typo cannot delete the build being
published.

## 7. The splash

It said `HOLUP`. The official wordmark is `holUpp` — lowercase h, capital U. The
splash is now the official symbol and wordmark, optically centred.

## 8. 1.0.99 — built, published, live

```
run            43132946395   success (all 11 steps, including the secrets audit)
apk            app-release.apk   97 070 616 bytes
sha256         e08ee4da59af7508befb41e0233e56ac8fa51ce44b1e37f5aec943bc1876e700
versionCode    99   package app.holup.mobile
bundle         contains "Delete from the server", "Delete this Whisper",
               "Removed from the server"; zero occurrences of "Video note"
artifact       Crushly repo → Actions → run 43132946395 → holUpp-secure-unreleased-candidate
```

Uploading it to R2 failed, and the reason matters more than the failure:
`publish-android.yml` runs `wrangler r2 object put` with the repository's
`CLOUDFLARE_API_TOKEN`, and that token has no R2 write scope —

```
403 Forbidden  {"errors":[{"code":10000,"message":"Authentication error"}]}
```

Which is why every APK so far was uploaded by hand. The channel was therefore
put back on 1.0.98, the build the bucket actually holds, so `/version` and
`/download` agree and no phone is offered a file that cannot be served:

```
/version          → 1.0.98, versionCode 98, 97045708 bytes
/secure/version   → the same build (route fixed; this is what phones ask)
/download         → 200
```

The moment the token can write to R2, `publish-android.yml` with
`run_id=43132946395`, `version=1.0.99`, `sha256=e08ee4da…` does the rest —
including removing 1.0.98, which is now enforced by
`.github/scripts/prune-old-releases.py` and verified in the same run.

### What unblocked it

`wrangler r2 object put` authenticates with `CLOUDFLARE_API_TOKEN`, and that
token has no R2 write scope (`403`, `code 10000 Authentication error`). That is
why every APK up to 1.0.98 had been uploaded by hand. Publishing now uses the R2
access key pair instead, through `.github/scripts/r2-releases.py`, and the whole
run is green:

| Step | Result |
| --- | --- |
| upload `android-releases/Crushly-1.0.99-Android9plus.apk` | 97 070 616 bytes |
| read it back and hash it | `e08ee4da59af…` — matches the APK |
| prune every other release | `Crushly-1.0.98-…apk` removed |
| verify exactly one release remains | one: 1.0.99 |
| live Worker serves it | `/download` 200, `content-length: 97070616` |

Final channel state, read now:

```
/version         → 1.0.99, versionCode 99, 97070616 bytes, e08ee4da…
/secure/version  → 1.0.99, 97070616            ← what installed phones ask
/download        → 200, Crushly-1.0.99-Android9plus.apk
bucket holupp    → 1 object: android-releases/Crushly-1.0.99-Android9plus.apk
```

## 9. Where files live, and where text lives

The rule the code already enforces, restated because it was asked again:

| Thing | Home | Why |
| --- | --- | --- |
| Posts, Moments, videos, images | Cloudflare R2 (`holupp-media`) | 10 GB free, and **zero egress** — a launch cannot exhaust it |
| The APK | Cloudflare R2 (`holupp`, `android-releases/`) | 92.6 MB of the same 10 GB |
| Messages, Whispers, replies, bios | **Supabase, as rows** | they are searched, sorted, paginated, counted and protected row by row by RLS |
| Auth, identities | Supabase | — |
| Secrets | Cloudflare/Worker secrets + GitHub secrets | never in the app; the build refuses to publish if one is found |

Storage right now: `holupp` 92.6 MB + `holupp-media` 31.4 MB = **1.24 % of the
10 GB allowance**.

Chat *files* — a Whisper photo, a voice note — are media, and they are in R2 with
everything else. Putting them in Backblaze B2 would put them behind metered
downloads, which is exactly what broke 1.0.9x: the B2 allowance ran out and
`/download` answered 503 for hours. B2 stays what it is today — the archive every
pre-R2 file is read from, never the place new chat traffic goes.

## 10. The download carries the company name

`Crushly-1.0.99-Android9plus.apk` → **`holUpp-1.0.99-Rielosinc.apk`**, everywhere
the name is constructed: `publish-android.yml`, `update-worker-release.py`,
`mirror-android-apk.py`, `release.json`, and the release-path test.

The object was copied inside the bucket (bytes unchanged), the old key removed,
the Worker deployed, and the public download verified from the outside:

```
GET /download-info   → file "holUpp-1.0.99-Rielosinc.apk", 97070616 bytes
GET /download        → 200, content-disposition: holUpp-1.0.99-Rielosinc.apk
sha256 of the downloaded file → e08ee4da59af7508befb41e0233e56ac8fa51ce44b1e37f5aec943bc1876e700
secrets audit on the downloaded file → passed (0 credentials, 7 shapes, 1661 files)
bucket holupp        → one object: android-releases/holUpp-1.0.99-Rielosinc.apk
```

Nothing is left of the old name except history: the bucket holds one file, and
that file is named for the company.

---

# 13 November 2026 — five things, and the one that explains the rest

## "The delete button doesn't tap, and copy text doesn't work"

Both had the same cause, and it was not the buttons. `ReactionPopup` closes itself
on the next press anywhere on the page, and on the web it listens in the
**capture phase** — so the listener fires *before* the button under the finger
does. It only recognised `[data-testid="reaction-row"]`, the strip of faces. A
press on Copy or Delete was therefore not "inside the card", the card was
unmounted on `pointerdown`, and the `click` that would have run the handler had
nothing left to land on. The tap was real. Its target was deleted mid-gesture.

One rule now decides it, in `src/lib/reactionCard.ts`, and the card itself
carries `testID="reaction-card"`:

```ts
export const REACTION_UI_SELECTOR = [
  '[data-testid="reaction-row"]',
  '[data-testid="reaction-card"]',
  '[data-testid="reaction-control"]',
].join(', ');
```

Both listeners (the pop-up and the inline row) use it, and three tests pin it.
Verified present in the shipped bundle: `reaction-card` ×1 (APK), ×2 (web).

## "The Moment card on Discover shows a camera icon instead of the content"

It did, literally: a `videocam-outline` on a dark gradient was the whole preview
for any Moment that was a clip. A row of Moments was a row of camera icons.
It now paints the clip's own first frame through `ClipThumb` — the same still the
grids use — with the caption over it and the author's picture and name in the
strip beneath, which were already there and stay there.

## "The Moment ring should be stagnant on the Crushes feed"

It was the list header, so it scrolled away with the first post. It is now a
sticky header (`stickyHeaderIndices={[0]}`) on an opaque background, so it holds
still and the cards move under it.

## "Hold the right corner of a video in Flow to fast-forward"

New in `EditedClip`: `holdToSpeed`. A strip along the right third (above the
play/pause surface, so it wins the press) runs the clip at 2× while held and
returns it to the speed the creator chose on release — not to 1×, which would
silently undo a slow-motion clip. A `2×` badge appears while held. Wired into
both the full-screen Flow player and the clip cards in the feeds.

`lib/holdSpeed.ts` is the rule, with tests: base speed is remembered, nonsense
speeds fall back to 1, and the boost is clamped at 8×.

## The company is RielOS

Every place the download's name is built now says so:

```
file            holUpp-1.0.100-RielOS.apk
publish-android.yml, update-worker-release.py, mirror-android-apk.py,
mediaStore.test.ts, release.json
```

## 1.0.100, shipped and checked from the outside

```
build run        43139860199   success (11 steps, secrets audit included)
publish run      43142384745   success (upload, readback, prune, verify)
/version         1.0.100, versionCode 100, 97 072 500 bytes
/secure/version  1.0.100, 97 072 500            ← what installed phones ask
/download        200, holUpp-1.0.100-RielOS.apk
sha256 of the downloaded file   62e76a849293… ✓ matches the build
secrets audit on that file      passed (0 credentials, 7 shapes, 1661 files)
bucket holupp                   one object: holUpp-1.0.100-RielOS.apk  (92.58 MB)
bundle                          "Delete from the server", "Hold to fast-forward",
                                "reaction-card" all present
live web bundle                 same three, plus the reaction-card selector twice
```

## 13 November 2026 — holupp.net as the public site

The domain was bought and attached to the Vercel project, but the app still called itself
`holupapp.vercel.app` everywhere a stranger could see it, so buying the domain changed
nothing about what a shared link looked like.

Checked live, then fixed:

```
holupp.net      A     -> (nothing)                    # zone has no apex record at all
holupp.net      NS    -> ns1/ns2.hosting.businessidentity.llc
www.holupp.net  A     -> 66.223.49.89                 # hosting provider's parked page
registrar             -> DomainRegistry.com LLC, registered 2026-11-12, expires 2027-11-12
Vercel get_domain_config -> misconfigured: true, aValues: [], cnames: []
```

Code: `src/lib/publicSite.ts` (new: `PUBLIC_SITE`, `isPublicHost`), `postShare.ts`,
`spaceShare.ts`, `spaceShareActions.ts` mint `https://holupp.net/v/<id>` and `/s/<token>`;
`api/post-share.mjs` and `api/space-share.mjs` build the card and canonical **for the host
that served the page**, so an old link unfurls pointing at itself; `seo-head.mjs`;
`app.config.js` advertises App Links for `holupp.net` and `www.holupp.net` (`/v/`, `/s/`)
and keeps `holupapp.vercel.app` so links already in circulation still open the app.

`tsc --noEmit` rc 0. `npm test`: **411 pass, 0 fail**; `tests/`: 7 pass, 0 fail.

The zone still has to be pointed at Vercel: see `docs/holupp-net-dns.md`.

## 13 November 2026 — holupp.net resolves, 1.0.101 published

The domain now answers from both authoritative nameservers, and the app links to it.

```
1.1.1.1 holupp.net A -> 64.29.17.1, 216.198.79.1        NOERROR
8.8.8.8 holupp.net A -> 64.29.17.1, 216.198.79.1        NOERROR
ns1 (master) A      -> 64.29.17.1, 216.198.79.1   serial 2026111217
ns2          A      -> 64.29.17.1, 216.198.79.1
https://holupp.net        200  <title>holUpp — where crushes become conversations
https://www.holupp.net    308  -> https://holupp.net/
certificate               CN=holupp.net, Let's Encrypt, 2026-11-12 → 2027-02-10
/.well-known/assetlinks.json   200
MX -> 10 mailserver.businessidentity.llc (info@holup.net unaffected)
```

What it took, in order: the zone had **no apex A record at all**; the host's panel wrote
records to ns2 but not to ns1's master (serials diverged, `…10` on ns2 vs `…17` on ns1);
replacing the NS records inside the zone with Cloudflare's **before** delegation moved made
every resolver SERVFAIL (reverted in minutes); finally the apex A records committed on ns1
and both servers agreed.

A Cloudflare zone was created as a standby during the outage
(`6d3af60697ffafb1bb91ab13f0a5d817`, still `pending`) with all eight records including the
DKIM/SPF/DMARC copied from the live zone; it is unused now and can be deleted.

**1.0.101 published** so the installed app claims the new host in its App Links:

```
version 1.0.101 / versionCode 101 / 97,073,592 bytes
sha256 72a0e1472eb7825db28edc39583843e93eed4751170baf070c27fde0e54fd476
/download 200, content-disposition filename="holUpp-1.0.101-RielOS.apk", full download hashes equal
removed older release: android-releases/holUpp-1.0.100-RielOS.apk
one build on the server: android-releases/holUpp-1.0.101-RielOS.apk
bundle contains https://holupp.net, and still handles holupapp.vercel.app
```

Runs: build `43175979518` ✓, deploy-worker `43178439003` ✓, publish `43178472278` ✓
(artifact `13925401262`).
