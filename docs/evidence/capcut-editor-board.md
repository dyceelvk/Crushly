# What CapCut's editor board actually looks like

Captured 2026-11-01 while rebuilding `CrushlyApp/src/components/VideoEditor.tsx`.
Screenshot: `capcut-editor-shell.png` (this folder).

## How it was captured

Headless Chromium 131 (Playwright build) with CDP on `:9222`, device metrics
1440×900, then `document.querySelectorAll` over the loaded shell and the
accessibility text of every control. No account, no sign-in, no bypass: the
editor shell loads for a logged-out visitor, and everything below was read from
that shell.

## What the board is made of

Three regions, top to bottom:

1. **Stage.** The preview, centred, nothing else on it. No header bar full of
   controls; the picture is the thing.
2. **Timeline panel** (observed container: `.timeline-panel-container-*`). A
   ruler in `hh:mm:ss`, the clip lane, a playhead, and the zoom control — every
   time in the product is spoken in `00:00:00`, never in percentages.
3. **Tool rail.** One row of icon-above-label items, in this order, read
   verbatim from the live DOM:

   `Media · Templates · Elements · Audio · Text · Captions · Transcript ·
   Effects · Transitions · Filters · Brand kit · Plugins`

   The rail is a *shelf*, not a menu: the panel for a chosen tool opens directly
   above it, so the hand never leaves the bottom two inches of the screen.

The two actions that are not in the rail sit in the top corners: back/close on
the left, and **Export** on the right as the single filled button on the board.
The sider menu panel (`workbench-sider-menu-panel-container`) is a desktop-only
variant of the same shelf.

## What we took from it

- **The finish action is top-right.** CapCut calls it Export. Crushly calls it
  **Save**, because the current `onDone` contract stores an edit recipe beside
  the original URI; it does not render a new video file.
- **Timecode in the header.** `0:00.00 / 0:12.00` keeps the current output time
  and total visible before the user touches anything.
- **A real timeline.** A slider says "somewhere in the middle"; a ruler with a
  playhead and two grab handles says where you cut. Crushly uses the two-lane
  `Timeline.tsx` surface.
- **The rail is a shelf.** Icon over label, active item in gold, the panel
  opening above it on mobile; on desktop the same tool IDs sit in a 58 px left
  rail and the inspector opens at the right.
- **The stage stays clean.** Anything that is not the clip belongs below the
  header and outside the preview. The play affordance is only 54 px wide while
  paused; it never blankets the canvas or blocks overlay drag handles.

## Limits, stated plainly

- CapCut's web editor puts a sign-in modal over the board once it has loaded.
  Everything above came from the shell *behind* that modal; the contents of
  individual tool panels were not read.
- The TikTok app was not inspected: it ships as a protected APK/IPA, and reading
  its editor screen would mean bypassing those protections, which we do not do.
  What we know of the TikTok editor board is public behaviour, not reverse
  engineering.
