/**
 * Which paths a purge request is allowed to name.
 *
 * The drain workflow holds the admin token, so this is not the security
 * boundary — but a Worker that deletes any key it is handed is one bad paste, or
 * one compromised token, away from emptying a bucket. So the same rule that
 * governs every other upload applies here, and only here: a key this app minted
 * starts with one of six kind folders. Everything else is dropped, silently and
 * without an error, because the caller is a scheduled job and a rejected path is
 * not something anybody will read.
 *
 * Pure and free of `fetch` so it can be tested in plain Node, like mediaStore.
 */
export const PURGE_KINDS = ['photos', 'moments', 'messages', 'posts', 'circles', 'banners'] as const;

const KIND_PREFIX = new RegExp(`^(${PURGE_KINDS.join('|')})/`);
const MAX_PATH = 400;

export function cleanPurgePaths(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const path = raw.trim().replace(/^\/+/, '');
    if (!path || path.length > MAX_PATH) continue;
    // A dot segment is how a "kind/folder/../../somewhere" path escapes the
    // folders this app owns. Nothing real ever contains one.
    if (path.includes('..')) continue;
    if (!KIND_PREFIX.test(path)) continue;
    seen.add(path);
  }
  return [...seen];
}
