/**
 * Tuning a voice call for responsiveness.
 *
 * A call that works but feels a beat behind is not really working — people
 * talk over each other and blame the app. Most of the delay is not the
 * network, it is what happens at each end: the jitter buffer smoothing out
 * uneven arrival, the codec waiting to fill a packet, and audio processing
 * cleaning up sound that is already clean enough.
 *
 * So we ask for less of all three. The trade is deliberate and small: a
 * slightly less forgiving buffer on a very shaky connection, in exchange for
 * speech that lands when it was said.
 */

/** Opus settings for conversation rather than for music. */
const OPUS_PARAMS = [
  'minptime=10',
  'useinbandfec=1',
  'usedtx=0',
  'stereo=0',
  'maxaveragebitrate=24000',
  'maxplaybackrate=16000',
].join(';');

/** One channel, echo handled, no extra processing in the path. */
export const CALL_AUDIO_CONSTRAINTS = {
  audio: {
    echoCancellation: true,
    noiseSuppression: false,
    autoGainControl: true,
    channelCount: 1,
  },
  video: false,
} as const;

/**
 * Rewrites the Opus parameters in an SDP blob.
 *
 * - `minptime=10;ptime=20` — packet voice in 20 ms slices, as small as WebRTC
 *   allows, instead of bundling more audio into each packet.
 * - `usedtx=0` — no silence suppression. It saves bandwidth but makes the
 *   first syllable of every sentence late, which is exactly what "laggy"
 *   sounds like in a conversation.
 * - `maxaveragebitrate` and `maxplaybackrate` — voice, not music. Fewer bits
 *   arrive more evenly on a phone network, so the buffer stays shallow.
 * - `useinbandfec=1` — keeps a lost packet from dropping a whole word.
 *
 * If the SDP isn't shaped the way we expect, it is returned untouched: a call
 * with default settings is far better than no call.
 */
export function lowLatencySdp(sdp: string): string {
  if (!sdp) return sdp;
  // Opus is named on the rtpmap line; the settings live on the fmtp line that
  // carries the same payload number, so find the numbers first.
  const opus = new Set<string>();
  for (const m of sdp.matchAll(/^a=rtpmap:(\d+) opus\/48000\b/gim)) opus.add(m[1]);
  if (!opus.size) return sdp;
  return sdp.replace(
    /^a=fmtp:(\d+) .*$/gim,
    (line, payload: string) => (opus.has(payload) ? `a=fmtp:${payload} ${OPUS_PARAMS}` : line),
  );
}

/**
 * Shrinks the play-out buffer on the receiving side. 60 ms is enough to ride
 * out ordinary jitter on a phone network while keeping the round trip short;
 * the default grows to several hundred milliseconds once packets arrive
 * unevenly, and it does not come back down.
 */
export function tunePlayback(pc: RTCPeerConnection): void {
  try {
    const receivers = pc.getReceivers?.() ?? [];
    for (const receiver of receivers as unknown as Record<string, unknown>[]) {
      if ('jitterBufferTarget' in receiver) (receiver as { jitterBufferTarget: number }).jitterBufferTarget = 60;
      if ('playoutDelayHint' in receiver) (receiver as { playoutDelayHint: number }).playoutDelayHint = 0;
    }
  } catch {
    // Not supported on this platform — the call still works, just as before.
  }
}
