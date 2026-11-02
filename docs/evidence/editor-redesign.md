# The editor, rebuilt from evidence

The previous editor had one decision in it — where the clip starts and where it
stops — spread across eight tools and a single range slider. That is why it felt
like a settings panel rather than an editor: there was nothing to *do* to the
clip, only things to say about it. This is the rebuild, and each part of it says
where it came from.

## The model

`src/lib/timeline.ts` — pure, 12 tests.

An edit no longer holds a trim window. It holds **segments**: windows into the
source file, in order.

```
Segment = { id, start, end }        // always source seconds

source seconds   where a frame lives in the file
cut seconds      where it lives in the made clip
```

Cut time is the running total of the pieces before it. When there is one piece
the two clocks agree, which is why the whole app kept working while the model
changed underneath it.

Operations, all pure:

| function | what it means |
|---|---|
| `splitAt(segments, cutTime)` | one piece becomes two that meet exactly at the playhead |
| `trimSegment` | move a piece's ends; it may not swallow its neighbour or collapse |
| `removeSegment` | take a piece out; the rest joins up, the clock shortens |
| `duplicateSegment` | put a copy after itself |
| `moveSegment(±1)` | reorder |
| `snapTargets` / `snap` | edges stick to piece boundaries and the playhead |
| `clampOverlays` | a caption past the new end is pulled back inside, not orphaned |

Three rules that are enforced rather than documented: **no frames are lost or
shown twice** by a cut; **a cut at a boundary is not a cut** (it returns the
same array, so no undo entry is written); **a piece is never shorter than
0.2 s** and the sequence always keeps at least one piece.

Float drift is handled where it bites: times are rounded to the millisecond, and
`10 − 9.8` is compared with a hair of slack in the tests rather than pretending
it is 0.2.

## Undo

`src/lib/editHistory.ts` — 50 steps, 9 tests.

Two decisions:

- **A gesture is one step.** A drag fires a hundred updates; naming the gesture
  (`'trim'`, `'caption-move-<id>'`) folds them into one entry. Anything discrete
  passes no key and gets its own.
- **Bounded at 50,** because more back-history than anyone uses costs memory on
  a phone.

Nothing in the editor sets state directly any more — every control calls
`record(history, next, key)`.

## The encoder

`src/lib/videoEncode.ts` — 28 tests.

A single trim is a seek (`-ss` before `-i`), which is nearly free. A timeline
with a hole **cannot** be done that way: pieces that were not adjacent in the
file have to be decoded and joined. So `planEncode` now has two shapes, chosen
by `isContiguous(keptRanges(baked))`:

```
[0:v]trim=start=0.000:end=4.000,setpts=PTS-STARTPTS[v0];
[0:a]atrim=start=0.000:end=4.000,asetpts=PTS-STARTPTS[a0];
[0:v]trim=start=8.000:end=12.000,setpts=PTS-STARTPTS[v1];
[0:a]atrim=start=8.000:end=12.000,asetpts=PTS-STARTPTS[a1];
[v0][a0][v1][a1]concat=n=2:v=1:a=1[vc][ac];
[vc]scale=…,setpts=PTS/2[vout];
[ac]atempo=2[aclip];
[1:a]volume=0.4[music];[aclip][music]amix=inputs=2:duration=first:dropout_transition=0[aout]
```

Every piece is reset to start at zero (`setpts=PTS-STARTPTS`) before the join,
or the second piece would begin at its own timestamp in the file. `cutRange`
returns `null` for a join, so a joined timeline never takes the lossless path.

## The timeline UI

`src/components/Timeline.tsx`.

Two lanes — the picture, and what is written over it — with one playhead across
both. Numbers taken from the measurement in `capcut.md`:

| thing | CapCut evidence | Crushly workbench |
|---|---|---|
| desktop tool shelf | 58 × 58 items, panel-specific sider | 72 px vertical rail with 58 × 58 icon-over-label items |
| mobile tool shelf | Bottom shelf, icon over label | Horizontally scrollable bottom rail; same tool IDs and state |
| first track inset | `left: 6px` | 2 px gutter between pieces |
| ruler | 10 px, canvas-drawn, `top: 38px` | 18 px, view-drawn; fit-to-width, no zoom |
| panel transition | 56 px travel, ~200 ms ease-out | 56 px travel, 200 ms ease-out; horizontal on desktop, vertical on mobile |
| top-right action | Export | Save — it stores the edit recipe; it does not render a video file |

The ruler is a **view**, not a canvas, and the reason is stated rather than
copied: at forty seconds and one lane there are five labels to draw, and a
canvas would be an optimisation with nothing to optimise. CapCut's ruler is a
canvas because it redraws hundreds of ticks at zoom; we have no zoom.

**There is no zoom.** CapCut's zoom arithmetic is inside the WASM and not
recoverable (see `capcut.md`). Fit-to-width is honest: the whole clip is always
on screen, the handles get a 16 px grab radius, and nothing is hidden somewhere
off the right edge of a fifteen-second video.

## Playback across a cut

The preview cannot just play the file — that would show the frames you cut away.
The driver (`VideoEditor`, the `requestAnimationFrame` loop) converts each
frame's source time to cut time and, when the frame lands inside a piece that
was thrown away, moves the player to the start of the next piece. A cut plays as
a cut, not as a skip.

## The tool vocabulary

Taken from `editor-tools.tsv`: CapCut's own names for the same operations, so
that Split means Split, Copy means Copy and Delete means Delete.

| ours | CapCut's key |
|---|---|
| Split | `split_web` |
| Copy | `copy_web` |
| Delete | `delete_web` |
| Trim | `cut_web` / `edit_video_web` |
| Speed, Filter, Effect, Text, Music, Volume, Opacity, Animation, Background, Blend, Adjustments, Alignment, Shadow, Stroke, Spacing, Font, Styles, Pattern, Position, Size, Angle, Distance, Intensity, Loop, Duration, Quality, Original, Reset, Undo | same keys |

**Not implemented, and named as missing:** Freeze, Reverse and Transition. Each
needs work the encoder does not do yet (a still-frame insert, a reversed
GOP re-encode, a cross-dissolve), and shipping the button without the operation
is exactly the "bad settings" this round was meant to end.

## What changed in the app

- `VideoEdit` gained `segments`; `trimStart`/`trimEnd` survive as mirrors so
  every screen that builds a trimmed edit still works. An edit saved before
  today is read as a one-piece timeline (`parseEdit`).
- New: `splitEdit`, `removePiece`, `duplicatePiece`, `movePiece`,
  `trimPiece`, `piecesOf`, `sourceTimeAt`, `cutTimeOfSource`.
- `VideoEditor` is history-driven; the header carries CapCut-style hundredth
  timecode plus Undo/Redo, and the only filled header action is **Save**. Save
  returns the original URI and edit recipe to its composer; it is not an export
  or a render operation.
- The board is responsive: desktop uses a left 58 px tool shelf and right
  inspector; mobile uses the same icon-over-label tools on a bottom shelf, with
  the inspector above it. The panel arrives over 56 px in 200 ms.
- The existing `VideoTrim` route now opens this same workbench on the Trim tab;
  it returns the complete recipe to Post, Vibe and Moment instead of a trim-only
  pair of numbers. Reopening a clip passes `initialEdit`, so prior work survives.
- A compact command strip is attached to the timeline: Split · Duplicate ·
  Delete · Earlier · Later. Eligibility follows the playhead/selected segment,
  and every discrete operation enters the same bounded undo history.
- Text creation is a small **Add text** action in the Text inspector only. It
  starts at the current playhead; the rejected global add-text bar is gone.
- The trim panel says how many pieces there are, and that its handles move only
  the two outer ends.
- The preview is explicitly non-destructive. At publish time `preparedClip`
  attempts a native lossless trim where that module is available; the general
  encoder reports unavailable in this build, so unsupported baking falls back
  to the source plus a live edit recipe. Web contrast/saturation remain
  available; native controls that cannot preview accurately are not shown.
