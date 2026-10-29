# Bug report — video posts refused with "That file type is not supported."

**Reporter:** Odoh chiagoziem isreal
**Severity:** blocker — no video could be published at all
**Affects:** 1.0.6 → 1.0.9, every platform
**Fixed in:** 1.0.10 (versionCode 10)
**Status:** fixed, verified against production; **not yet verified on a physical phone**

---

## 1. What a member saw

They picked a clip from their camera roll, wrote a caption, pressed Post, and got
a toast:

```
__CRUSHLY__415____That file type is not supported.
```

The file was a video. It played fine in the phone's own gallery. It played fine
in the picker's preview. It was refused on upload.

## 2. What it was not

Three wrong guesses were made and each was disproved before the real cause was
found. Recording them matters — they are the paths someone will try first.

| Guess | Why it was wrong |
|---|---|
| "The picker is returning an image" | No. The picked asset carried `video/quicktime` and a non-zero duration. The picker was honest. |
| "The Worker is rejecting the body" | No. The Worker never saw a byte. Nothing was written to Backblaze B2 and no request reached it. |
| "It is a client-side extension check" | No. `extensionFor()` returned the right answer. There is no client check that produces this sentence. |

## 3. Root cause

`media_upload_ticket()` in Postgres is the only gate between a chosen clip and
storage. It resolved the MIME type through `media_extension()`:

```sql
when 'video/mp4'   then 'mp4'
when 'video/webm'  then 'webm'
-- and nothing else for video
```

`video/quicktime` — the label an iPhone and a Samsung gallery both attach to
`.mov` — matched no branch, so the function returned `NULL`, and the ticket
raised:

```sql
if v_ext is null then
  perform public.crushly_fail(415, '', 'That file type is not supported.');
end if;
```

**The two most common phones in the market produced a container the backend had
never heard of.** The `__CRUSHLY__415____` prefix is the database's own error
marker, and the Worker at the time passed it through verbatim instead of
unwrapping it — which is why the member saw the marker rather than the sentence.

## 4. The fix, in four layers

Each layer is independently sufficient to matter; none of them hides an error or
loosens a policy.

### 4.1 The database accepts the container

`supabase/migrations/20261030000200_video_container_support.sql`

```sql
when 'video/mp4'       then 'mp4'
when 'video/webm'      then 'webm'
when 'video/quicktime' then 'mov'      -- added
when 'video/x-m4v'     then 'mp4'      -- added
```

The four duplicated per-kind sentences became one function,
`media_kind_allows(kind, ext)`, so the rule has a single definition. **Ceilings,
the hourly rate limit and path booking were not touched.** No MIME type that a
browser treats as executable or as a document was added.

### 4.2 The client converts before upload

`createPost()` calls `remuxToMp4()` on any clip that is not already MP4 or WebM.
This is a stream copy through the platform muxer: the encoded frames are
unchanged, it takes about as long as copying the file, and **no encoder is added
to the APK**. MP4 and WebM stay the first-class stored formats; QuickTime is the
safety net when a remux cannot run.

### 4.3 The Worker stops leaking internals

`cloudflare/media-worker/src/index.ts` now unwraps
`__CRUSHLY__<status>__<code>__<message>` into a real HTTP status and a plain
sentence. A member reads `That file type is not supported.`, not the marker.

### 4.4 The Worker serves a real media type

`withHeaders()` sets `Content-Type` from the file extension and advertises
`Accept-Ranges: bytes`. Previously the content type came from storage metadata;
combined with `X-Content-Type-Options: nosniff`, a clip could arrive as
`application/octet-stream` and be downloaded instead of played.

## 5. Before and after, measured against production

**Before (1.0.9):**

```
video/mp4                -> 200  mp4
video/webm               -> 200  webm
video/quicktime          -> 400  __CRUSHLY__415____That file type is not supported.
video/x-m4v              -> 400  __CRUSHLY__415____That file type is not supported.
application/octet-stream -> 400  __CRUSHLY__415____That file type is not supported.
```

**After (1.0.10):**

```
video/mp4       -> 200  mp4
video/webm      -> 200  webm
video/quicktime -> 200  mov
video/x-m4v     -> 200  mp4
application/octet-stream -> 415  {"error":"That file type is not supported."}
90 MB post clip          -> 413  {"error":"That file is too large to send."}
```

**End to end:** a `.mov` uploaded (201) to
`posts/30/1793304052653-988c846b16.mov`; it was attached to a post
(`create_post` → 200); the file came back
`200 video/quicktime accept-ranges: bytes`. An `.mp4` came back
`200 video/mp4 accept-ranges: bytes`.

## 6. Regression guard

`CrushlyApp/src/lib/upload.test.ts` carries 8 unit tests over the container
rules. The app suite is **118 pass / 0 fail**. The database suite applies all 37
migrations **twice**, then asserts the ticket matrix, the per-kind ceilings and
the hourly limit: **0 failures**.

## 7. What is still open

**No `.mov` recorded on a real iPhone or Samsung has been published and played
back on a physical device.** The ticket, the upload and the serve layer were all
proven over HTTP against production, and a real MP4 was published end to end —
but the camera-roll path on hardware is unproven. This is the one test that
would close the bug from the member's point of view.

## 8. A caution for whoever touches the rate limit next

The hourly ceiling counts **published** photos, moments, messages, posts, circle
messages and vibes. It does **not** count `media_upload_reservations`. A moment
with no file books no reservation, so counting reservations alone lets a member
publish past the limit. This was rewritten once during this fix and reverted when
the smoke suite caught it. Do not replace that predicate.
