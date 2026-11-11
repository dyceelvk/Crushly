# The Moments viewer had no working controls

Date: 2026-11-11. Reported as: *"you can't crush or reply you can't do nothing"*
inside other people's Moments, plus a system crash dialog.

## What was wrong

`MomentViewer` draws a full-screen surface that owns the gestures — tap for the
next Moment, hold to pause, swipe to leave. It carried `zIndex: 1`. The header
and the bottom bar carried none, so on React Native (and on React Native Web)
the gesture surface painted over them and took their touches. Nothing looked
wrong: every control was drawn, correctly styled, in the right place, and dead.

Measured, not guessed. The harness mounts the real screen in a browser at
390×844; asking which element is on top of the reply field returned:

```
before:  button[Moments player]      ← the gesture surface
after:   input[Reply to Ngozi…]      ← the field itself
```

Tapping the reply field advanced nothing and focused nothing; tapping the
reaction button opened nothing. The same surface covered Close, Delete, Follow,
"Seen by" and every reaction in the picker.

## The fix

Layers live in one tested place, `src/lib/viewerLayers.ts`:

| layer | z | what is there |
|---|---|---|
| `pager` | 0 | the gesture surface — the biggest thing, the lowest |
| `card` | 2 | a shared post's card, above the pager so a tap opens it |
| `content` | 3 | words and captions, where links live |
| `chrome` | 6 | the header and the bottom bar: anything you can press |

The rule: anything you can press must be above the pager. A unit test holds the
ordering, and a source-level guard fails the build if a raw `zIndex: 1` comes
back into `MomentViewer.tsx`.

## Proof, both directions

| | before | after |
|---|---|---|
| tap the reply field | `activeElement` = `BUTTON`, keyboard closed | `INPUT[Reply to Ngozi…]`, focused |
| tap React | reaction row absent | reaction row present |
| topmost at the reply field | `button[Moments player]` | `input[Reply to Ngozi]` |
| tap the picture | advances | advances (still works) |

## Sweeps run at the same time, so the claim is not narrower than the report

- **All 32 harness screens rendered**: 0 renders threw. One real find — the tab
  bar threw on a route it had no icon for (`icon[1]` of `undefined`), which takes
  the whole app down; it now draws a plain dot instead.
- **Pressed every control on 16 core screens** (Flow, both viewers, your own
  post, Moments, both Moment viewers, a Space, Discover, Profile, Chat, Messages,
  Crushes, Homies, a Circle, Settings, the tab bar): 0 throws, 0 fallbacks.
- The harness itself was lying in two places, both fixed: it seeded a Space's
  posts as `{items}` when `useSpacePosts` is an *infinite* query that needs
  `{pages: [...]}`, and it still imported `screens/flow/Flow`, renamed long ago.

## Not explained yet

The device showed **"holUpp keeps stopping"** on a 1.0.95 install. Nothing in
the sweeps above reproduces a crash, and a render-time throw would be caught by
`ErrorBoundary` and drawn as a message, not kill the process. A process kill is
either a native-module fault (media library, video encoder, updater) or an error
thrown outside React. The MIUI dialog's *View summary* holds the stack, and that
is what is needed to fix it rather than guess at it.

---

## The update channel, while all this was happening

The 1.0.96 APK built and its emulator walk passed (run `43059618397`), and it is
on the GitHub release `android-test-1.0.96` — 97,042,324 bytes, SHA-256
`1633f024…`, signed with the same key as 1.0.87.

But `/download` answers **503**. Not a code fault this time: the B2 account's
**download cap is exhausted**, and B2 says so plainly —

```
{ "code": "download_cap_exceeded",
  "message": "Cannot download file, download bandwidth or transaction (Class B)
              cap exceeded. See the Caps & Alerts page to increase your cap.",
  "status": 403 }
```

Every install of the app pulls ~97 MB *through the Worker from B2*, so a
handful of installs in a day, plus the mirror's own readback and the checks that
verified 1.0.95, is enough to hit a free-tier cap. Two consequences worth fixing
properly, in order of how much they cost:

1. **Raise the cap** (or set it to no limit) in the B2 console — Caps & Alerts.
   That restores the channel without a code change.
2. **Stop paying B2 egress for the APK at all.** It is 97 MB served from a
   bucket whose egress is metered; Cloudflare R2 costs nothing to serve and the
   Worker already lives on Cloudflare. That migration is the real fix.

Until then the GitHub release page is the way in for anyone who can sign in to
the repository.
