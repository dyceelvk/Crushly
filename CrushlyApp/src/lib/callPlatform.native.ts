import { PermissionsAndroid, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { getRandomBytes } from 'expo-crypto';
import { mediaDevices, RTCPeerConnection } from 'react-native-webrtc';
const audio = requireOptionalNativeModule<{ start: () => Promise<void>; stop: () => void }>('CrushlyCallAudio');
export async function callMedia(): Promise<MediaStream> {
  if (Platform.OS === 'android') {
    const permission = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    if (permission !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('Allow microphone access to make or answer calls.');
  }
  await audio?.start();
  try { return await mediaDevices.getUserMedia({ audio: true, video: false }) as unknown as MediaStream; }
  catch { audio?.stop(); throw new Error('Couldn’t open your microphone. Close other recording apps and try again.'); }
}
// Boundary adapter: react-native-webrtc implements the same voice-call methods/events.
export function callPeer(iceServers: RTCIceServer[]): globalThis.RTCPeerConnection {
  return new RTCPeerConnection({ iceServers }) as unknown as globalThis.RTCPeerConnection;
}
export function stopCallAudio() { audio?.stop(); }
export function callRandomBytes(): Uint8Array { return getRandomBytes(16); }

export function releaseCallMedia(stream: MediaStream) {
  (stream as unknown as { release: () => void }).release();
}
