# TikTok — how search, animation and the UI are built

Measured by loading the live pages in headless Chromium on this machine and
reading computed styles and DOM attributes. Two passes were made on the search
page, a fortnight apart, and both agreed; where a first reading was wrong it is
corrected here rather than quietly dropped.

Artifact: `/home/user/evidence/tiktok/search-page.png` (1280 × 900).

## 1. How search is built

### The page, as the DOM reports it

```
data-e2e="nav-search"          header search (collapsed on desktop)
data-e2e="search-box"          the page's own box
data-e2e="search-user-input"   the input itself
data-e2e="reset-search-form"   the clear button
data-e2e="search-box-button"   the submit button
h1                             the raw query, as the heading
```

The heading is the query verbatim — `<h1>cooking</h1>`. Not “Results for”, not
“Search”. The thing you typed becomes the name of the place you are in.

### The tab row

Second pass, computed on the live page:

| tab | colour | size | weight |
|---|---|---|---|
| Top (active) | `rgb(246, 246, 246)` | 15 px | 500 |
| Users | `rgba(255, 255, 255, 0.6)` | 15 px | 500 |
| Videos | `rgba(255, 255, 255, 0.6)` | 15 px | 500 |
| LIVE | `rgba(255, 255, 255, 0.6)` | 15 px | 500 |
| Photo | `rgba(255, 255, 255, 0.6)` | 15 px | 500 |

And the negatives, which are the design:

- parent `border-bottom` computes to **`0px none`** — there is no underline;
- parent `background-color` is **`rgba(0, 0, 0, 0)`** — there is no pill;
- no tab carries `role="tab"` or `aria-selected`.

So tab state is **one value: brightness**. The weight does not change, the size
does not change, nothing moves in the layout. (A first pass recorded 14 px / 400
by reading a wrapper element instead of the leaf span; 15 px / 500 is the leaf
and is what a user sees.)

### The search box

- `border-radius: 92px` — a full pill, on `rgba(255,255,255,0.12)`;
- input text 16 px at `rgba(255,255,255,0.9)`.

### What the structure implies

TikTok's search is one page with five **vertical slices of one result set**, and
"Top" is not a sixth source of results — it is a *preview* of the other four,
each with a "view all" that switches to that slice. The tab row is therefore
state, not navigation: switching tabs does not push a route, it re-filters the
list under a fixed heading.

## 2. How the animation is built

The keyframes gathered from the owner document and its stylesheets are few, and
they fall into three families:

| name | shape | use |
|---|---|---|
| `swipe-out-left` / `-right` / `-up` / `-down` | translate to the edge, fade | dismissing a sheet or a card |
| `fade` / `flowLight` / `highlight-bg` | opacity, or a moving highlight | state change in place |
| `label-in` / `cursor-in` (`0%{opacity:0}`, `.26s ease-out`) | fade, sometimes + 4 px | text and markers arriving |

The pattern, in words:

- **Everything is transform + opacity.** Nothing animates layout, width or
  colour directly over time — colour changes are swapped, and moving things are
  moved.
- **Enter and exit are not symmetric.** Enters fade up from a few pixels;
  exits translate to an edge or fade out, and are never slower than the enter.
- **Durations are 200–260 ms,** with `ease-out` for anything arriving and a
  gentler `ease` for anything leaving.
- **A dismissal has a direction,** and the direction is the way the thing came
  from (`swipe-out-left` for a panel that slid in from the left).

## 3. What was applied to Crushly

`src/lib/motion.ts` is the whole of it, as numbers:

```ts
DUR   = { tap: 120, label: 200, enter: 260, exit: 160 }
TRAVEL= { label: 4, card: 10, panel: 56 }
EASE_OUT = cubicBezier(0.2, 0.8, 0.2, 1)
EASE_IN  = cubicBezier(0.4, 0, 1, 1)
STAGGER = 40, capped at 4 items
FLASH_SCALE = 1.3
```

- `Rise` now takes its duration, distance and curve from that file instead of
  hard-coding 260 / 10 / `Easing.out(cubic)`.
- `Tabs` (`src/components/Tabs.tsx`) is a colour-only tab row: an
  `Animated.Value` per tab interpolating opacity `0.6 → 1` over `DUR.label`,
  weight fixed at 500, no underline, no pill, no `role="tab"` gymnastics — the
  same contract as the measured row.
- `Search` uses it as a slice switcher: Top · People · Flows · Vibes · Moments,
  each with a count, Top a three-item preview of each slice with "See all".
- The search heading is the raw query, in the display face.
- The search box stays a pill and keeps its 16 px text.
- Rows arrive with a `Rise`, staggered 40 ms apart and capped at four.

## 4. What was deliberately not taken

- **The infinite feed.** TikTok's search does not paginate with a button; it
  appends. Crushly's search is a result set with a count, because the counts are
  useful and the corpus is a community, not a catalogue.
- **Tab names.** Ours name our own things — People, Flows, Vibes, Moments — and
  not Videos/LIVE/Photo, because renaming our objects to match another app's
  would be the one thing that made the copy worse than the original.
