# Crushly — viewport and playback specification

**Owner and official credit: Odoh chiagoziem isreal.**
Status as of 1.0.10: **shipped and verified in the codebase.**

This is the post viewer as the member is meant to meet it. It is written down
because it was asked for explicitly and had to be preserved, not redesigned.

---

## 1. The viewer, top to bottom

A full-bleed vertical viewport. One post at a time. Nothing scrolls except the
clip itself when it is full-length.

| Region | Contents | Notes |
|---|---|---|
| Background | the media, `resizeMode: cover`, filling the plate | immersive; no card, no border, no letterbox |
| Top-left | author avatar + display name | avatar is the profile image, name is the display name |
| Top-right | three-dot menu | opens the action sheet (report, share, mute…) |
| Right rail | **Like · Comment · Bookmark** | vertical engagement column, icon + count |
| Bottom-left | caption, then audio information | caption is the post body; audio row names the track when one exists |
| Bottom | **no composer** | see §3 — this is the rule that must never regress |

Dark theme throughout; the accent is Crushly's pink/magenta. The engagement
icons take the accent when active.

## 2. Playback

- Vertical video renders cover-cropped, plays inline, and pauses when it leaves
  the viewport.
- Every surface that shows a clip — Flow, the viewer, Vibe playback — shares
  the same play/pause treatment, so a clip pauses where the member paused it
  and does not silently start again after navigation.
- The Worker serves `Accept-Ranges: bytes`, so scrubbing seeks instead of
  re-downloading, and serves an explicit `Content-Type` per extension, so
  `nosniff` no longer turns a clip into a download.

## 3. The composer rule — the one that regressed before

> **"Say something…" must not appear on the post viewer.
> It appears only after the member opens the comments,
> and it disappears again when the comments close.**

Enforcement, in order:

1. The composer is **not** part of the viewer's default tree. It is rendered
   inside the comments sheet only.
2. Opening comments mounts the composer with the sheet.
3. Closing the sheet unmounts it, so the viewer returns to a clean frame —
   avatar, menu, rail, caption, audio, playback. Nothing else.

This was previously wrong: the composer sat at the bottom of the viewer at all
times, inviting a comment on a post whose comment thread was not even open. Any
change to the viewer must re-test this sequence:

```
open post → composer absent
tap Comment (or the count) → sheet opens → composer present
close sheet → composer absent
```

## 4. What must not change

- The three actions on the rail stay **Like, Comment, Bookmark** — in that
  order. Comment counts live on the Comment action, not in a separate row.
- Author identity stays at the top, over the media, not in a header bar above it.
- The plate stays dark. No light-mode variant of the viewer.
- The accent stays pink/magenta.
- Images and clips are treated the same at the layout level; a photo has no
  play control, a clip does.

## 5. Verification performed for 1.0.10

- Viewer tree read end to end: composer is mounted by the comments sheet, not by
  the viewer.
- Engagement rail order confirmed: Like → Comment → Bookmark.
- Avatar + display name confirmed in the overlay.
- Three-dot menu present and wired.
- Caption and audio row confirmed at the bottom-left.
- Dark palette and magenta accent confirmed against the theme constants.
- No screenshot of a real device was taken for this pass — see
  PROJECT_CONTINUITY §7 for what that leaves unproven.

## 6. The Bookmark, since 1.0.10

At 1.0.10 the Bookmark was the one control on the rail that did not keep its
promise: it flipped a local `useState` and toasted "Post saved" without writing
anything, so the save was gone when the viewer closed. That is now a row.

- **Table.** `post_saves (user_id, post_id, created_at)`, primary key on the
  pair, cascade on both sides. RLS allows select/insert/delete on your own rows
  and nothing else — no policy exists by which a post's author could learn who
  saved it.
- **Calls.** `save_post(post, saved)` returns the resulting `{saved}`;
  `post_saved(post)` is what the icon asks on open; `saved_posts()` is the
  drawer, shaped like `flow_feed` and filtered by `can_view_post`.
- **Screen.** `SavedPosts`, reachable from the bookmark in the Flow header and
  "Saved posts" in Settings, reusing `PostCard` so a saved post behaves like any
  other.
- **What it is not.** Not a count, not a signal, not something the author sees.
  A save is closer to a browser bookmark than to a like, and the schema is
  shaped so it cannot become anything else by accident.
