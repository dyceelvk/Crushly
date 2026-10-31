# devtools — how this app gets looked at

This folder is **not part of the build**. Vercel builds `CrushlyApp/` only; nothing
here is bundled, type-checked or shipped. It is here because the harness and the
probe scripts were rewritten from scratch three times after living only in `/tmp`,
and because a workspace can be rolled back — anything not in git is not saved.

## What is in it

| Path | What it is |
|---|---|
| `harness/` | A second Expo entry point that mounts **one screen at a time**, outside the real navigator, with a seeded TanStack Query cache. That is the only way to render signed-in screens without a live Supabase project behind them. The screen is chosen with `?s=<name>`: `flow`, `profile`, `edit`, `user`, `messages`, `chat`, `settings`, `viewer`, `viewerportrait`, `intentions`, `basics`, `photos`, `about`, `preferences`. |
| `harness-build.sh` | Copies `CrushlyApp/src` + `harness/` to a scratch dir, exports for web, copies the test media, and leaves the result ready to serve on `:8097`. |
| `scripts/cdp.mjs` | A tiny Chrome DevTools Protocol driver: open a screen at a phone viewport, tap an element **by coordinates** (React Native Web swallows synthetic clicks on innerText), scroll the RN `ScrollView`, screenshot, collect console errors. |
| `scripts/editshot.mjs` | Captures a tall screen as a sequence of viewport panels — the only honest way to look at a 3,500 px form on a 844 px phone. |
| `scripts/probe-edit.mjs`, `scripts/probe-cap.mjs` | Two examples of a probe: read what the DOM actually holds (input values, chip labels, counts), then act and read it again. |
| `scripts/viddemo.mjs` | Video probes: frame geometry, and tap-to-pause confirmed through the `<video>` element's own `paused` flag and `currentTime`. |
| `scripts/ws-shim.mjs` | Node 20 has no global `WebSocket`; this lends it the one from the app's `node_modules`. |

## Running it

```bash
# 1. serve the harness
bash devtools/harness-build.sh
(cd /tmp/webbuild-h && python3 -m http.server 8097 --bind 0.0.0.0 &)

# 2. a headless browser to drive
chrome --headless=new --no-sandbox --disable-gpu \
       --remote-debugging-port=9222 --user-data-dir=/tmp/cdp about:blank &

# 3. look at a screen
node --import ./devtools/scripts/ws-shim.mjs devtools/scripts/editshot.mjs edit edit 5 760
```

## Why any of this exists

Every real defect this project has found came from **rendering the screen**, not
from reading it. The photos in the feed were invisible (`<img>` with a width and no
height computes to 0); video was cropped because `position: absolute; inset: 0`
does not size a replaced element; `she/her` was missing from the pronoun chips and
a member's own answer was shown as though it were a typo. None of those are
visible in a type check, and all of them are obvious in a screenshot.

## Two things to know

* **Mock what the server actually returns.** The harness once seeded
  `completion: { missing: ['photos'] }`, a label `completion()` cannot produce, so
  the screen was being judged against a fiction. When a mock disagrees with
  `api/service.ts`, the mock is wrong.
* **Chromium here has no H.264.** Use `.webm` (VP9) for the harness clips, or the
  `<video>` reports `MEDIA_ERR_SRC_NOT_SUPPORTED`.
