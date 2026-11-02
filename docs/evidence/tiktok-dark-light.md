# TikTok dark/light mode and Crushly's theme/fade fix

**Measured:** 2 November 2026, TikTok desktop search page at `https://www.tiktok.com/search?q=cooking`, Chromium 131. The live page exposed `data-theme="dark"` and `data-tux-color-scheme="dark"` on `<html>`. Emulating `prefers-color-scheme: light` alone did **not** switch the chosen app theme; the page retained its explicit dark attributes. The browser probe is `/home/user/themeprobe.mjs`, and the recorded run is `/home/user/evidence/tiktok/theme.json`.

## What the frontend actually does

TikTok's downloaded TUX stylesheet (`/home/user/evidence/tiktok/css/all.7d7ee710.css`, linked from the measured page) has separate root token sets scoped to `[data-tux-color-scheme=light]` and `[data-tux-color-scheme=dark]`. Each scheme defines 527 tokens. The page and surfaces do not independently guess their background at animation time: components refer to the selected theme tokens.

| TUX token | Light | Dark |
|---|---|---|
| `--tux-v2-color-ui-page-flat-1` | `#fff` | `#000` |
| `--tux-v2-color-ui-page-flat-2` | `#f8f8f8` | `#1e1e1e` |
| `--tux-v2-color-ui-page-grouped-1` | `#f5f5f5` | `#000` |
| `--tux-v2-color-ui-page-grouped-2` | `#fff` | `#1e1e1e` |
| `--tux-v2-color-ui-text-1` | `#000` | `#f6f6f6` |
| `--tux-v2-color-ui-text-2` | `rgba(0,0,0,.65)` | `hsla(0,0%,100%,.88)` |
| `--tux-v2-color-ui-sheet-grouped-1` | `#f5f5f5` | `#1e1e1e` |
| `--tux-v2-color-ui-sheet-grouped-2` | `#fff` | `#2c2c2c` |

The live page body measured `rgb(0, 0, 0)` in its selected dark scheme. Forcing just the document attributes was not a valid full-app theme switch: it changed the body to white but left its inherited text white, because the page's own state had not changed. This is a useful warning: **never test theme switching by changing only the OS preference or root attribute**. Check the app state, full token scope, page canvas and text together.

## What is fixed in Crushly

- The base canvas is now truly `#000` in dark and `#fff` in light; neutral surfaces follow a small layered scale. Brand accents are unchanged.
- Appearance settings now describe the modes accurately (black canvas / white canvas) rather than advertising the old navy / warm ivory.
- On web, the actual `html` and `body` canvas, text foreground, `color-scheme`, and browser `theme-color` follow the active palette. This closes the white browser-page flash behind a transparent navigation transition or modal fade.
- The app shell itself has an opaque theme-colored root under navigation. Screen transitions therefore reveal the previous/current app canvas, never the browser's unthemed white default.
- Theme-locked white text/controls and dark-only track colors were removed from light surfaces in the video editor, trim screen, timeline, post preview and editor tools. The actual video viewport and media-overlay controls stay black/white by design. Embedded-page loading/fallback canvases also follow the active scheme.
- The selected appearance is hydrated before the first app screen is shown. Previously async storage could show a dark frame first for someone who had chosen light.
- Existing fades remain fades; they no longer cross an unthemed page. This matches TikTok's architecture: scheme state selects the tokens, while animation only moves/fades the content.

Verification: `npx tsc --noEmit` clean; full pure-library suite **277/277**; app `npm test` **166/166** plus **7/7** Didit tests; Expo production web export succeeds; harness export succeeds; dark and light Flow screenshots were visually checked. Palette tests assert true black/white canvases, neutral layers, and unchanged brand colors.
