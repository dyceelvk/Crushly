/**
 * Saving a clip — web side.
 *
 * There is no gallery in a browser; the browser's own download is the honest
 * equivalent. Getting it to happen took three attempts, and the first two are
 * worth writing down because they are the obvious ones:
 *
 *  1. `<a href="https://media…/d/12" download="holup-12.mp4">` — **does nothing**.
 *     The `download` attribute is ignored for a cross-origin URL: the browser
 *     navigates to the file and plays it in a tab instead of saving it. The media
 *     Worker lives on a different host to the app, so every save did that.
 *  2. Fetch it into a blob and hand the blob to the anchor — the right answer, but
 *     the Worker's `/d/` response carried no `Access-Control-Allow-Origin`, so the
 *     fetch was refused before a byte arrived.
 *
 * So this does both, in that order: try the blob (exact filename, no new tab) and
 * if the request is refused for any reason, open the address and let the server's
 * own `Content-Disposition: attachment` name the file. That header is honoured on
 * a top-level navigation regardless of origin, which makes the fallback the one
 * path that works with the Worker exactly as it is deployed today.
 *
 * This file exists because `expo-media-library` has no web implementation and
 * **throws while being imported**, not when it is called. Importing it from a
 * module the web bundle loads at startup took the entire app down to a white
 * screen. The native half lives in `saveClipToGallery.native.ts`, and Metro picks
 * one file per platform, so the native module cannot reach a browser at all.
 */
export async function saveClipFile(url: string, name: string): Promise<'saved' | 'downloaded' | 'denied'> {
  try {
    const response = await fetch(url, { credentials: 'omit' });
    if (!response.ok) throw new Error(`download refused (${response.status})`);
    const blob = await response.blob();
    if (!blob.size) throw new Error('empty file');

    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Give the browser a moment to start reading before the blob is released.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    return 'downloaded';
  } catch {
    /*
     * The blob route needs CORS, and the deployed Worker does not send it yet.
     * A plain navigation does not, and the file arrives named by the server —
     * `holup-<post id>.mp4` — because `/d/` answers with
     * `Content-Disposition: attachment`.
     */
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) throw new Error('Your browser blocked the download. Allow pop-ups for holUpp and try again.');
    return 'downloaded';
  }
}
