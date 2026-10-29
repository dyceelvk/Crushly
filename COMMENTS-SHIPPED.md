# Crushly — comment threads shipped

Verified 2026-10-29 by fetching each figure, not by assuming.

## Live

| | |
|---|---|
| Web app | https://mecrushly.vercel.app — 200, bundle `index-b9f2a47898c7a09165bd3d27dd8224a8.js` |
| Branch | `app/space-tabs-and-playback` @ `1ee2f41` |
| Android | **1.0.6** · 94,987,935 bytes · sha256 `2d89cee50ed9ac02…` |
| Download | https://mecrushly.vercel.app/download → `/apk/latest` |
| CI on the comments commit | all four jobs green (`beaca0f`) |
| APK pipeline | every step green, including publish and release commit |

The bundle inside the shipped APK contains `CommentsSheet`, `replyCount`,
`canDelete`, `react_to_post_comment`, "This comment was deleted" and
"View comments" — so the phone build has the same sheet the browser does.
Both ABIs present (`armeabi-v7a`, `arm64-v8a`).

## What shipped

**Database** — migration `20261029000030_post_comment_threads`, applied live:

- `post_comments.parent_id` + `hidden`; a trigger keeps answers one level deep
  and on the same post.
- `post_comment_likes` with RLS: you may only write your own row.
- `post_comments_feed` returns the whole thread in one call with `likeCount`,
  `liked`, `replyCount`, `canDelete`, `hidden`.
- `comment_on_post(post, body, parent)` and `react_to_post_comment`.
- Deleting a comment that has answers **empties** it; childless ones are removed.

**App** — one `CommentsSheet` replaces two divergent copies (PostViewer had its
own, the Flow card had another). Both screens open the same one.

## Cleared away

The throwaway `ui.probe.*@crushly.test` account and every row it created were
deleted; the post it commented on is back to its original single comment.

## Still open

- Two versions answered to 1.0.6 (the first APK was replaced by `--clobber`).
  versionCode still rises (100014 → 100015), so the in-app updater is unaffected,
  but the next release should be 1.0.7.
- PRs #7 and #9 unmerged, as instructed.
