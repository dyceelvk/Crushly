/**
 * When a chime may be played — the decision, with no audio and no React Native in
 * it, so the rules can be proven by describing a situation rather than by
 * holding a phone.
 *
 * Kept apart from `sound.ts` for the same reason `clipSaveRules` is kept apart
 * from `downloadClip`: the module that owns the native player cannot be imported
 * in a test process, and a rule that cannot be tested is a rule that gets broken
 * quietly.
 */

/** At most one chime a second, whichever kind asked for it. */
export const MIN_GAP_MS = 1_000;

export interface PlayContext {
  /** The member's switch, in Notification settings. */
  enabled: boolean;
  /** The screen that owns this kind is on top of the stack. */
  suppressed: boolean;
  /** The app is in the foreground. */
  appActive: boolean;
  now: number;
  /** When the last chime played, 0 if none yet. */
  lastPlayedAt: number;
}

export function shouldPlay(ctx: PlayContext): boolean {
  if (!ctx.enabled) return false;
  if (ctx.suppressed) return false;
  if (!ctx.appActive) return false;
  if (ctx.lastPlayedAt > ctx.now) return false; // clock moved backwards; stay quiet
  return ctx.now - ctx.lastPlayedAt >= MIN_GAP_MS;
}

/**
 * Which chime, if any, a change in the polled counters deserves.
 *
 * A message wins over a notification when both went up in the same poll: two
 * chimes a second apart reads as a fault, not as two events. `null` means the
 * world did not change, which is the common case — the poll runs whether or not
 * anything happened.
 */
export type CounterChange = { messages: number; notifications: number };

export function alertFor(before: CounterChange | null, next: CounterChange): 'message' | 'notification' | null {
  // The first reading is the state of the world, not an event: opening the app
  // with three unread Whispers must not chime three times.
  if (!before) return null;
  if (next.messages > before.messages) return 'message';
  if (next.notifications > before.notifications) return 'notification';
  return null;
}
