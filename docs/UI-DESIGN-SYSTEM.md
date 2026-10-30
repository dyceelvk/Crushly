# Crushly — UI design system

**Official credit: Odoh chiagoziem isreal.**

The visual contract of the app. Written down so a screenshot can be checked
against it, and so nobody "improves" a screen that was already signed off.

---

## 1. Palette

| Token | Value | Used for |
|---|---|---|
| background | `#070708` | every screen, the launcher tile, `theme-color`, splash |
| accent | pink/magenta | the Crushly mark, active engagement icons, primary buttons |
| surface | near-black raised | cards, sheets, the comments drawer |
| text primary | near-white | display name, caption |
| text secondary | muted grey | counts, timestamps, audio row |

**Dark only.** There is no light theme and there must not be one: the media sits
on black, and a light plate changes the whole feel of the viewer.

## 2. Type

- **Fraunces** — display. Headings, the wordmark, the splash.
- **Manrope** — everything else.

Both are bundled, both are SIL Open Font License 1.1. One icon font family ships
(`@expo/vector-icons`); 19 others were removed in 1.0.8 to save 3.7 MB.

## 3. The mark

The Crushly heart. In the app it is drawn as geometry in `Logo.tsx` /
`CrushlyMark` so it stays sharp at any size, and the same geometry is the source
of `assets/` launcher art. **Never substitute a letterform.** A C monogram used
to leak into the launcher icon and the favicon; it is gone.

## 4. Screen inventory

| Screen | What it is |
|---|---|
| Splash | brand mark, held ~1.2 s. **No screen precedes it.** |
| Onboarding | age gate, terms, profile set-up |
| Discover | card stack — create and discover your Crushes |
| Crushes | inbound and outbound crushes, matches |
| Flow | the timeline: photos, clips, captions, engagement |
| Post viewer | immersive vertical video (see `POST-VIEWER-SPEC.md`) |
| Moments | 24-hour disappearing posts, rings on avatars |
| Circles | group threads with media and voice notes |
| Vibes | very short clips, fortnight lifetime |
| Space | profile-scoped feeds + vibes tabs |
| Messages | conversation list, thread, reactions, receipts |
| Notifications | activity, per-type preferences |
| Settings | account, privacy, notifications, **About Crushly**, update |
| Profile | own and others', verification badge, distance |

## 5. Copy rules

These are not style preferences; they were corrected explicitly and must not
regress.

| Use | Never |
|---|---|
| "Create and discover your Crushes." | ~~"Find your connection"~~ |
| "Say something…" — **only inside an open comment sheet** | the same placeholder sitting on the viewer |

## 6. Layout rules that were signed off

**Post viewer** — full-bleed media; avatar + display name top-left; three-dot
menu top-right; vertical rail on the right carrying **Like · Comment ·
Bookmark** in that order; caption then audio information bottom-left; **no
composer** until comments open.

**Engagement** — counts live on the action they belong to. A comment count is
not a separate row.

**Navigation** — the bottom bar is persistent across Flow, Discover, Crushes,
Circles and Messages; the viewer is a full-screen push with its own dismiss.

## 7. Splash

- The brand mark, never a letterform, never a gradient C.
- Held ≈1.2 seconds. It used to flash past, which read as a glitch.
- `imageWidth`, `resizeMode` and a dark variant are set in the plugin config so
  the mark is sized deliberately on both iOS and Android.

## 8. Accessibility and device behaviour (current state)

- All tappable targets are at least 44 px.
- The tab bar and sheets respect safe-area insets.
- Android `softwareKeyboardLayoutMode` is `resize`, so the composer lifts with
  the keyboard.
- **Known gap:** `Chat.tsx` still has a keyboard-avoidance defect — the input can
  sit under the keyboard in the thread screen. Tracked as an open bug.
- No formal contrast audit has been run. The palette is high-contrast by
  construction (near-white on near-black) but this has not been measured.

## 9. Changing this document

If a screen must change, change the code **and** this file in the same commit,
and say in the changelog which rule was amended and why. A design rule that
exists only in someone's memory is how the C monogram came back.
