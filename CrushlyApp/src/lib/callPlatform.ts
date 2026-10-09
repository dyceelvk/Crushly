export async function callMedia(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Calls need a secure browser with microphone support.');
  try { return await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { throw new Error('Allow microphone access to make or answer calls.'); }
}
export function callPeer(iceServers: RTCIceServer[]): RTCPeerConnection { return new RTCPeerConnection({ iceServers }); }
export function stopCallAudio() {}
export function callRandomBytes(): Uint8Array { return crypto.getRandomValues(new Uint8Array(16)); }
