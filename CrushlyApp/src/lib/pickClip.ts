import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { compressVideoFile, fileSize, MAX_PICK_BYTES } from './compressVideo';

/**
 * A clip for a Whisper.
 *
 * Photos have been possible in a conversation for a while; clips were refused by
 * the server with "Whispers carry photos and voice notes". A clip is how people
 * actually show each other things, so it is allowed now — with the same three
 * guards the rest of the app already uses, in the same order:
 *
 *  1. Refuse a file too big to be worth trying, before reading a byte of it.
 *  2. Compress on the device, which is the only step that makes a 300 MB phone
 *     video into something a person can send on mobile data.
 *  3. If there is no encoder in this build, send the original only if it fits.
 *
 * The picker caps at 60 seconds: a message is not a broadcast, and the cap is
 * enforced by the picker rather than after the fact so the member sees the limit
 * at the moment they are choosing.
 */

export const MAX_CLIP_SECONDS = 60;

export type PickedClip =
  | { uri: string; mimeType: string; durationMs: number; bytes: number | null; compressed: boolean }
  | { error: string }
  | null;

/** What the composer shows while this runs. Free-form labels, in the member's words. */
export type ClipProgress = (fraction: number, label: string) => void;

export async function pickClipForMessage(progress?: ClipProgress): Promise<PickedClip> {
  try {
    if (Platform.OS !== 'web') {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return { error: 'Photo library access is off. You can turn it on in your device settings.' };
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      videoMaxDuration: MAX_CLIP_SECONDS,
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.length) return null;
    const asset = result.assets[0];

    const pickedBytes = await fileSize(asset.uri);
    // The picker reports size on some platforms and not others; a null is
    // "unknown", not "too big".
    if (pickedBytes !== null && pickedBytes > MAX_PICK_BYTES) {
      return { error: 'That clip is too large to send. Trim it, or pick a shorter one.' };
    }

    progress?.(0, 'Preparing your clip');
    const compressed = await compressVideoFile(asset.uri, undefined, progress);
    if (compressed) {
      return {
        uri: compressed.uri,
        mimeType: compressed.mimeType,
        durationMs: durationOf(asset.duration),
        bytes: compressed.bytes,
        compressed: true,
      };
    }

    // No encoder: the original goes, but only if it is small enough to upload.
    const bytes = pickedBytes ?? (await fileSize(asset.uri));
    if (bytes !== null && bytes > MAX_PICK_BYTES) {
      return { error: 'That clip is too large to send, and this build could not shrink it. Pick a shorter one.' };
    }
    return {
      uri: asset.uri,
      mimeType: asset.mimeType || 'video/mp4',
      durationMs: durationOf(asset.duration),
      bytes,
      compressed: false,
    };
  } catch (e) {
    return { error: (e as Error)?.message || 'That clip could not be read.' };
  }
}

/** Expo reports milliseconds on some platforms and seconds on others. */
function durationOf(value: number | null | undefined): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 1000 ? Math.round(n * 1000) : Math.round(n);
}
