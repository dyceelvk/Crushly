/**
 * The four things a Whisper header may say about the other person.
 *
 * These are deliberately four states and not two, because "online", "here in
 * this conversation", "recently active" and "unknown" are different claims and
 * conflating them is how presence becomes a lie:
 *
 *   here       their socket is on this conversation right now (Realtime presence)
 *   online     not in this thread, but their app touched the server < 5 min ago
 *   away       a timestamp the space is willing to give ("Active 2h ago")
 *   offline    nothing to say — either they are gone, or they have switched
 *              visibility off, and the screen must not guess which
 *
 * `null` activity means the space is not allowed to say when they were last
 * around. That is the fourth state, and it prints nothing.
 */

export type PresenceState = 'here' | 'online' | 'away' | 'offline';

export type PresenceInput = {
  /** Their Realtime presence on this conversation's channel. */
  live: boolean;
  /** The database's answer — null when privacy hides it. */
  online: boolean | null;
  /** The database's label — null when privacy hides it. */
  activity: string | null;
};

export function presenceState({ live, online, activity }: PresenceInput): PresenceState {
  if (live) return 'here';
  if (online) return 'online';
  if (activity) return 'away';
  return 'offline';
}

/**
 * What the header prints under their name.
 *
 * `here` is the only state that is a live fact rather than a recent one, so it
 * gets the only sentence in the present tense.
 */
export function presenceLabel(state: PresenceState, activity: string | null): string {
  switch (state) {
    case 'here':
      return 'Here now';
    case 'online':
      return 'Online';
    case 'away':
      return activity ?? 'Away';
    default:
      return 'Offline';
  }
}

/** Only two of the four states are worth a dot; the rest are words. */
export function presenceDot(state: PresenceState): 'live' | 'warm' | 'none' {
  if (state === 'here') return 'live';
  if (state === 'online') return 'warm';
  return 'none';
}

/**
 * Presence is only announced when the member allows it: this is my switch about
 * me. `announce` comes from the database (`peer_presence`), never from a guess.
 */
export function shouldAnnounce(announce: boolean | null | undefined): boolean {
  return announce === true;
}

/**
 * Typing and recording are ephemeral, so they expire on their own rather than
 * waiting for a matching "stopped" event that may never arrive (a dropped
 * socket, a killed app, a hand that left the keyboard).
 */
export const TYPING_TTL_MS = 4000;

export function stillTyping(at: number, now = Date.now()): boolean {
  return at > 0 && now - at < TYPING_TTL_MS;
}
