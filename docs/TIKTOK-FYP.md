# How TikTok's For You feed actually works — and what transfers to Crushly

Reverse-engineered 2026-11-02. Two independent sources, both inspected directly
in this workspace, not summarised from articles:

1. **The live web client**, rendered in Chromium at Pixel 7 size (412×915) with a
   mobile UA — every request, response body, screenshot and the accessibility
   tree recorded by `harness/browse.py` in `harness/runs/tiktok-fyp{,2,3}/`.
2. **The Android app itself** — v47.6.3, arm64-v8a, 224 MB XAPK pulled with
   `apkeep`, 15 dex files, 130 MB of bytecode, decoded with `jadx`/`apktool`.

---

## 1. The feed is a ranked stream of items, not a page of posts

The web FYP asks for:

```
GET /api/recommend/item_list/      count=9      <- the stream
GET /api/preload/item_list/        count=2      <- runway ahead of the user
```

Two separate endpoints, and the second one exists purely so the next clips are
already in memory before the finger arrives. That is the whole reason the feed
feels instant: **9 requested, 2 prefetched, 1 on screen.**

The first request carries **no cursor** — the server chooses where you start.
Everything else in the query string is context for the ranker, verbatim from the
captured URL:

| group | params (as sent) |
|---|---|
| app identity | `aid=1988`, `app_name=tiktok_web`, `channel=tiktok_web`, `device_platform=web_mobile`, `os=android`, `browser_language`, `browser_name`, `browser_version` |
| who you are | `region=US`, `tz_name`, `is_non_user`, `is_new_user=true`, `user_is_login=false`, `device_id`, `WebIdLastTime` |
| what you're doing | `from_page=fyp`, `history_len=2`, `focus_state=true`, `is_page_visible=true`, `is_fullscreen=false` |
| what you allow | `isNonPersonalized=false`, `data_collection_enabled=false` |
| how you're bucketed | `clientABVersions=70508271,77186133,…` — server-assigned A/B groups |
| the ask | `count=9`, `pullType=1`, `coverFormat=2` |
| anti-bot | `X-Bogus`, `X-Gnarly`, `X-Dynosaur` (the Android app signs with `msToken`) |

The response is `{statusCode, itemList[], hasMore, extra, log_pb}`, and each item
carries far more than the post itself:

```
id, desc, createTime, isAd, AIGCDescription
author{uniqueId, nickname, verified, signature, followerCount}
stats{playCount, diggCount, commentCount, shareCount, collectCount}
music{title, authorName, original}
video{duration, ratio, width, height, codecType}
challenges[hashtags], textExtra
diversificationId, item_control, contentContext, log_pb
```

`diversificationId`, `item_control` and `log_pb` are the interesting ones: the
server tags every item for **diversity control** and returns **logging keys**, so
the client can report back exactly what was shown, in what position, and under
which experiment.

## 2. The ranker is not in the app — and that is the point

Nothing in 130 MB of bytecode contains the ranking weights, because the ranking
happens server-side and per user. Anyone who tells you they "extracted TikTok's
algorithm from the APK" is selling something. What the APK *does* contain is the
**signal path**, and it is unambiguous:

| string | occurrences in the dex | what it means |
|---|---|---|
| `play_time` | 103 | how long each clip was watched, per clip |
| `video_play` | 87 | explicit play events, distinct from views |
| `dwell` | 13 | time spent without touching anything |
| `not_interested` | 22 | the dislike path |
| `insert_aweme` | 5 | the server can **splice an item into** a stream already on the phone |
| `/aweme/v1/feed/?type=0` | — | the FYP endpoint in the app (type 0 = For You) |
| `/aweme/v1/feedback/cancel/` | — | you can undo a feedback signal |
| `pull_type`, `feed_count`, `is_cold_start`, `preload` | — | refresh vs. continue, page size, cold start, prefetch |

So the loop is: **server ranks → client renders one item per screen → client
reports dwell/play/skip → server re-ranks**. `insert_aweme` is what makes it feel
alive mid-scroll: a new item can appear in front of you without a page reload.

## 3. The UI, as measured on a 412×915 screen

- **Full-bleed, and letterboxed, not cropped.** A 16:9 clip sits centred with the
  background showing above and below. TikTok never crops the subject out to fill
  a tall screen — my first capture shows exactly that (a 9:19.5 phone, a
  landscape-ish game clip, black bars).
- **Right rail**, fixed, above the video: avatar with a `+` follow badge, heart +
  count, comment + count, share, and a rotating music disc. Numbers are
  abbreviated (`739.2K`, `2046`), never raw.
- **Bottom-left stack**: creator name, hashtags, then a music marquee. Three
  lines of text, one visual block, always bottom-aligned.
- **Tab bar** is translucent over the video: Home, Discover, `+`, Inbox, Profile.
- **Top bar** is minimal: menu, search. Everything else is the video.
- Overlays never reflow the video. The layout is `video` + `overlay`, not a
  column of widgets.

## 4. What I am not claiming

- I did not recover ranking weights, and I would not trust anyone who says they did.
- I did not finish decompiling all 15 dex files. `jadx` was run on `classes2.dex`
  and `classes4.dex` (27 MB of Java out); the parameter names above come from the
  dex string tables of all 15, which is where they live.
- The Android app's FYP is protobuf over `aweme/v1/feed`; the JSON shapes quoted
  here are the *web* client's, which is the same data model in a different
  encoding. Crushly should copy the model, not the encoding.

---

## 5. What this means for Crushly, concretely

Crushly's feed today is `public.flow_feed(p_limit, p_after)`: strict reverse
chronological, keyset on `(created_at, id)`, no scoring at all. It is a timeline.
TikTok's is the opposite: **scored stream, one item per screen, prefetched,
feedback-driven**.

The transferable architecture, in the order it has to be built:

1. **Signals table.** `post_feedback(post_id, viewer_id, kind, dwell_ms,
   completed, position, created_at)` — impressions and dwell, which Crushly
   records nowhere at the moment. Without this there is nothing to rank on.
2. **A ranked feed function.** `flow_ranked_feed(p_limit, p_cursor)`:
   score = engagement velocity × recency decay × author affinity, with a
   diversity rule (no more than one post per author in any 3), an exploration
   slice for new authors, and already-seen suppression per viewer.
3. **Cursor, not offset.** `(score, id)` keyset, so the page you are reading does
   not shift when someone posts.
4. **Prefetch on the client.** Ask for 8, render 1, keep 2 ahead — Crushly's
   `Flow` should hold a preload window rather than fetching a page at a time.
5. **Dwell reporting.** On swipe-away, post `dwell_ms` and `completed`. That is
   the single most valuable signal in the whole system and it is cheap to send.
6. **One video at a time.** Already half-there on the release line
   (`playbackPolicy`), absent on `main`.

Steps 1, 2 and 3 are pure SQL and can be tested against a real Postgres without a
phone — which is where I am starting, because it is the part that decides whether
the feed is any good.
