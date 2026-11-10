/**
 * Saving a clip — web side.
 *
 * There is no gallery in a browser, so the browser's own download is the honest
 * equivalent: the same marked file, named the same way, landing where the member
 * expects.
 *
 * This file exists because `expo-media-library` has no web implementation and
 * **throws while being imported**, not when it is called. Importing it from a
 * module the web bundle loads at startup took the entire app down to a white
 * screen. The native half lives in `saveClipToGallery.native.ts`, and Metro
 * picks one file per platform, so the native module cannot reach a browser at
 * all — which is a stronger guarantee than guarding the call with a runtime
 * check, because a guard still needs the import to succeed.
 */
export async function saveClipFile(url: string, name: string): Promise<'saved' | 'downloaded' | 'denied'> {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return 'downloaded';
}
