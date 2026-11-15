/**
 * The phone's own copy of a marked clip — Android half.
 *
 * The member's clip is already on their phone when they post it, and the marked
 * file was written there a second before it was uploaded. Making them download it
 * back from the server to save it is a round trip over a network to fetch bytes
 * that are sitting in the app's own cache — on a phone, on mobile data, for a
 * ten-second clip. On a bad connection it does not even work: the download fails
 * and the member is told to try again in a minute.
 *
 * So the marked file is kept, under the post id, until the gallery has it. Save
 * then writes a local file: no network, no failure, works offline.
 *
 * The rules it keeps:
 *
 *  · **A cache, not a leak.** A fixed number of clips and a byte ceiling; the
 *    oldest go first. A member who posts every day must not find the app has
 *    eaten their storage.
 *  · **Never a reason for a post to fail.** Every operation here is best-effort
 *    and returns rather than throws.
 *  · **Only the marked copy.** This is the file that is allowed to leave the
 *    app; an unmarked cached video (the one the player keeps) is never offered
 *    to Save.
 */
import * as FileSystem from 'expo-file-system/legacy';

/** Where these live, beside the player's clip cache. */
const DIR = 'marked-copies';
/** At most this many clips are kept; twelve posts back is plenty. */
const KEEP_FILES = 12;
/** …and at most this many bytes, so one long clip cannot fill the disk. */
const KEEP_BYTES = 240 * 1024 * 1024;

const dir = () => `${FileSystem.cacheDirectory ?? ''}${DIR}/`;

async function ensureDir(): Promise<string | null> {
  const base = FileSystem.cacheDirectory;
  if (!base) return null;
  const path = dir();
  const info = await FileSystem.getInfoAsync(path).catch(() => null);
  if (!info?.exists) await FileSystem.makeDirectoryAsync(path, { intermediates: true }).catch(() => undefined);
  return path;
}

/** Files here, oldest first. */
async function inventory(path: string): Promise<{ uri: string; size: number; modified: number }[]> {
  const names = await FileSystem.readDirectoryAsync(path).catch(() => [] as string[]);
  const files: { uri: string; size: number; modified: number }[] = [];
  for (const name of names) {
    const info = await FileSystem.getInfoAsync(`${path}${name}`).catch(() => null);
    if (info?.exists && 'size' in info) {
      files.push({ uri: `${path}${name}`, size: info.size ?? 0, modified: info.modificationTime ?? 0 });
    }
  }
  return files.sort((a, b) => a.modified - b.modified);
}

/**
 * Keep `uri` as the marked copy of `postId`.
 *
 * The file is moved rather than copied: it was produced in the cache a moment
 * ago and nothing else will read it, so a copy would leave the original behind
 * for the phone's sweeper to find anyway.
 */
export async function keepMarkedCopy(postId: number, uri: string): Promise<boolean> {
  try {
    const path = await ensureDir();
    if (!path || !postId) return false;
    const source = await FileSystem.getInfoAsync(uri).catch(() => null);
    if (!source?.exists || !('size' in source) || !source.size) return false;

    const target = `${path}${postId}.mp4`;
    await FileSystem.moveAsync({ from: uri, to: target }).catch(async () => {
      // Different volumes or a stale target: a copy then, which is still local.
      await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => undefined);
      await FileSystem.copyAsync({ from: uri, to: target });
    });

    // Evict after writing, so the newest clip is never the one that goes.
    const files = await inventory(path);
    let total = files.reduce((n, f) => n + f.size, 0);
    let count = files.length;
    for (const file of files) {
      if (count <= KEEP_FILES && total <= KEEP_BYTES) break;
      if (file.uri === target) continue;
      await FileSystem.deleteAsync(file.uri, { idempotent: true }).catch(() => undefined);
      total -= file.size;
      count -= 1;
    }
    return true;
  } catch {
    return false;
  }
}

/** The kept marked copy for a post, if this phone still has it. */
export async function markedCopyFor(postId: number): Promise<string | null> {
  try {
    const path = await ensureDir();
    if (!path || !postId) return null;
    const target = `${path}${postId}.mp4`;
    const info = await FileSystem.getInfoAsync(target).catch(() => null);
    return info?.exists && (info.size ?? 0) > 0 ? target : null;
  } catch {
    return null;
  }
}
