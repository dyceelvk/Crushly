/**
 * Undo, because an editor without it is a trap.
 *
 * Every editor that feels calm has the same property: nothing you do is final
 * until you leave. That is not a feature you can add later — it changes how
 * people use the tool. So the history lives here, beside the edit, and every
 * control goes through it.
 *
 * Two decisions worth stating:
 *
 *   Coalescing. Dragging a handle across the screen fires a hundred updates,
 *   and a hundred undo steps for one gesture is worse than no undo at all. An
 *   update can name what it is (`trim`, `caption-position`); consecutive
 *   updates with the same name fold into one step, and anything else starts a
 *   new one.
 *
 *   Bounded. Fifty steps back is more history than anyone uses and small enough
 *   that keeping it costs nothing. Old steps fall off the far end.
 */

export type History<T> = {
  past: T[];
  present: T;
  future: T[];
  /** What the last update was, so a drag can fold into one step. */
  mergeKey: string | null;
};

export const HISTORY_LIMIT = 50;

export function startHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], mergeKey: null };
}

/**
 * Record a new state. `mergeKey` folds this update into the previous one when
 * they name the same thing; pass null for anything discrete — a cut, a delete,
 * a pick from a list — because those deserve their own step.
 */
export function record<T>(h: History<T>, next: T, mergeKey: string | null = null): History<T> {
  if (Object.is(next, h.present)) return h;

  const folds = mergeKey !== null && mergeKey === h.mergeKey && h.past.length > 0;
  const past = folds ? h.past : [...h.past, h.present].slice(-HISTORY_LIMIT);

  return { past, present: next, future: [], mergeKey };
}

export function canUndo<T>(h: History<T>): boolean {
  return h.past.length > 0;
}

export function canRedo<T>(h: History<T>): boolean {
  return h.future.length > 0;
}

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  const present = h.past[h.past.length - 1];
  return {
    past: h.past.slice(0, -1),
    present,
    future: [h.present, ...h.future].slice(0, HISTORY_LIMIT),
    mergeKey: null,
  };
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  const present = h.future[0];
  return {
    past: [...h.past, h.present].slice(-HISTORY_LIMIT),
    present,
    future: h.future.slice(1),
    mergeKey: null,
  };
}

/** Swap in a state without writing history — a fresh clip, or a reset. */
export function replace<T>(h: History<T>, present: T): History<T> {
  return { ...h, present, mergeKey: null };
}

/** How many steps are available, for a menu that shows it. */
export function depth<T>(h: History<T>): { undo: number; redo: number } {
  return { undo: h.past.length, redo: h.future.length };
}
