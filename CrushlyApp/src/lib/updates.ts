/**
 * Updating Crushly from inside Crushly.
 *
 * Crushly is handed out as an APK, so there is no store to push a new build
 * through. That used to mean every release was "here is a link, download 95 MB
 * again, and hope the old file does not fight the new one". Android can do
 * better: download the new package to the app's own cache, hand it to the
 * system installer with a one-shot read grant, and let it replace the running
 * copy in place — the member keeps their data, because it is the same package
 * name and the same signing key.
 *
 * Two facts worth knowing before changing anything here:
 *
 * * The installer is a separate app. Android will show its own sheet ("Do you
 *   want to update this app?"), which is the point of no return we cannot
 *   automate and should not pretend to: silently installing an app is exactly
 *   what malware does.
 * * Installing over a running app kills it. So "refresh" cannot be an in-app
 *   reload — the process that would reload is the one being replaced. The honest
 *   button closes Crushly and says to open it again.
 */
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';

const APK_MIME = 'application/vnd.android.package-archive';

/** Where the download lands. Cleared on every attempt so a half file never installs. */
const APK_PATH = `${FileSystem.cacheDirectory ?? ''}crushly-update.apk`;

export type DownloadProgress = (fraction: number) => void;

/**
 * Fetch the new package into the cache directory.
 *
 * Returns the local `file://` path. Progress is reported as a 0–1 fraction and
 * is simply skipped when the server sends no length.
 */
export async function downloadUpdate(url: string, onProgress?: DownloadProgress): Promise<string> {
  if (Platform.OS !== 'android') throw new Error('Only Android installs an APK.');

  await FileSystem.deleteAsync(APK_PATH, { idempotent: true }).catch(() => undefined);

  const task = FileSystem.createDownloadResumable(url, APK_PATH, {}, (p) => {
    const total = p.totalBytesExpectedToWrite;
    if (total > 0) onProgress?.(Math.min(1, p.totalBytesWritten / total));
  });

  const result = await task.downloadAsync();
  if (!result?.uri) throw new Error('The download stopped before it finished.');
  return result.uri;
}

/**
 * Hand the file to Android's installer.
 *
 * The file lives in the app's private cache, which the installer cannot read, so
 * it goes through Expo's FileProvider as a `content://` URI with a read grant
 * that lasts exactly one intent. Resolves when the installer sheet has been
 * shown, not when the install finishes — the latter has no callback we can hear.
 */
export async function installUpdate(fileUri: string): Promise<void> {
  if (Platform.OS !== 'android') throw new Error('Only Android installs an APK.');
  const contentUri = await FileSystem.getContentUriAsync(fileUri);
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    type: APK_MIME,
    // FLAG_GRANT_READ_URI_PERMISSION — without it the installer is handed a URI
    // it is not allowed to open, and the update fails with no explanation.
    flags: 1,
  });
}

/** How big the update is, in a form a person reads. */
export function readableSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}
