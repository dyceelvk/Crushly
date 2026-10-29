# Crushly — Android icon and release engineering

**Owner and official credit: Odoh chiagoziem isreal.**
State at 1.0.10 (versionCode 10).

---

## 1. The launcher icon

**The icon must be the official Crushly heart that is already in the project.**
Not the C monogram, not a new design, not a redrawn heart. This is a hard
constraint and it was already violated once.

### What was wrong

| Asset | Was | Why it mattered |
|---|---|---|
| `assets/icon.png` | the C monogram from a later rebrand | this single file feeds the **legacy `ic_launcher`** on every launcher older than Android 8 **and** the web favicon |
| `assets/android-icon-foreground.png` | the correct heart, but at ~40% of the tile | the adaptive icon existed, so Android 8+ showed a heart in a very large empty tile |
| `assets/favicon.png` | derived from the C | the browser tab carried the wrong mark |
| `assets/android-icon-background.png` | not the brand background | the tile colour drifted from `#070708` |

So the C was not a stray file — it was the file that most devices actually
render.

### How the heart was extracted — and the one dead end

The heart exists at full quality in two places in history:

- `/tmp/orig/icon.png` — 1024³ **RGB**, from commit `c042b0f`
- `/tmp/orig/android-icon-foreground.png` — 1024³ **RGBA**, same commit

The **RGBA foreground is the source** because it carries the intended cutout
alpha channel directly. Thresholding the RGB `icon.png` to manufacture an alpha
was attempted first and **produced a grey glow halo** around the heart — the
already-composited file has a soft glow baked into the pixels, so any threshold
picks the glow up as artwork. That approach was abandoned; do not retry it.

### What was rebuilt

All four assets are now the official heart, drawn at **62% of the canvas** on
`#070708`. 62% is the point where the mark fills a launcher tile without
touching the safe circle that every launcher mask (circle, squircle, rounded
square) keeps visible.

| Asset | Size | Role |
|---|---|---|
| `assets/icon.png` | 1024² | legacy launcher icon + all `ic_launcher.webp` densities |
| `assets/android-icon-foreground.png` | 1024² RGBA | adaptive foreground, all densities |
| `assets/android-icon-background.png` | 1024² | adaptive background |
| `assets/android-icon-monochrome.png` | 1024² RGBA | themed icons (Android 13+) — verified to be the heart silhouette, not the C |
| `assets/favicon.png` | 48² | web favicon |

### Verification

`npx expo prebuild --platform android` was run in a scratch copy and the output
inspected, not assumed:

```
mipmap-mdpi     ic_launcher.webp  48   ic_launcher_foreground.webp 108
mipmap-hdpi     ic_launcher.webp  72   ic_launcher_foreground.webp 162
mipmap-xhdpi    ic_launcher.webp  96   ic_launcher_foreground.webp 216
mipmap-xxhdpi   ic_launcher.webp 144   ic_launcher_foreground.webp 324
mipmap-xxxhdpi  ic_launcher.webp 192   ic_launcher_foreground.webp 432
```

The artwork measures 62–63% of each tile once rasterised, which confirms the
padding survived the density conversion. Emitted per density: `ic_launcher`,
`ic_launcher_round`, `ic_launcher_foreground`, `ic_launcher_background`,
`ic_launcher_monochrome`, plus `mipmap-anydpi-v26/ic_launcher.xml` and
`ic_launcher_round.xml`.

`app.json` carries the adaptive block explicitly — `backgroundColor`,
`foregroundImage`, `backgroundImage`, `monochromeImage` — so EAS and CI cannot
silently fall back to Expo's default mark.

### What was deliberately not touched

- `applicationId` stays `app.crushly`. Changing it would make 1.0.10 install as a
  **separate app** and leave the member's existing install behind.
- The signing key is unchanged, so 1.0.10 upgrades 1.0.9 in place.
- No new logo was drawn. The heart is the one from `c042b0f`.
- `primaryColor` in `app.json` is still `#00C6FF` (the older cyan). It is not
  the launcher icon and it was left alone in 1.0.10 to keep the change set
  honest — see §4.

## 2. Version and update plumbing

| Where | Field | 1.0.10 |
|---|---|---|
| `app.json` | `expo.version` | `1.0.10` |
| `app.json` | `android.versionCode` | `10` |
| `app.json` | `ios.buildNumber` | `10` |
| `public/download/index.html` | APK filename | `Crushly-1.0.10-Android9plus.apk` |

`scripts/check-download-page.mjs` asserts the download page and `app.json`
agree; it passed.

The **update announcer** now has a real control. It reads the published
`versionCode` out of the APK rather than inferring it from the version string,
and Settings carries:

- a **Check for updates** button that invalidates the update query and re-fetches;
- an App version row that shows the installed build and, when an update is
  offered, `1.0.9 → 1.0.10`;
- the build number in the footer.

Before this, the row made one attempt at mount, cached for six hours, and could
not be retried — so a member who already had the newest build saw "You're up to
date" with nothing to press.

## 3. Building and installing the test APK

The APK is built by `.github/workflows/build-android.yml`, which on success:

1. compiles a standalone release APK,
2. verifies install compatibility,
3. builds an Android 9 emulator image and does a cold start + relaunch,
4. audits the packaged APK for known server secrets,
5. publishes the asset to a GitHub Release,
6. tells the media Worker which build is current,
7. commits the release facts (`release.json`).

**Installing it on a phone**

1. Open the download page: `https://mecrushly.vercel.app/download`
2. Tap the APK link. It is ~90 MB; download over Wi-Fi.
3. Android will warn about installing from an unknown source. Allow it for the
   browser or file manager you used — this is expected for a build distributed
   outside Play.
4. Open the APK and install. Because the signing key and `applicationId` are
   unchanged, it **updates an existing 1.0.9 install in place**; accounts,
   sessions and cached data survive. If Android refuses with
   `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, the installed copy was signed with a
   different key — uninstall it first, which does lose the local session, and
   sign in again.
5. After install, open **Settings → About Crushly** and confirm the version row
   reads 1.0.10, and that **Credits** names Odoh chiagoziem isreal.

**Do not** sideload over a different `applicationId`; check
`Settings → App info` shows `app.crushly`.

## 4. Known deviations, recorded rather than hidden

- `primaryColor` is `#00C6FF` while the brand accent is pink/magenta. It is not
  used by the launcher tile and was left untouched in this release.
- The APK is ~90 MB. See `APK-SIZE.md` for the measured breakdown — two CPU
  architectures and both dex files dominate. Splitting per-ABI would roughly
  halve the download and is the obvious next size win.
- Build status for 1.0.10 was still running at the time this document was
  written. `PROJECT_CONTINUITY.md` records the outcome; do not assume success
  from a green local build.
