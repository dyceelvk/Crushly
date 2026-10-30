/**
 * One clip plays at a time. Not two, not none.
 *
 * A phone has one pair of speakers, and a feed has one thing in front of you.
 * Before this, every `EditedClip` that mounted started itself, so a Flow with
 * three clips in it played three soundtracks over each other — the loudest one
 * winning by luck. Nothing here changes what a clip is; it only settles who
 * gets to be heard.
 *
 * The rule is first-come: whoever starts playing most recently takes the sound
 * away from whoever had it. A clip that pauses on its own (scrolled past,
 * unmounted, finished) simply drops out and nobody else is disturbed.
 *
 * This mirrors what a mature short-video feed does with its player: one live
 * surface, swapped between slides, rather than one player per slide all running
 * at once.
 */

export type Focusable = { pause: () => void };

const registry = new Set<Focusable>();
let active: Focusable | null = null;

/**
 * Add a player to the registry. The returned function removes it again — call
 * it on unmount, or a dead player stays around as a thing to pause forever.
 */
export function registerPlayer(player: Focusable): () => void {
  registry.add(player);
  return () => {
    registry.delete(player);
    if (active === player) active = null;
  };
}

/**
 * Ask for the sound. Everyone else is paused. Idempotent: a clip that is
 * already the active one does not pause and restart itself.
 */
export function takeFocus(player: Focusable): void {
  if (active === player) return;
  active = player;
  for (const other of registry) {
    if (other !== player) other.pause();
  }
}

/** Give the sound back, without handing it to anybody. */
export function releaseFocus(player: Focusable): void {
  if (active === player) active = null;
}

/** Whether this player currently holds the sound. */
export function hasFocus(player: Focusable): boolean {
  return active === player;
}

/** Test seam: forget every registered player. */
export function __resetPlayerFocus(): void {
  registry.clear();
  active = null;
}
