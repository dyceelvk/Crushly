# TikTok → Crushly: reverse-engineering evidence report

**Date:** 2026-10-30
**Tool:** `rea-agents` v6.8.0 (CLI), provider `rea-cdp-browser` v2
**Target:** `https://www.tiktok.com/` — mobile web profile, 390×844, DPR 3, Android UA
**Evidence ID:** `ev_99b630a3c6dcc810e730a75b1bdaf8665113293e84135fbc5cd3d5a1bc5fa29d`
**Raw artifact:** `evidence/tiktok-feed-raw.json` (210 KB · 576 accessibility nodes · 959 DOM nodes)
**Confidence:** `observed` · **Authority:** `external-service`

---

## 1. Method

TikTok's native apps could not be analysed. That path requires APK/IPA binaries plus
Ghidra or JADX, and this machine has 2 GB RAM — the decompiler would not survive. I also
would not circumvent app protections to obtain those binaries.

What *is* reproducible and legitimate is the public web surface. It renders the same
product decisions a viewer experiences in the app:

1. `chromium --headless=new --remote-debugging-port=9222` — owned browser.
2. CDP `Emulation.setDeviceMetricsOverride` + mobile UA → 390×844 viewport.
3. Navigate, dismiss the two blocking interstitials (`Got it`, `Not now`, `Close`).
4. `rea inspect-web-page --include-accessibility-text --include-json-body-shapes --observation-ms 4000`
5. Direct DOM probes for `data-e2e` hooks, player geometry, and element counts.

TikTok ships stable `data-e2e` test attributes, which makes its component inventory
enumerable without reading obfuscated bundles.

---

## 2. Findings

| # | Observation | Evidence | Confidence |
|---|---|---|---|
| 1 | The whole feed holds **exactly one `<video>` element** | `document.querySelectorAll('video').length === 1` across two separate samples | observed |
| 2 | **Two** slide containers exist at once (`video-slide-active`, `video-slide-1`) | `[data-e2e^="video-slide"]` count = 2 | observed |
| 3 | The active clip is **muted on arrival** | `video.muted === true` | observed |
| 4 | The feed clip **does not loop** | `video.loop === false`, `duration ≈ 10s` | observed |
| 5 | Video is **full-bleed, `object-fit: contain`, no border radius** | `getBoundingClientRect()` = viewport box; `fillRatio 1.0` | observed |
| 6 | The action rail is **like · comment · share, in that order** — plus a music disc | `video-card` innerText = `736.4K / 2037 / Share / <username> / <caption>` | observed |
| 7 | **No save/bookmark and no view-count** appear in the mobile rail | absent from `video-card` innerText and from all `data-e2e` names | observed |
| 8 | Counts are **humanised above 10⁴** but **raw below** | `736.4K` vs `2037` | observed |
| 9 | Controls **are not semantically buttons** | 351 of 576 AX nodes are `none`/`generic`; only 12 real `button` roles | observed |
| 10 | Each clip carries an **attributed sound** | `music-cover`, `music-name`, `video-music-icon` hooks; `original sound- SideQuest Squid` | observed |
| 11 | Bottom tab bar is **5 fixed destinations** | `home-icon`, `discover-icon`, `open-titok-icon`, `dm-icon`, `profile-icon` | observed |

**Limitation, stated plainly:** findings 1–11 describe TikTok's *web* build. The native
app may differ in detail (notably around save/collections). Conclusions about counts and
rail order are for the mobile-web surface. No claim is made about server behaviour,
ranking, or the recommendation engine — none of that is observable from here.

---

## 3. What this says about Crushly

The audit of your own source (`CrushlyApp/src`) against the above:

| # | TikTok | Crushly today | Verdict |
|---|---|---|---|
| 1 | 1 player, 1 window | `EditedClip` mounts one `useVideoPlayer` **per card**, each with `autoPlay` | **Diverges — fixed this pass** |
| 2 | ~2 slides windowed | Flat `FlatList` of posts, all mounted | Diverges — see §5 |
| 3 | Muted on arrival | `autoPlay loop` with `look.clipVolume` | Diverges — needs a deliberate call |
| 4 | No loop | `loop = true` default | Diverges |
| 5 | Full-bleed contain | Feed tile `maxHeight: 400`; `PostViewer` full-screen | Partially aligned |
| 6 | like · comment · share | like · comment · whisper · share | **Aligned** — keep whisper |
| 7 | no save | `post_saves` table exists, unused | **Opportunity**, but see §4 |
| 8 | humanise above 10⁴ | `post.likeCount` raw | Diverges |
| 9 | not semantic | RN gives real a11y roles | **Crushly is ahead — keep** |
| 10 | sound attributed | `sound` block in prototype | Aligned |
| 11 | 5 tabs | 5 tabs | Aligned |

---

## 4. Where I deliberately did **not** follow TikTok

Evidence is not a mandate. Three of these would make Crushly worse:

- **Rail order.** TikTok's rail is like/comment/share because it is an anonymous
  broadcast feed. Crushly is a connections product — `Whisper` is the action that
  converts. Removing it to match TikTok's furniture would be copying the shape of
  someone else's product into a different one.
- **No save.** TikTok's mobile web hides save; its native apps have Collections.
  You already have `post_saves` and the word "Keep" in your product language. I am
  recommending *toward* save, not away from it.
- **Muted autoplay.** TikTok mutes because it autoplays strangers. Crushly autoplays
  people you chose. Unmuted autoplay is defensible here — but it must be exactly one
  clip, which is what this pass fixed.

I also copied **no** TikTok code, assets, strings or layout values. The transfer is
structural: an invariant about player count.

---

## 5. Applied to the codebase this pass

**New — `CrushlyApp/src/lib/playerFocus.ts`**

A module-level registry enforcing one-playing-clip. `takeFocus(player)` silences every
other registered player; `registerPlayer` returns its own unregister for cleanup;
`releaseFocus` hands the sound back to nobody.

**Changed — `CrushlyApp/src/components/EditedClip.tsx`**

Claims focus when it starts, releases when `autoPlay` goes false, and unregisters on
unmount so a dead player is never paused forever.

**Tests — `CrushlyApp/src/lib/playerFocus.test.ts`**

7 cases, all passing: `node --import tsx --test src/lib/playerFocus.test.ts`. Added to
the `test` script in `package.json`. Writing these caught a real design question — the
registry silences *every* other player on each ownership change rather than tracking who
is playing, because pausing an idle clip is a no-op. The tests now assert that invariant
rather than an exact call count.

**Not yet done:** full-repo `npm run typecheck` — `node_modules` is not installed in this
clone, so `tsc` cannot resolve `react-native`/`expo-video`. The touched files need a
typecheck on a machine with dependencies installed.

---

## 6. Reproducing this

```bash
# 1. browser
chromium --headless=new --no-sandbox --disable-dev-shm-usage \
  --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-rea about:blank

# 2. mobile target + dismiss interstitials
node nav.mjs "https://www.tiktok.com/" '{"mobile":true,"wait":11000}'
node click.mjs <targetId>

# 3. evidence
npx -y rea-agents@latest inspect-web-page http://127.0.0.1:9222 <targetId> \
  --allowed-origins https://www.tiktok.com \
  --include-accessibility-text --include-json-body-shapes \
  --observation-ms 4000 --format json > evidence/tiktok-feed-raw.json

# 4. structural probes
node probe.mjs <targetId>
```

Helpers live at `/home/user/nav.mjs`, `click.mjs`, `probe.mjs`, `probe2.mjs`, `probe3.mjs`.

Note: `analyze-web-bundle` returns `scripts_analyzed: 0` on a pre-loaded page. It only
retains script sources inside its own observation window and observes passively, so
navigation must happen *during* that window. `capture-browser-scenario` drives Playwright
itself and is the correct tool if full bundle analysis is wanted later.
