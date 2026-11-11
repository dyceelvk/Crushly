# Big clips, and a Flow that pages like Instagram — 2026-11-07

Commit **`acb0cca`** (on top of `8621c7a`). Nothing here is live until it is pushed and Vercel rebuilds: the PAT that was embedded in `origin` did not survive into this session, so the commit exists locally only.

---

## 1. "Someone can post videos up to 300 MB, then holUpp compresses it"

The old answer was a refusal: `uploadMediaFile` measured the file, and anything over 80 MB got *"trim it, or pick something shorter."* A phone camera writes about 90 MB a minute, so an ordinary clip was over the line before anybody did anything unusual — the app was refusing ordinary videos and calling it a rule.

Now a clip is **accepted up to 300 MB and re-encoded on the device** before a byte is uploaded.

| | before | now |
|---|---|---|
| Largest clip accepted | 80 MB | **300 MB** |
| What leaves the phone | the original | re-encoded, target **64 MB** |
| Re-encode starts above | — | 72 MB |
| Hard ceiling after compressing | 80 MB | 120 MB (client and Worker agree) |

`CrushlyApp/src/lib/compressVideo.ts` is new and is the whole engine:

- **Web — a real transcode.** The clip is played off-screen, each frame is drawn to a canvas at a chosen size, `canvas.captureStream()` carries the frames, and `MediaRecorder` writes a new file at a bitrate computed from the clip's length and the target. Audio is routed through an `AudioContext` into the recorder, because a muted `<video>`'s own `captureStream()` is silent. Output is labelled by `recorder.mimeType`, not by what was asked for.
- **Phone — `react-native-compressor`** (now a real dependency, `1.16.0`), `compressionMethod: 'auto'` with `maxSize` **in megabytes**, driven from the `file://` URI the picker already returned, so a 300 MB clip is never copied through JS memory. The Blob→file path exists only as a fallback and refuses anything over 96 MB.
- **A transcode that grows the file is discarded** (`null`), and the caller keeps the original — a compressor that makes files bigger is not a compressor.

Bitrate and size: `kbps = clamp(((target × 0.92 × 8) / 1000 / seconds) − 96, 350, 4000)`, resolution capped at 1080 / 854 / 640 / 480 by tier, 30 fps, audio 96 kbit/s.

The composer now says what it is doing — *"Compressing your clip… 42%"* — instead of a nameless spinner, because a 60-second clip takes most of a minute to re-encode. Progress is reported once per whole percent, not once per drawn frame: a callback per frame is a React re-render per frame, at the exact moment the device is already encoding.

### Measured in a real browser (headless Chromium, `MediaRecorder`, ffprobe on the output)

| source | target | out | resolution | wall time | calls |
|---|---|---|---|---|---|
| 11.6 MB / 15 s, 960×540 synthetic | 8 MB | **2.75 MB** | 960×540 | 15.2 s | — |
| same | 4 MB | **1.47 MB** | 854×480 | 15.1 s | — |
| 12.6 MB / 8 s, heavy noise (hard to encode) | 3 MB | **1.87 MB** (59% of target) | 960×540 | 8.2 s | 104 |
| same | 8 MB | **2.43 MB** (29%) | 960×540 | 8.2 s | 104 |

Two things this settles:

- **The earlier "0.7 MB for a 2 MB target" anomaly is explained.** `videoBitsPerSecond` is a ceiling, and VP9 undershoots it on content that compresses easily. Even heavy noise came out at 59% of a small target. The target is never exceeded, which is the only guarantee that matters — an output well under it is a better file, not a bug.
- **Audio survives** (`vp9` + `opus`, confirmed by ffprobe), which the first version got wrong.

Encoding is realtime-ish (8 s clip ≈ 8 s), which is why the progress line matters.

---

## 2. "The video scroll still doesn't work like Instagram's"

Instagram's reels feel the way they do because **a gesture is answered with exactly one clip**, and a scroll can never come to rest on a half-cut frame. The Flow had three different attempts at that and each input got a different answer.

Now, one gesture, one clip, in all three places input arrives:

- **Finger on a phone** — `snapToInterval` at exactly the page height plus `disableIntervalMomentum`, which stops the list at the next interval whatever the finger did; `decelerationRate="fast"` for a quick settle. Explicitly **not** `pagingEnabled`: on iOS it lets a hard flick carry its own momentum across two or three pages, which is the *"one scroll scrolls up to three videos"* the owner reported.
- **Finger and wheel in a browser** — react-native-web implements neither `disableIntervalMomentum` nor snap, so the **browser's** own snap does it: `scroll-snap-type: y mandatory` + `scroll-snap-stop: always` on every page, which is the same guarantee given by the engine that actually owns the scroll. On top of that a mouse wheel is treated as a **gesture, not a distance**: one page per gesture, and the next is refused until the wheel events stop (180 ms) — a notched wheel sends a stream of small events that Chrome otherwise reads as one long scroll and lands two clips down.
- **Keyboard** — arrows and page keys move one page, but only while the Flow is the screen in front.

The wheel listener is on **this pager's own scroller**, never on `document`: an earlier version listened on `document`, so opening the Flow took the wheel away from every other screen until the app was reloaded.

### The maths has one home now

`src/lib/pageMath.ts` (`pageAt`, `stepIndex`, `isOffPage`) with 10 tests. The same two sums had been written inline twice — once for the finger, once for the wheel — and had drifted: one clamped at the ends, the other did not. Tests cover: one gesture = one clip; the first clip cannot be scrolled above and the last cannot be scrolled past; an elastic over-scroll reports page 0 and never `-0`; a zero-height viewport does not divide by zero; and two pixels of rounding are not a half-cut clip.

### "Fix other places that are not fixed properly"

The same class of bug was in the **horizontal rails**: `Crushes This Week` and the circle highlights both rely on `snapToInterval`, which react-native-web ignores — so on the web those rails never snapped at all, and a hard swipe threw them past four tiles. The element-finding and snapping moved into `src/lib/webSnap.ts` (`scrollerFrom`, `useWebSnap(axis)`), which the Flow and both rails now share. It re-applies on content change (cells are created as a list grows), and removes every style it set on unmount, so a snap is never left behind on a shared node.

---

## State

| | |
|---|---|
| Tests | **363 + 5 + 7 passing** (pageMath 10 new) |
| Typecheck | clean |
| Web export | `expo export -p web` succeeds; bundle boots with **no console or page errors** in headless Chromium |
| Compressor | proven in a real browser (table above); `react-native-compressor` installed but **no phone build has been made with it**, so native compression is unproven |
| Git | local commit `acb0cca`, **not pushed** — the PAT is gone from this session |
| Vercel | **not deployed** |

### Known gaps

- **Native compression is unverified.** It is written to the library's documented contract (`maxSize` in MB, `compressionMethod: 'auto'`) but no APK has been built with `react-native-compressor` in it. Until one is, a phone without the module returns `null` and the upload falls through to the size check — which now at least says a big clip is too big rather than pretending to compress it. **The next APK must be rebuilt for phone compression to exist.**
- **The Worker change (`MAX_UPLOAD_BYTES` 80 → 120 MB) is not deployed.** `wrangler deploy` for `cloudflare/media-worker` has not been run; until it is, a 100 MB upload is still refused at the edge.
- Re-encoding is realtime on the web, so a 60-second clip is a minute of waiting. There is no background encode and no cancel.
- Compression is skipped below 72 MB even though the target is 64 MB, deliberately: re-encoding loses quality and most posts never reach it.
- Still open from before: own posts / self-crush display, and double-tap-to-Crush directly on a Flow clip.
