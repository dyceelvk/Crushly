# Screenshots and mockups — honest status

**Official credit: Odoh chiagoziem isreal.**

**This folder is empty of screenshots, and that is a fact about the work, not an
oversight.**

## What exists

There are **no device screenshots** in this library. Nothing in the 1.0.10 pass
was captured from a phone camera or an emulator screenshot. Verification of the
viewer, the icon and the update row was done by reading the code and by
inspecting the rasterised icon files — not by looking at a rendered screen.

## Why this matters

The icon claim is checked at the file level: `ic_launcher.webp` and
`ic_launcher_foreground.webp` were inspected at all five densities after an Expo
prebuild, and the art measures 62–63% of each tile. That proves the pixels are
the heart. It does **not** prove what a launcher mask does to them on a
particular phone.

Likewise the post viewer was verified by reading the screen tree — the composer
is mounted by the comments sheet, not by the viewer — rather than by tapping
through it.

## What would fill this folder

| Capture | Why it is worth having |
|---|---|
| Launcher tile on a real phone, circle and squircle masks | the only way to see what a launcher does to the safe circle |
| Themed (monochrome) icon on Android 13+ | confirms the monochrome layer is the heart, not a white blob |
| Post viewer, clip playing | the signed-off layout, as the member meets it |
| Post viewer → comments open → comments closed | the composer rule, in three frames |
| Settings → About Crushly | the credit line and the version row together |
| Settings → Check for updates after a tap | proof the control exists and re-fetches |

Until these exist, treat every visual claim in this library as **code-level
verified, device-level unverified**.

## What was verified instead, and how

| Claim | Method |
|---|---|
| Icon is the heart at every density | `npx expo prebuild --platform android` in a scratch copy; inspected the five `ic_launcher.webp` and five `ic_launcher_foreground.webp` files; measured the artwork's share of each tile |
| Monochrome layer is the heart | rendered `android-icon-monochrome.png`'s alpha channel as ASCII and read the silhouette |
| Favicon follows the icon | `assets/favicon.png` regenerated from the same source |
| Composer rule holds | read the viewer's component tree and the comments sheet |
| Update control works | read the handler: `qc.invalidateQueries({queryKey: keys.update})` then `update.refetch()` |
| Video upload end to end | HTTP against production: upload 201 → `create_post` 200 → `GET` 200 with the right content type |

## The gap that actually matters

Of everything above, the one that should be closed first is **a `.mov` recorded
on an iPhone or a Samsung, published and played back on that device.** That is
the exact thing the member was unable to do, and it is the only test that
answers their complaint directly.
