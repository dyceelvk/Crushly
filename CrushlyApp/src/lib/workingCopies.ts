/**
 * The list of files `clipWorkingCopy` encoded, kept pure so it can be tested
 * without a phone or React Native.
 *
 * Why the list exists: the upload compresses whatever it is given. Now that a
 * clip is encoded once at pick time, handing that same file to the uploader
 * would encode it a second time — minutes of MediaCodec work on the member's
 * phone and a second generation of quality loss for no smaller a file. So the
 * encoder records what it made, and the upload sends those files untouched.
 */
const prepared = new Set<string>();

export function notePreparedCopy(uri: string): void {
  if (uri) prepared.add(uri);
}

export function isPreparedWorkingCopy(uri: string): boolean {
  return prepared.has(uri);
}

/** Only for tests: the real app never needs to forget a file it made. */
export function forgetPreparedCopies(): void {
  prepared.clear();
}
