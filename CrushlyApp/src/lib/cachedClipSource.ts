/**
 * The clip source the player should use, and how it gets better.
 *
 * A watched clip should come back instantly and work with no signal, so the
 * player starts on the network address it already had and swaps to the local file
 * once the download finishes — usually before the clip has been watched a second
 * time. There is deliberately no "downloading…" state for the member: the first
 * watch is the download, and it looks exactly like any other play.
 *
 * The flow, per URL:
 *   1. is it already cached? → use the file, no network at all
 *   2. otherwise play the URL, and quietly fetch it for next time
 *
 * Failures are silent by design. A cache that cannot be filled is a slower clip,
 * not a broken one, and a toast about it would be a lie about what went wrong.
 */
import { useEffect, useState } from 'react';
import { cacheClip, cachedClip } from './videoCache';

/** Cache misses we have already started, so a re-render cannot start a second. */
const inFlight = new Set<string>();

export function useCachedClip(uri: string | null | undefined): string | null {
  const [local, setLocal] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setLocal(null);
    if (!uri || !/^https?:\/\//i.test(uri)) { setLocal(uri ?? null); return () => { live = false; }; }

    void (async () => {
      const already = await cachedClip(uri);
      if (!live) return;
      if (already) { setLocal(already); return; }
      if (inFlight.has(uri)) return;
      inFlight.add(uri);
      try {
        const file = await cacheClip(uri);
        if (live && file) setLocal(file);
      } finally {
        inFlight.delete(uri);
      }
    })();

    return () => { live = false; };
  }, [uri]);

  // Until a local copy exists the caller keeps using the remote address, so the
  // first play is never delayed by the cache.
  return local ?? uri ?? null;
}
