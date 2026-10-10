import { CALL_AUDIO_CONSTRAINTS } from './callAudio';

export async function callMedia(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Calls need a secure browser with microphone support.');
  try { return await navigator.mediaDevices.getUserMedia(CALL_AUDIO_CONSTRAINTS as MediaStreamConstraints); }
  catch { throw new Error('Allow microphone access to make or answer calls.'); }
}
export function callPeer(iceServers: RTCIceServer[]): RTCPeerConnection { return new RTCPeerConnection({ iceServers }); }
export function stopCallAudio() {}
export function callRandomBytes(): Uint8Array { return crypto.getRandomValues(new Uint8Array(16)); }

export function releaseCallMedia(_stream: MediaStream) {}
