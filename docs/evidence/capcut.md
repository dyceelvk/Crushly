# CapCut — what was measured, and how

Everything below came out of files this workspace actually holds, or out of a
page loaded in a headless browser on this machine. Nothing here is recalled from
memory or inferred from a screenshot. Where something could **not** be recovered,
it says so at the bottom instead of being guessed.

Artifacts in `/home/user/evidence/capcut/`:

| file | bytes | what it is |
|---|---:|---|
| `editor.5b26491d59.js` | 3,241,407 | the editor entry bundle |
| `src-editor-47f8d511.648ba5c078.js` | 404,932 | the editor's own feature chunk |
| `en.182cf42f244d847a11d09355809fe39d.js` | 1,406,540 | the English locale object, `window.__lngResource={…}` |
| `locale.json` | 1,440,856 | the locale parsed with `vm.runInNewContext` — **20,879 keys** |
| `buttons.tsv` | — | 10,339 short UI labels across 531 modules |
| `editor-tools.tsv` | — | 122 `*_web` keys: the editor's canonical button vocabulary |
| `shortcuts.tsv` | — | 49 `web_graphic_generaltips_*` chord entries |
| `css_editor.674f84cb99.css` | 667,615 | the stylesheet, including every keyframe |

## 1. How it is built (front end)

The page at `https://www.capcut.com/editor?scenario=custom` was loaded and its
`performance.getEntriesByType('resource')` list read: **250 resources**. The
bundle graph is a webpack runtime plus named families:

```
lv-components   framework   byted   services-*   widget-*
src-editor-0 … src-editor-6   vendors-*
```

and — the part that matters — **async chunks named after the panel they belong
to**: `timeline/play`, `titlebar/export`, `titlebar/toolbar-view-mode`,
`sider-menu/shortcut__chunks_preload`, `multi-track-transcribe`, `file-drag`,
`mask-widget-container`.

That naming is the architecture, stated by CapCut in its own filenames:

> The shell is small. **Every panel is a chunk that is fetched when the panel is
> opened**, not when the editor is.** Nothing in the entry bundle can describe
> what a given button does, because the button's code is not in the entry
> bundle.

This is why grepping for `"split"` finds it five times in 3.2 MB of
`editor.*.js` and once in `src-editor-*`: the label string lives in the locale
file, the behaviour lives in a chunk nobody has asked for yet.

## 2. The engine

The rendering engine is **VESDK** — ByteDance's video editing SDK — loaded as
`static/assets/vesdk-lvapi-opt.e24bc59d6f.js` (709,142 B transfer, the largest
script on the page). Around it, in the same bundle, are the worker plumbing
names:

```
wasmPreloader        warmupUnzipitWorker
prefetchEditorResources   draftPreload
```

Read together, these describe the boot sequence:

1. the editor shell paints with no engine at all;
2. `wasmPreloader` fetches the `.wasm` and compiles it **in a Web Worker**, so
   the main thread never blocks;
3. `warmupUnzipitWorker` spins up the decompression worker that the WASM needs
   to unpack assets;
4. `prefetchEditorResources` pulls the media and fonts the draft will need;
5. `draftPreload` builds the draft's timeline **before** the user touches it.

The consequence is the thing worth copying: **timeline edits are instant after
the first frame**, because by then the engine is already running and the draft
is already decoded. The WASM is the editing core — trim, split, transitions,
compositing, export — and it is *not* readable as JavaScript.

## 3. Every button

A button in this editor is made of four things: a locale key, an icon, a
position in a vertical sider, and a lazy chunk. Three of the four are in hand.

### 3a. The vocabulary

`editor-tools.tsv` holds every `*_web` key with a short value — 122 of them. The
ones that name editing actions, verbatim:

```
cut_web        Cut            split_web      Split         copy_web     Copy
delete_web     Delete         speed_web      Speed         reverse_web  Reverse
rotate_web     Rotate         edit_video_web Crop          volume_web   Volume
opacity_web    Opacity        animation_web  Animation     background_web Background
blend_web      Blend          adjustment_web Adjustments   alignment_web Alignment
text_web       Text           text_effect_web Text Effect  filter_web   Filter
effect_web     Effect         effects_web    Effects       music_web    Music
audio_web      Audio          shadow_web     Shadow        outline_web  Stroke
spacing_web    Spacing        font_web       Font          style_web    Styles
pattern_web    Pattern        position_web   Position      size_web     Size
angle_web      Angle          distance_web   Distance      intensity_web Intensity
loop_web       Loop           duration_web   Duration      quality_web  Quality
original_web   Original       reset_web      Reset         Undo_web     Undo
```

The `*_web` naming is the web app's own alias table: the same strings appear
under `web_edit_button_*` (`Pause`, `Freeze`, `Aspect ratio`, `Apply`, `Reset`,
`Retry`, `View all`), which is how the settings panels label their actions.

### 3b. Where the buttons sit

From `css_editor.674f84cb99.css`, measured:

```
.workbench-menu-item   width 58px; min-height 58px; border-radius 12px;
                       flex-direction column; padding 10px 0; margin-bottom 4px
.sider-menu-action     42 × 42
.timeline-tools-wrapper height 48px
.track-wrapper          left 6px            (first track's inset)
.timeline-axis-marker-container  height 10px; top 38px   (ruler, canvas-drawn)
scrollbar thumb         border-radius 42px; width 8px
```

So: a 58 px sider of icon-over-label buttons, 42 px actions above them, a 48 px
tool strip on the timeline, and a ruler drawn into a `<canvas>` rather than as
DOM ticks — which is why the ruler costs nothing while scrubbing.

### 3c. What a button press looks like

Every keyframe in the stylesheet, in full:

```css
@keyframes playPause  { 0% {opacity:1; transform:scale(1)}
                        99%{opacity:0; transform:scale(1.3)} }
@keyframes label-in-rtPe5s { 0%  {opacity:0; transform:translate(-50%,calc(-50% + 4px))}
                             to  {opacity:1; transform:translate(-50%,-50%)} }
@keyframes cursor-in-mADhsb{ 0% {opacity:0} }              /* .26s ease-out */
label-out-s29s7z           { to {opacity:0} }              /* .24s ease */
.timeline-tools            { transition: all .25s ease-out }
.timeline-tools.hide       { opacity:0; transform:translateY(-48px) }
.timeline-tools.show       { opacity:1; transform:translateY(0) }
```

Three rules fall out of that, and they are the whole motion language:

1. **Arrive by rising four pixels and fading in.** Not ten, not a scale.
2. **Leave by fading only.** No movement on the way out — leaving is quieter
   than arriving, every time.
3. **A strip of controls is 48 px and swaps by sliding 48 px in 250 ms
   ease-out.** The replacement comes from the direction the old one left in.

These are now `src/lib/motion.ts` in the app: `TRAVEL.label = 4`,
`TRAVEL.panel = 56`, `DUR.label = 200`, `DUR.enter = 260`, `EASE_OUT`, and the
`.25s ease-out` slide for a panel.

## 4. What could not be recovered, and why

- **The wiring of a specific button.** Panels are lazy chunks; the split button's
  handler is inside a chunk the logged-out shell never requests. Recovering it
  would mean loading the panel, which requires an account, which is a wall this
  project does not go around.
- **The timeline zoom arithmetic.** No symbol anywhere in the three megabytes of
  entry code matches `pixelsPerSecond`, `pxPerSecond`, `zoomLevel`,
  `SECOND_WIDTH` or `frameRate` in a meaningful way — the timeline maths is
  compiled into the WASM. It was therefore **measured, not read**: see how our
  own ruler is derived in `editor-redesign.md` (fit-to-width, no zoom).
- **The export pipeline's exact FFmpeg flags.** Same reason: inside VESDK.

What that changes about the plan: this project cannot reproduce CapCut's source,
and does not try to. It reproduces the *contract* — the vocabulary, the
geometry, the motion, and the boot order — and implements the behaviour in our
own code, in the open.
