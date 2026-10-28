/**
 * Coordinates video playback between the Feed and the Post Viewer.
 *
 * Videos auto-play in the Flow feed. When the full-screen Post Viewer opens,
 * it asks every feed video to pause so there's never two videos (and two
 * soundtracks) playing at once. When the viewer closes, the feed resumes.
 */
import { useEffect, useState } from 'react';

type Listener = (paused: boolean) => void;
const listeners = new Set<Listener>();
let paused = false;

/** Tell every feed video to pause or resume. */
export function setVideosPaused(next: boolean): void {
  if (paused === next) return;
  paused = next;
  for (const l of listeners) l(next);
}

/** Subscribe a feed video to viewer pause/resume. */
export function useVideoPaused(): boolean {
  const [state, setState] = useState(paused);
  useEffect(() => {
    const listener: Listener = (p) => setState(p);
    listeners.add(listener);
    listener(paused);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return state;
}
