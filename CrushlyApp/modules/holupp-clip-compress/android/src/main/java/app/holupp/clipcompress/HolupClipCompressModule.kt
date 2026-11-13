package app.holupp.clipcompress

import android.media.MediaMetadataRetriever
import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.Effect
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.Presentation
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EncoderSelector
import androidx.media3.transformer.EncoderUtil
import androidx.media3.transformer.Effects
import com.google.common.collect.ImmutableList
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.VideoEncoderSettings
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Transformer
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Making a big clip small enough to post, at a quality a person would accept.
 *
 * The previous encoder (ffmpeg-kit, "auto" mode) chose its own bitrate and
 * resolution, and chose them badly: a 1080p clip came out looking worse than a
 * 480p one because the encoder starved at a bitrate it picked itself. Members
 * described the result as a video from the 1780s. This module replaces it with
 * Media3 Transformer and sets both numbers explicitly:
 *
 *   - Resolution: the source's own, capped at 1080 on the longest edge. A 4K
 *     clip is scaled to 1080p; a 720p clip is never upscaled.
 *   - Bitrate: derived from the size budget the app asks for, but clamped to a
 *     floor of 2.5 Mbit/s and a ceiling of 10 Mbit/s. A 60-second clip against
 *     the 96 MB budget asks for about 11.7 Mbit/s and is safely capped at 10,
 *     which keeps a 1080p picture clean without targeting an arbitrary tiny file.
 *     The floor is the important half: below 2.5 Mbit/s a 1080p picture falls
 *     apart, so a long clip gets a slightly larger file rather than a muddy one.
 *   - Frame rate: the source's original rate. Transformer preserves it rather
 *     than upsampling a 24 fps clip or needlessly dropping frames from a 60 fps one.
 *   - Codec selection: try Android's software AVC encoder first when available,
 *     while retaining hardware codecs as fallback. This avoids vendor hardware
 *     encoder failures across brands without special-casing any phone; an
 *     unsupported software format can still be handled by the device encoder.
 *
 * It also refuses to start when the phone has no room for the output. The old
 * encoder failed deep inside ffmpeg with "we couldn't read that file", which
 * told the member nothing. E_NO_SPACE says the true thing, in words.
 */
@OptIn(UnstableApi::class)
class HolupClipCompressModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HolupClipCompress")
    Events("onProgress")

    /**
     * Compress one clip.
     *
     * @param inputPath   absolute path (no scheme) to the clip already on disk
     * @param outputPath  where the compressed file should be written; must not exist
     * @param targetBytes the size budget in bytes; the bitrate is derived from it
     *
     * Resolves with a map: `{ path, bytes, ms }`; progress is emitted as `onProgress` events. Rejects with `code`:
     *   E_NO_ENCODER  the device has no H.264 encoder this pipeline can use
     *   E_NO_SPACE    the phone cannot hold the output next to the input
     *   E_FAILED      the transcode failed; `message` says why, in words a member can read
     *   E_INPUT       the input file is missing or unreadable
     */
    AsyncFunction("compress") { inputPath: String, outputPath: String, targetBytes: Long ->
      val context = appContext.reactContext
        ?: throw CodedException("E_FAILED", "The app is not ready yet. Try again.", null)

      val input = File(inputPath)
      if (!input.isFile || !input.canRead()) {
        throw CodedException("E_INPUT", "That clip is no longer on this phone.", null)
      }

      // The output is written beside the input, so the phone must hold both at
      // once, plus working room. Checking here turns a cryptic encoder failure
      // into the one sentence that is actually true.
      val needed = input.length() + targetBytes.coerceAtLeast(0L) + HEADROOM_BYTES
      val usable = context.cacheDir?.usableSpace ?: Long.MAX_VALUE
      if (usable < needed) {
        throw CodedException(
          "E_NO_SPACE",
          "Your phone is out of storage space. Free some up, then try again.",
          null,
        )
      }

      val output = File(outputPath)
      output.parentFile?.mkdirs()
      if (output.exists()) output.delete()

      val meta = readMeta(input)
      val durationSec = meta.durationMs / 1000.0
      if (durationSec <= 0.0) {
        throw CodedException("E_INPUT", "That clip could not be read. Try a different one.", null)
      }

      val bitrateBps = bitrateFor(targetBytes, durationSec)
      val (width, height) = targetResolution(meta.width, meta.height)

      val started = System.currentTimeMillis()

      val videoSettings = VideoEncoderSettings.Builder()
        .setBitrate(bitrateBps)
        .build()
      val encoderFactory = DefaultEncoderFactory.Builder(context)
        .setVideoEncoderSelector(softwareFirstEncoderSelector)
        .setEnableFallback(true)
        .setRequestedVideoEncoderSettings(videoSettings)
        .build()

      val resize: Effect = Presentation.createForWidthAndHeight(
        width,
        height,
        Presentation.LAYOUT_SCALE_TO_FIT,
      )
      val edited = EditedMediaItem.Builder(MediaItem.fromUri(Uri.fromFile(input)))
        .setEffects(Effects(emptyList(), listOf(resize)))
        .build()

      val latch = CountDownLatch(1)
      var failure: Exception? = null

      val transformer = Transformer.Builder(context)
        .setVideoMimeType(MimeTypes.VIDEO_H264)
        .setAudioMimeType(MimeTypes.AUDIO_AAC)
        .setEncoderFactory(encoderFactory)
        .addListener(object : Transformer.Listener {
          override fun onCompleted(composition: Composition, exportResult: androidx.media3.transformer.ExportResult) {
            latch.countDown()
          }

          override fun onError(
            composition: Composition,
            exportResult: androidx.media3.transformer.ExportResult,
            exportException: androidx.media3.transformer.ExportException
          ) {
            failure = exportException
            latch.countDown()
          }
        })
        .build()

      val composition = Composition.Builder(EditedMediaItemSequence(listOf(edited))).build()

      // Progress is polled rather than listened to: getProgress() is the one
      // progress API this version of Transformer guarantees, and a poll every
      // 200 ms is far more often than a progress bar can show.
      val poller = Thread {
        while (latch.count > 0) {
          try {
            val holder = ProgressHolder()
            val state = transformer.getProgress(holder)
            if (state == Transformer.PROGRESS_STATE_AVAILABLE) sendEvent("onProgress", mapOf("progress" to min(0.99, holder.progress / 100.0)))
          } catch (_: Exception) {
            // A progress read must never fail the job.
          }
          try {
            Thread.sleep(200)
          } catch (_: InterruptedException) {
            break
          }
        }
      }
      poller.isDaemon = true
      poller.start()

      // Blocks only this module's own worker, never the JS thread or the UI.
      // `start()` can itself reject a codec or GL configuration on some Android
      // builds, before Transformer's listener has a chance to report an error.
      // Turn that into a normal failed compression so the upload path can keep
      // the original instead of leaving a spinner or taking down the app.
      val finished = try {
        transformer.start(composition, output.absolutePath)
        latch.await(10, TimeUnit.MINUTES)
      } catch (error: InterruptedException) {
        runCatching { transformer.cancel() }
        Thread.currentThread().interrupt()
        output.delete()
        throw CodedException("E_FAILED", "Compressing that clip was interrupted. Try again.", error)
      } catch (error: Exception) {
        runCatching { transformer.cancel() }
        output.delete()
        throw CodedException("E_FAILED", "This phone couldn't compress that clip. The original is still safe.", error)
      } finally {
        poller.interrupt()
      }

      if (!finished) {
        runCatching { transformer.cancel() }
        output.delete()
        throw CodedException("E_FAILED", "Compressing that clip took too long. Try a shorter one.", null)
      }
      failure?.let { error ->
        output.delete()
        throw CodedException("E_FAILED", "This phone couldn't compress that clip. The original is still safe.", error)
      }
      if (!output.isFile || output.length() == 0L) {
        throw CodedException("E_FAILED", "The compressed clip came out empty.", null)
      }

      mapOf(
        "path" to output.absolutePath,
        "bytes" to output.length(),
        "ms" to (System.currentTimeMillis() - started)
      )
    }

    /** True when this device can compress, so the app can skip the attempt entirely. */
    Function("available") {
      android.media.MediaCodecList(android.media.MediaCodecList.REGULAR_CODECS).codecInfos.any { info ->
        info.isEncoder && info.supportedTypes.any { it.equals("video/avc", ignoreCase = true) || it.contains("avc", ignoreCase = true) }
      }
    }
  }

  private data class Meta(val durationMs: Long, val width: Int, val height: Int)

  private fun readMeta(file: File): Meta {
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(file.absolutePath)
      val durationMs = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
      val width = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
      val height = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
      // Rotation is reported as metadata, not baked into the dimensions: a
      // portrait clip stored sideways would come out landscape if the rotation
      // were ignored. Swap when the rotation says so.
      val rotation = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
      return if (rotation == 90 || rotation == 270) Meta(durationMs, height, width) else Meta(durationMs, width, height)
    } finally {
      try {
        retriever.release()
      } catch (_: Exception) {
        // Nothing to release twice.
      }
    }
  }

  /**
   * The bitrate the picture can have, from the size budget.
   *
   * Audio is a fixed, small cost; everything left is spread over the clip's
   * length. The floor is 2.5 Mbit/s because below that a 1080p picture falls
   * apart, and the ceiling is 10 Mbit/s because above that we are not saving
   * anybody anything.
   */
  private fun bitrateFor(targetBytes: Long, durationSec: Double): Int {
    val totalBps = (targetBytes * SIZE_SAFETY * 8 / durationSec).toLong()
    val videoBps = totalBps - AUDIO_BPS
    return min(MAX_BPS, max(MIN_BPS, videoBps)).toInt()
  }

  /**
   * The resolution to encode at: the source's own, capped at 1080 on the
   * longest edge, always even (H.264 wants even dimensions).
   */
  private fun targetResolution(sourceW: Int, sourceH: Int): Pair<Int, Int> {
    val w = if (sourceW > 0) sourceW else MAX_EDGE
    val h = if (sourceH > 0) sourceH else MAX_EDGE
    val longest = max(w, h)
    val scale = if (longest > MAX_EDGE) MAX_EDGE.toDouble() / longest else 1.0
    return even((w * scale).roundToInt()) to even((h * scale).roundToInt())
  }

  private fun even(n: Int): Int = max(2, (n / 2) * 2)

  private companion object {
    /**
     * Prefer Android's platform software AVC implementation when it supports
     * this format. Hardware encoders remain in the list as compatibility
     * fallbacks for devices with no usable software encoder or formats the
     * software codec cannot handle. Ordering is intentional: equal-capability
     * codecs are tried in selector order by Media3.
     */
    val softwareFirstEncoderSelector: EncoderSelector = EncoderSelector { mimeType ->
      val supported = EncoderUtil.getSupportedEncoders(mimeType)
      val software = supported.filterNot { EncoderUtil.isHardwareAccelerated(it, mimeType) }
      if (software.isEmpty()) {
        supported
      } else {
        val hardware = supported.filter { EncoderUtil.isHardwareAccelerated(it, mimeType) }
        ImmutableList.copyOf(software + hardware)
      }
    }

    const val MAX_EDGE = 1080
    const val MIN_BPS = 2_500_000L
    const val MAX_BPS = 10_000_000L
    const val AUDIO_BPS = 128_000L
    const val SIZE_SAFETY = 0.92
    /** Room for the output plus the encoder's working files. */
    const val HEADROOM_BYTES = 32L * 1024L * 1024L
  }
}
