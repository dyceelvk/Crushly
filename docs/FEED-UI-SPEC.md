# Feed, search and suggestions — the UI measured from the reference

Reference: four screen captures from the Android app at 707×1536 (19.5:9, so a
412×895 dp phone), taken 2026-11-02 and stored in `docs/design/reference/`.
Everything below is measured off those images and re-expressed in Crushly's own
tokens (`CrushlyApp/src/theme/tokens.ts`). The rendered proof is
`docs/design/feed-search-proof.html` / `.png`.

The point of this document is that the proportions are not opinions: the rail is
58 dp wide because it is 88 px of 707, and the tab bar is 64 dp because it is
110 px of 1536 scaled to a 895 dp screen.

## 1. For You — the post screen

```
┌───────────────────────────────┐
│ status bar                    │ 44 dp
│ Circles  Vibes  Following [For You]      🔍 │ 46 dp, active tab underlined 2.5×22 dp
│                               │
│            media              │ fills the screen; the clip is fitted, not cropped
│                     ┌─────┐   │
│                     │ +avt│   │ right rail, 58 dp wide, 10 dp from the edge
│                     │  ♥  │   │   46 dp avatar with a 20 dp follow badge
│                     │39.4K│   │   34 dp glyph, 11.5 dp count, 3 dp gap
│                     │  💬 │   │
│                     │ 398 │   │
│                     │  🔖 │   │
│                     │4,442│   │
│                     │  ↗  │   │
│                     │5,074│   │
│                     │ ◉disc│  │   42 dp disc for the sound
│ ┌──────────────┐    └─────┘   │
│ │ C  In your Circle … │        │ 24 dp from the left, 12 dp radius, white fill, dark text
│ │ Author name          │       │ 15 dp bold
│ │ caption #hashtags    │       │ 13/18, max 3 lines, right edge stops at the rail
│ │ ♪ original sound — … │       │ 12.5 dp
├───────────────────────────────┤
│ 🔍 Search · <suggested query>   See more › │ 52 dp action bar
├───────────────────────────────┤
│ Home  Friends  ＋  Inbox  Profile │ 64 dp, badges on Friends and Inbox
└───────────────────────────────┘
```

Rules taken from the reference:

- **One post per screen**, snapping. The video is fitted inside the screen
  (`contain`), never cropped to fill: the reference shows a 16:9 clip letterboxed
  on a 19.5:9 phone.
- **Overlays never reflow the media.** The rail and the caption stack are
  absolutely positioned over the video; nothing pushes the video around.
- **Counts are abbreviated** — `39.4K`, not `39,412`; `4,442` stays exact below
  10K. Crushly already has `lib/counts.ts` for this; reuse it.
- **Only the bookmark changes colour when it is on** (the reference shows a
  filled yellow bookmark at 2,151 beside a white outline at 4,442).
- **The search hook is part of the feed**, not a separate screen: a keyword
  drawn from what is on screen, with "See more" opening the results.

### Crushly adaptation

| reference | Crushly |
|---|---|
| `CapCut · Try this template` brand chip | `In your Circle · <circle name>` when the post belongs to a Circle, absent otherwise. It is the same job — say where this post came from — using what Crushly actually has. |
| `STEM / Series / Following / For You` | `Circles / Vibes / Following / For You` (see question 1 below) |
| Friends tab (avatars of people you follow) | `Vibes` or `Friends` — Crushly's connection graph is `connections`, so "Friends" maps to people you are connected to, and the badge is unread from them |
| sound disc | the author's sound if the clip has one; otherwise the poster's avatar |

## 2. Search results

```
←  [🔍 Lil yacht walk out        ✕]  ⋯      field 42 dp, radius 21
Top   Videos   Users   Photos   Sounds      14 dp, active underlined
┌──────────┬──────────┐
│  tile    │  tile    │   2 columns, 2 dp gutter, tile 9:8 in this layout
├──────────┼──────────┤
│ caption  │ caption  │   12.5/16, clamped to 2 lines
│ ♥ 4M     │ ♡ 6.1K   │   byline 11.5 dp: avatar 18, name, verified, count
└──────────┴──────────┘
Others searched for
[ chip ]  [ chip ]          2 columns, 12 dp radius, 12 dp padding
```

- The query stays in the field; back arrow returns to the suggestion screen with
  the query still in it.
- Result **types are tabs**, not a filter sheet.
- Every tile carries author + count. A tile without a byline is a dead end.

### Crushly adaptation

Result types become `Top · People · Vibes · Circles · Posts`. "People" is the
friends/discovery deck Crushly already has; "Sounds" does not exist in Crushly
and inventing it would be a non-functional tab, so it is not in the list.

## 3. Search entry / suggestions

```
←  [🔍 Search Crushly  |]  Search        "Search" in the accent colour, not grey
♪  original sound — sativa_mysterio      a suggestion with a subtitle ("More sounds ⌄")
🕘  olamizzy insulting president     ✕   history, each row individually removable
🕘  Nigeria                           ✕
        See more ⌄
You may like                    ⟳  ⋮      heading in the display face, refresh on the right
• Tobi        · Afrobeats, Yaba          accent bullet + accent name + muted context
```

- A **first suggestion of a different kind** at the top (in the reference it is a
  sound, because you can search by sound) before the history list.
- History rows are individually deletable, which implies a store — Crushly has
  none yet, so this needs a small `search_history` table or a local store.
- "You may like" is server-suggested and refreshable.

### Crushly adaptation

The top suggestion is **a person you have interacted with recently** ("Continue
with Marcus"), because Crushly's search is people-first. "You may like" rows are
people and Circles.

## 4. What implementing this touches

| piece | file | status |
|---|---|---|
| full-screen feed with snapping | new `src/screens/flow/FeedScreen.tsx` + `components/feed/*` | not started |
| action rail | `components/feed/FeedRail.tsx` | not started |
| caption stack + Circle chip | `components/feed/FeedCaption.tsx` | not started |
| text tabs | `components/feed/FeedTabs.tsx` | not started |
| search results grid | `screens/discover/Search.tsx` | exists, is a list — needs the grid + type tabs |
| suggestions + history | `screens/discover/Search.tsx` | exists without history; needs a store |
| ranked feed behind it | `flow_ranked_feed` | **done** (branch `feat/ranked-flow`) |
| dwell measurement | `lib/dwell.ts` | **done** |

The feed needs `flow_ranked_feed` on the live database before an APK can use it —
see the ordering note in the session status.

## 5. Three questions before the port

1. **Which four tabs?** Reference order is context-specific (`STEM`, `Series`,
   `Following`, `For You`). The proposal is `Circles · Vibes · Following · For You`
   with For You rightmost and active. Any Crushly surface missing means a tab that
   does nothing, which is worse than three tabs.
2. **Does the Friends tab exist in Crushly?** The reference's second tab is people
   you follow, with an unread badge. Crushly has connections — should that tab
   list connected people's posts (a second ranked feed over a fixed author set) or
   be the Vibes feed?
3. **Search history**: server-side (survives a reinstall, needs a table) or
   device-side (instant, private, lost on reinstall)? The reference behaves
   server-side.
