/**
 * Updating Hollop from inside Hollop.
 *
 * Android's installer is intentionally a separate app. We can download a
 * package and show its installer sheet, but it is always the member who taps
 * Install. Every attempt starts with a fresh, verified release-assets URL and
 * validates the completed file before that installer ever sees it.
 */
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';

const APK_MIME = 'application/vnd.android.package-archive';
const APK_ZIP_MAGIC_BASE64 = 'UEsDBA=='; // PK\x03\x04 — every Android APK is a ZIP.

/** Where the download lands. Cleared on every attempt so a half file never installs. */
const APK_PATH = `${FileSystem.cacheDirectory ?? ''}crushly-update.apk`;

export type DownloadProgress = (fraction: number) => void;

type DownloadInfo = { downloadUrl?: unknown };

/**
 * Ask the Worker for a fresh GitHub CDN URL before downloading. It resolves
 * only after GitHub identifies a real release asset, so a JSON Worker error can
 * never become a local .apk file.
 */
export async function resolveUpdateDownload(infoUrl: string): Promise<string> {
  const response = await fetch(infoUrl);
  const data = (await response.json().catch(() => null)) as DownloadInfo | null;
  if (!response.ok || typeof data?.downloadUrl !== 'string') {
    throw new Error('The verified Android download is temporarily unavailable. Please try again shortly.');
  }
  return data.downloadUrl;
}

async function validateDownloadedApk(uri: string, expectedBytes?: number | null): Promise<void> {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || typeof info.size !== 'number' || info.size <= 0) {
    throw new Error('The update file was not saved completely. Please try again.');
  }
  if (expectedBytes && info.size !== expectedBytes) {
    throw new Error('The update download was incomplete or invalid. Please try again.');
  }
  const firstFourBytes = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
    position: 0,
    length: 4,
  });
  if (firstFourBytes !== APK_ZIP_MAGIC_BASE64) {
    throw new Error('The download was not an Android package. It was removed; please try again.');
  }
}

/**
 * Fetch the new package into the cache directory, then validate both its exact
 * advertised size and APK ZIP header before giving Android the local file.
 */
export async function downloadUpdate(url: string, onProgress?: DownloadProgress, expectedBytes?: number | null): Promise<string> {
  if (Platform.OS !== 'android') throw new Error('Only Android installs an APK.');

  await FileSystem.deleteAsync(APK_PATH, { idempotent: true }).catch(() => undefined);
  const task = FileSystem.createDownloadResumable(url, APK_PATH, {}, (p) => {
    const total = p.totalBytesExpectedToWrite;
    if (total > 0) onProgress?.(Math.min(1, p.totalBytesWritten / total));
  });

  const result = await task.downloadAsync();
  const status = (result as { status?: number } | null)?.status;
  if (!result?.uri || (typeof status === 'number' && status !== 200)) {
    await FileSystem.deleteAsync(APK_PATH, { idempotent: true }).catch(() => undefined);
    throw new Error('The update stopped before it finished. Please try again.');
  }
  try {
    await validateDownloadedApk(result.uri, expectedBytes);
    return result.uri;
  } catch (error) {
    await FileSystem.deleteAsync(APK_PATH, { idempotent: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Hand the file to Android's installer. The file lives in the app's private
 * cache, so Expo's FileProvider gives the installer a one-shot read grant.
 */
export async function installUpdate(fileUri: string): Promise<void> {
  if (Platform.OS !== 'android') throw new Error('Only Android installs an APK.');
  const contentUri = await FileSystem.getContentUriAsync(fileUri);
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    type: APK_MIME,
    // FLAG_GRANT_READ_URI_PERMISSION — without it the installer cannot read it.
    flags: 1,
  });
}

/** How big the update is, in a form a person reads. */
export function readableSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}
