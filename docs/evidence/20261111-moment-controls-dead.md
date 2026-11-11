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

---

## Moving the APK to Cloudflare R2

The B2 cap will not be raised in an afternoon, and the channel cannot depend on a
metered egress allowance in any case: every install is ~97 MB, and one day of
installs is enough to exhaust a free tier. So the release moved to the account
the Worker already lives in.

**What changed**

| | before | after |
|---|---|---|
| where the APK lives | private B2 bucket, streamed through the Worker | private R2 bucket `holup-releases`, bound as `RELEASES` |
| what it costs to serve | metered egress — the thing that ran out | nothing |
| how it is published | `mirror-android-apk.py` → B2 API | `wrangler r2 object put` → R2 |
| verification | read the object back over B2 | read it back out of R2 and compare **bytes and SHA-256** to `release.json` |

**The order of preference in `downloadRelease`:** R2, then the B2 mirror. The
fallback exists because an older install can ask for a build only the mirror
still holds, and because a fallback nobody exercises is a fallback that does not
work. Whichever source answers, the object's size is checked against
`release.json` before a byte is sent — the app refuses a file whose length is not
the one it was promised, so serving a stale or truncated object would turn
"update available" into "update failed" on the phone.

**Tests** (`releaseSource.test.ts`, 7): served from R2 with the right headers and
ZIP magic; HEAD answers with the length and no body; CORS for the web origin; an
object of the wrong size is refused rather than served; a missing object falls
through to the mirror; a Worker deployed before the bucket existed still answers
instead of throwing; `/version` still advertises exactly what `release.json`
says.

The bucket is created by `deploy-worker.yml` if it is missing — a binding to a
bucket that does not exist makes wrangler refuse the deploy, which would have
taken the whole Worker down with it.

---

## Why nothing was building, and the channel that costs nothing

Two separate blockers, neither of them code.

**1. GitHub Actions had no room to run.** 220 artifacts — nearly all 40 MB APKs
from previous builds — came to **3.9 GB**, against the **500 MB** a private repo
gets. Past that, with no spending limit set, GitHub stops starting jobs: nine
runs sat `queued` with **zero jobs created**. Deleting the old artifacts freed
3.86 GB and builds started within two minutes. Nothing was paid for. What is left
is the 1.0.96 build (77 MB) and nothing else.
*The lesson is retention, not money:* every emulator round trip left a 40 MB APK
behind, and a hundred of them is a wall.

**2. R2 — the intended home for the APK — needs the R2 subscription switched on**
in the Cloudflare account first, and that checkout asks for a card. The Worker
token also lacks `Workers R2 Storage: Edit`, so the bucket could not be created
even if the subscription existed. So R2 waits.

**What ships the APK meanwhile: a public release channel.**

A public repository's release assets are downloadable by anyone with the URL —
the same audience `/download` already has — GitHub does not meter bandwidth on
them, and they do not count against Actions storage. So `dyceelvk/holupp-releases`
holds the APK, and the Worker re-serves it behind its one stable URL.

Source order in `downloadRelease`: **R2 if ever bound → the public channel → the
B2 mirror.** Every rung is verified the same way: the object's length must equal
`release.json`'s `bytes` before a byte is forwarded.

The R2 binding is **commented out** in `wrangler.toml` rather than left dangling,
because a Worker bound to a bucket that does not exist fails to deploy *entirely*
— that would have taken the media pipeline and the update channel down together.

**Verified after deploy (2026-11-11 22:05 UTC):**

| | |
|---|---|
| `/version` | 1.0.96, code 96, 97,042,324 bytes |
| `/download-info` | same file, same bytes, same SHA-256 |
| `/download` | **HTTP 200**, 97,042,324 bytes, correct SHA-256, `PK\x03\x04` |
| signature | `7c1f8fc6…b6bb` — same as 1.0.87, so it installs in place |
| cost | **$0** — no B2 egress, no R2 subscription, no Actions minutes |

---

## Storage: what R2 costs and where the 10 GB goes

The 10 GB free tier is **per account, pooled across all buckets** — not per
bucket. Two buckets share it; buckets themselves are free, the stored bytes are
not. Measured 2026-11-11: `holupp` 97.0 MB (the APK) + `holupp-media` 0.0 MB =
**1.0% of the free tier**.

Paths are `<kind>/<userId>/<millis>-<hash>.<ext>`, kinds `photos | moments |
messages | posts | circles`, so retention is a prefix rule rather than a guess.

**`holupp-media` lifecycle, applied and read back:**

| rule | prefix | effect |
|---|---|---|
| `expire-moments` | `moments/` | delete 1 day after upload (86400 s) |

Without it, every expired Moment would sit in R2 forever — invisible in the app,
permanent in the bill. The rule matches the promise the product already makes: a
Moment lasts a day. Photos, posts, circles and messages are not expired by any
rule; they go when a member deletes them.

Written with the same care as the B2 rules: a bare `moments` prefix is what the
dashboard's box accepts, and a rule with no prefix at all would delete every
profile photo. The prefix is trailing-slashed.
