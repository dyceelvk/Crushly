package app.holupp.clipmark

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.net.Uri
import android.os.Handler
import android.os.HandlerThread
import androidx.media3.common.Effect
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.effect.BitmapOverlay
import androidx.media3.effect.OverlayEffect
import androidx.media3.effect.StaticOverlaySettings
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.Effects
import androidx.media3.transformer.Transformer
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * The mark, burnt into the clip on the phone, before it is uploaded.
 *
 * Why this exists at all. The mark used to be produced only by a scheduled job
 * (`scripts/mark_pending_clips.py`), because marking is a transcode and a
 * transcode on the upload path makes the poster wait. The consequence nobody
 * wrote down: `downloadUrl` — and therefore the whole Save row — only exists
 * once that job has run. Post a clip at 11:02 and the button appears at ~11:05,
 * or not at all if the runner is blocked. Four separate reports of "the button
 * never happens on posting" are that timer.
 *
 * Doing it here instead puts the button in the post itself: the file is already
 * being re-encoded for size (`videoEncode`), so the mark rides along and the
 * upload carries both variants.
 *
 * What this deliberately does NOT do is decide whether to mark. That is
 * `src/lib/clipMarkPlan.ts`, where it is testable without a phone. This file
 * draws what it is told to draw.
 */
class HolupClipMarkModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HolupClipMark")

    /**
     * Mark one clip.
     *
     * @param inputPath   absolute path (no scheme) to the clip already on disk
     * @param outputPath  where the marked file should be written; must not exist
     * @param handle      the creator's handle without the leading @; may be blank
     * @param endCardPath optional absolute path to a short silent end card to append
     *
     * Resolves with a map: `{ path, bytes, ms }`. Rejects with `code`:
     *   E_NO_ENCODER  the device has no H.264 encoder this pipeline can use
     *   E_FAILED      the transcode failed; `message` says why, in words a member can read
     *   E_INPUT       the input file is missing or unreadable
     */
    AsyncFunction("mark") { inputPath: String, outputPath: String, handle: String, endCardPath: String? ->
      val context = appContext.reactContext
        ?: throw CodedException("E_FAILED", "The app is not ready yet. Try again.", null)

      val input = File(inputPath)
      if (!input.isFile || !input.canRead()) {
        throw CodedException("E_INPUT", "That clip is no longer on this phone.", null)
      }
      val output = File(outputPath)
      output.parentFile?.mkdirs()
      if (output.exists()) output.delete()

      val started = System.currentTimeMillis()

      // The mark itself: a small dark chip with the handle, bottom-right, drawn
      // once into a bitmap. A bitmap overlay is one composite per frame, where
      // drawing text per frame would be text layout on every frame of a
      // 60-second clip.
      val effects: List<Effect> = buildList {
        val chip = markBitmap(handle)
        if (chip != null) {
          // OverlayEffect takes only the overlay: where it sits is a property of
          // the overlay, not of the effect. (The two-argument form is 1.6+; this
          // build pins 1.5.1, and the compiler is the authority on that.)
          val settings = StaticOverlaySettings.Builder()
            // Anchors are 0..1 across the frame: 0.94 is just inside the
            // bottom-right corner, with the 6% of slack the chip's own padding
            // gives it.
            .setBackgroundFrameAnchor(0.94f, 0.94f)
            .build()
          add(OverlayEffect(listOf(BitmapOverlay.createStaticBitmapOverlay(chip, settings))))
        }
      }

      val items = mutableListOf<EditedMediaItem>(
        EditedMediaItem.Builder(MediaItem.fromUri(Uri.fromFile(input)))
          .setEffects(Effects(listOf(), effects))
          .build()
      )

      // The end card is a separate item in one Composition, so it is joined by
      // the player's own timeline rather than by a second pass over the file.
      val endCard = endCardPath?.let { File(it) }
      if (endCard != null && endCard.isFile && endCard.canRead()) {
        items.add(EditedMediaItem.Builder(MediaItem.fromUri(Uri.fromFile(endCard))).build())
      }

      /*
       * Media3 requires a Transformer to be touched from one thread that owns a
       * Looper, and `start()` throws from any other. This module used to build
       * the Transformer and call `start()` on whatever thread Expo handed the
       * async function to — a thread with no Looper, so the Transformer silently
       * borrowed the main thread's and every call after that was a coin toss.
       * The failure was not a clean error either: a mark runs right after the
       * upload's own transcode, and on a phone the second GL surface and second
       * encoder arriving while the first was still winding down is what the
       * process died of.
       *
       * So the export gets a thread of its own, the caller waits, and only one
       * transcode runs in the app at a time (see `MARKING`).
       */
      if (!MARKING.compareAndSet(false, true)) {
        throw CodedException(
          "E_BUSY",
          "Another clip is still being prepared. Please let that one finish.",
          null,
        )
      }

      val worker = HandlerThread("holupp-clip-mark")
      worker.start()
      val handler = Handler(worker.looper)
      val latch = CountDownLatch(1)
      var failure: Exception? = null
      val transformerRef = AtomicReference<Transformer?>(null)

      // A Composition holds *sequences*, not items: the items are one after the
      // other in a single sequence, which is what makes the end card follow the
      // clip instead of playing over it.
      val composition = Composition.Builder(EditedMediaItemSequence.Builder(items).build()).build()

      val finished = try {
        handler.post {
          val transformer = Transformer.Builder(context)
            .setLooper(worker.looper)
            .setVideoMimeType(MimeTypes.VIDEO_H264)
            .setAudioMimeType(MimeTypes.AUDIO_AAC)
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
          transformerRef.set(transformer)
          try {
            transformer.start(composition, output.absolutePath)
          } catch (error: Exception) {
            // `start()` can reject a codec or a GL configuration before the
            // listener ever hears about it. Turn it into an ordinary failure so
            // the post keeps going unmarked.
            failure = error
            latch.countDown()
          }
        }
        latch.await(MAX_MARK_MINUTES, TimeUnit.MINUTES)
      } finally {
        handler.post { runCatching { transformerRef.get()?.cancel() } }
        worker.quitSafely()
        MARKING.set(false)
      }

      if (!finished) {
        throw CodedException("E_FAILED", "Marking that clip took too long. It was uploaded whole instead.", null)
      }
      failure?.let { error ->
        // One code, not a taxonomy: the app reacts identically to every failure
        // (upload the original, let the job mark it later), and `available()`
        // has already ruled out a phone with no encoder. A second code here would
        // be a distinction nothing acts on.
        throw CodedException("E_FAILED", "This phone couldn’t mark that clip. It was uploaded whole instead.", error)
      }
      if (!output.isFile || output.length() == 0L) {
        throw CodedException("E_FAILED", "The marked clip came out empty. It was uploaded whole instead.", null)
      }

      mapOf(
        "path" to output.absolutePath,
        "bytes" to output.length(),
        "ms" to (System.currentTimeMillis() - started)
      )
    }

    /** True when this device can mark, so the app can skip the attempt entirely. */
    Function("available") {
      android.media.MediaCodecList(android.media.MediaCodecList.REGULAR_CODECS).codecInfos.any { info ->
        info.isEncoder && info.supportedTypes.any { it.equals(MediaTypes.H264, ignoreCase = true) || it.contains("avc", ignoreCase = true) }
      }
    }
  }

  private object MediaTypes {
    const val H264 = "video/avc"
  }

  private companion object {
    /** One mark at a time, for the whole process. */
    val MARKING = AtomicBoolean(false)

    /** How long one mark may take before the clip is posted unmarked instead. */
    const val MAX_MARK_MINUTES = 10L
  }

  /**
   * The chip: `@handle` in white on a translucent near-black, drawn at 3x the
   * display size so it stays sharp when the clip is 1080p. Returns null when
   * there is nothing to draw, so a blank handle produces no overlay rather than
   * an empty box.
   */
  private fun markBitmap(handle: String): Bitmap? {
    val label = handle.trim().removePrefix("@")
    if (label.isEmpty()) return null

    val text = "@$label"
    val scale = 3f
    val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.WHITE
      textSize = 26f * scale
      typeface = android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL)
    }
    val padX = 18f * scale
    val padY = 11f * scale
    val width = textPaint.measureText(text) + padX * 2
    val metrics = textPaint.fontMetrics
    val height = (metrics.descent - metrics.ascent) + padY * 2

    val bitmap = Bitmap.createBitmap(width.toInt().coerceAtLeast(1), height.toInt().coerceAtLeast(1), Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val background = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(150, 11, 7, 12) }
    canvas.drawRoundRect(RectF(0f, 0f, width, height), height / 2f, height / 2f, background)
    canvas.drawText(text, padX, padY - metrics.ascent, textPaint)
    return bitmap
  }
}
