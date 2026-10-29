# Why the APK is 90 MB

Measured from the build that is live right now, `Crushly-1.0.7-Android9plus.apk`
(94,990,451 bytes). Numbers are what actually arrives over the wire; every entry
inside the zip is compressed, so "download" is the honest number.

| What it is | Download | Share | Unpacked |
|---|---:|---:|---:|
| Java / JS engine code (`classes*.dex`) | 30.7 MB | 34% | 30.7 MB |
| Native libraries, 64-bit ARM | 30.2 MB | 33% | 30.2 MB |
| Native libraries, 32-bit ARM | 19.8 MB | 22% | 19.8 MB |
| Screens, images, XML (`res/`) | 3.9 MB | 4% | 7.2 MB |
| Your JavaScript (`index.android.bundle`) | 3.4 MB | 4% | 3.4 MB |
| Compiled resources (`resources.arsc`) | 1.8 MB | 2% | 1.8 MB |
| Everything else | 0.2 MB | 0% | 0.3 MB |
| **Total** | **90.1 MB** | | **93.6 MB** |

## The three things that make it large

**1. One file carries two CPUs — 50 MB of the 90.** The APK ships native
libraries for 64-bit and 32-bit ARM at the same time, because a single download
has to work on every Android 9+ phone. The 32-bit half alone is 19.8 MB, and
almost every phone sold since 2019 is 64-bit. This is not a bug in the build; it
is what a "universal" APK is. Play Store delivery splits it per device
automatically, which is why apps from the Play Store look smaller than the same
app downloaded from a website.

**2. The JavaScript engine and React Native are native code.** `libreactnative.so`
is 11.3 MB across both architectures and `libhermesvm.so` is 4.0 MB. That is the
runtime every React Native app carries; it does not shrink with the size of your
JavaScript.

**3. Voice and video calling brings WebRTC — 17.2 MB.** `libjingle_peerconnection_so.so`
is 10.86 MB (64-bit) plus 6.37 MB (32-bit). It is the single largest file in the
app and it exists because Calls are peer-to-peer audio/video. It is genuinely
used — `src/lib/call.ts` and the call manager in the chat screen depend on it —
so it cannot be removed without removing calling.

Your own code is the *smallest* part: the entire JavaScript bundle, the app's
screens and logic, is 3.4 MB — under 4%.

## What has already been cut

- **19 icon fonts → 1.** The app imports Ionicons everywhere, but the build was
  carrying every icon family Expo ships. Rewriting 46 imports to
  `@expo/vector-icons/Ionicons` took the font payload from 3.89 MB to 0.5 MB.
  That change is in 1.0.8 and is not in the numbers above.
- **3.1 MB of unused images.** Four PNGs (`logo-c-mark`, `logo-favicon`,
  `logo-wordmark`, `splash-icon`) that nothing referenced — the marks are drawn
  as SVG in `Logo.tsx`, and the splash uses `splash-mark.png`. Deleted.
- **One unused component.** `CircleStrip.tsx` had been unreferenced since the
  Your Circles strip left Flow. Deleted.

## What could be cut next, and what it would cost

| Change | Saves | Cost |
|---|---:|---|
| Ship only 64-bit ARM | ~10.9 MB | Breaks on 32-bit phones. Almost none are in use, but this is a product decision, not a build one. |
| Ship an AAB instead of a universal APK | ~19.8 MB per phone | Needs Play Store delivery; we hand a file to a browser. |
| Trim the 25 Google font weights down to the 7 actually used | 1.4 MB | Small; worth doing when someone is next in the theme files. |
| Remove calling (WebRTC) | 17.2 MB | Removes voice and video calls. |

The honest summary: 90 MB is normal for a React Native app that makes video
calls and hands out one file that must run on any phone. The things that could
halve it are the things that would break some phones or drop a feature.
