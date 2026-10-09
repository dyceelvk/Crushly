package app.crushly.callaudio

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Small New-Architecture-compatible audio lifecycle module; no phone/contacts access. */
class CrushlyCallAudioModule : Module() {
  private var manager: AudioManager? = null
  private var focus: AudioFocusRequest? = null
  private var previousMode = AudioManager.MODE_NORMAL
  override fun definition() = ModuleDefinition {
    Name("CrushlyCallAudio")
    AsyncFunction("start") {
      if (manager == null) {
        val audio = appContext.reactContext!!.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        previousMode = audio.mode
        manager = audio
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
          .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
          .setOnAudioFocusChangeListener { change ->
            if (change == AudioManager.AUDIOFOCUS_LOSS) stopAudio()
          }.build()
        focus = request
        audio.requestAudioFocus(request)
        audio.mode = AudioManager.MODE_IN_COMMUNICATION
        if (Build.VERSION.SDK_INT >= 31) {
          val device = audio.availableCommunicationDevices.firstOrNull {
            it.type == AudioDeviceInfo.TYPE_WIRED_HEADSET || it.type == AudioDeviceInfo.TYPE_USB_HEADSET
          } ?: audio.availableCommunicationDevices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE }
          if (device != null) audio.setCommunicationDevice(device)
        } else {
          @Suppress("DEPRECATION")
          audio.isSpeakerphoneOn = false
        }
      }
    }
    Function("stop") { stopAudio() }
    OnDestroy { stopAudio() }
  }
  private fun stopAudio() {
    val audio = manager ?: return
    if (Build.VERSION.SDK_INT >= 31) audio.clearCommunicationDevice()
    audio.mode = previousMode
    focus?.let { audio.abandonAudioFocusRequest(it) }
    manager = null
    focus = null
  }
}
