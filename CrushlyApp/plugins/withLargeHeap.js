const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

/**
 * Give the app the large heap, because posting a video needs it.
 *
 * The crash this addresses is on the phone and it names its own cause:
 *
 *   java.lang.OutOfMemoryError: Failed to allocate a 64 byte allocation with
 *   119200 free bytes and 116KB until OOM, target footprint 268435456 …
 *   at androidx.media3.exoplayer.ExoPlayerImplInternal.shouldContinueLoading
 *
 * `268435456` is 256 MB: the process hit the Java heap cap while Media3 was
 * buffering a video, and Android killed the app. Nothing is leaking — a phone
 * video plus the encoder's working set genuinely needs more than 256 MB of heap
 * on the devices this was reported from.
 *
 * `android:largeHeap="true"` raises that cap (typically to 512 MB). It is not a
 * blank cheque: the kernel still refuses to hand out memory the device does not
 * have, and the compressor now reports a real out-of-memory error instead of
 * dying, so a phone that truly cannot cope says so. It is, however, the difference
 * between "posting a two-minute clip works" and "the app closes at 0%".
 */
module.exports = function withLargeHeap(config) {
  return withAndroidManifest(config, (c) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(c.modResults);
    app.$['android:largeHeap'] = 'true';
    return c;
  });
};
