/**
 * Where a member's media actually lives.
 *
 * Two stores, one door. Until now every photo, Moment and chat attachment went to
 * Backblaze B2, where downloads are metered: the allowance ran out and the
 * update channel answered 503 for hours. Cloudflare R2 charges nothing to serve,
 * so new media goes there, and B2 becomes the place old media is *read* from
 * until it ages out.
 *
 * The rule is deliberately in its own module, with no `fetch` in it, because it
 * is the part that can be wrong in a way nobody notices: a file written to one
 * store and read from the other is a photo that uploads fine and is then broken
 * forever.
 *
 * **What goes where**
 *
 *   images, video  →  R2      (the whole of a post, a Moment, a Whisper attachment)
 *   text           →  nowhere (see below)
 *   the APK        →  R2, a different bucket, its own path prefix
 *
 * Text is not a file. A message, a whisper, a reply, a bio is a **row in
 * Supabase**, and that is where it must stay: it is searched, sorted, joined,
 * paginated, counted and — the part that matters most — protected row by row by
 * RLS. A chat stored as files in an object store would have to fetch a blob,
 * parse it, and re-check permissions by hand on every screen, with no index and
 * no transaction. Moving text to object storage would make the app slower,
 * more expensive and less safe at the same time.
 */

export type Store = 'r2' | 'b2';

/**
 * Which store a path lives in **when writing**.
 *
 * Everything media-shaped goes to R2. The APK never reaches this function (it
 * lives in its own bucket under `android-releases/`), and anything that is not
 * obviously media still goes to R2, because the alternative — a path that
 * silently lands in the metered store — is how this broke the first time.
 */
export function writeStore(_path: string): Store {
  return 'r2';
}

/**
 * The order to try when **reading**, which is not the same question.
 *
 * R2 first because that is where new files are. B2 second because every file
 * uploaded before this change lives there and must keep working — a migration
 * that breaks old photos is not a migration, it is an outage with a changelog.
 */
export const READ_ORDER: Store[] = ['r2', 'b2'];

/**
 * Both stores are asked to delete. Idempotent on each: `delete` of a missing key
 * is not an error, so a file that only exists in one of them still disappears
 * cleanly, and a half-finished migration cannot leave a copy behind.
 */
export const DELETE_STORES: Store[] = ['r2', 'b2'];

/** True when the path is the APK's, which has its own bucket and must not move. */
export function isReleasePath(path: string): boolean {
  return path.startsWith('android-releases/');
}
