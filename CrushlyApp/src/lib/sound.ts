/**
 * The sounds holUpp makes, and when it makes them.
 *
 * Until now it made none. A Whisper could arrive, a notification could land, and
 * the phone said nothing at all unless it happened to vibrate — which, on a
 * device with haptics off, is nothing either. This module is the whole of it: two
 * short chimes, one rule each about when to play, and a switch the member owns.
 *
 * Deliberate choices, because a notification sound is the easiest thing in an app
 * to get wrong:
 *
 *  · **Short and soft.** A message is a two-note rise (0.46s), a notification a
 *    single note with a shimmer (0.7s). Both are over before the next one can
 *    overlap them. A loud or long alert is the one people switch off — and then
 *    there are no sounds at all, which is the bug this file exists to fix.
 *  · **Never while you are reading it.** The chat screen and the notifications
 *    screen register themselves as suppressed, so a message you are looking at
 *    does not chime at you, and the sound you hear always means something you
 *    have not seen yet.
 *  · **Never in the background.** Every call site checks app state first; a phone
 *    playing a chime from a backgrounded app is a bug, not a feature.
 *  · **One chime per change, with a floor between them.** Ten messages in two
 *    seconds is one sound, not ten.
 *  · **A reminder, not a reward.** No sound for anything the member did
 *    themselves: the caller compares counts and only reports an increase.
 *
 * The two files are synthesised by `scripts/make-alert-sounds.py` and bundled, so
 * there is nothing to license and nothing to fetch at runtime.
 */
import { AppState, Platform } from 'react-native';
import { storage } from './storage';
import { shouldPlay, type PlayContext } from './soundRules';

export type SoundKind = 'message' | 'notification';

/** Set once the player is warm, so the first chime is not the one that fails. */
let modeReady = false;

type Player = { seekTo: (s: number) => Promise<void>; play: () => void };

const players: Partial<Record<SoundKind, Player>> = {};

/**
 * Created on first use, not at import.
 *
 * `createAudioPlayer` allocates a native player; doing that while the module
 * graph is still loading (on a cold start, behind the splash) is how audio
 * modules fail on slow devices. It is also the reason nothing here imports
 * `expo-audio` at the top: the web bundle must not evaluate it before it is
 * needed, and a failed import must cost a chime, not the app.
 */
async function playerFor(kind: SoundKind): Promise<Player | null> {
  if (players[kind]) return players[kind] ?? null;
  try {
    const audio = await import('expo-audio');
    // A sound played while the phone is on silent mode still needs to be audible
    // on iOS (where "silent" means the ringer switch), and it must never stop
    // somebody's music: this app is a background companion, not a channel.
    await audio.setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' });
    const source =
      kind === 'message'
        ? require('../../assets/sounds/message.wav')
        : require('../../assets/sounds/notification.wav');
    const player = audio.createAudioPlayer(source) as unknown as Player;
    players[kind] = player;
    modeReady = true;
    return player;
  } catch {
    // No audio device, no permission, an unsupported platform: say nothing. A
    // chime is an addition to the app, never a dependency of one.
    return null;
  }
}

/* ------------------------------------------------------------------- switch */

const SOUND_KEY = 'holup:sound';

/**
 * On unless it has been turned off. Silence is the surprising default for a chat
 * app, and the switch lives in Notification settings where somebody who wants it
 * will look.
 */
let soundOn = true;
let loaded = false;
let onLoaded: (() => void) | null = null;

export function soundEnabled(): boolean {
  return soundOn;
}

export async function loadSoundSetting(): Promise<void> {
  if (loaded) return;
  loaded = true;
  const raw = await storage.get(SOUND_KEY);
  if (raw === 'off') soundOn = false;
  onLoaded?.();
}

export async function setSoundEnabled(on: boolean): Promise<void> {
  soundOn = on;
  loaded = true;
  await storage.set(SOUND_KEY, on ? 'on' : 'off');
}

/** Called by the settings screen once it knows the value, so the UI can show it. */
export function whenSoundSettingLoaded(fn: () => void): () => void {
  onLoaded = fn;
  if (loaded) fn();
  return () => {
    if (onLoaded === fn) onLoaded = null;
  };
}

/* --------------------------------------------------------------- suppression */

/**
 * Screens register while they are on top of the stack. A message arriving in the
 * room you are sitting in is not news, and chiming at it is the fastest way to
 * make somebody turn sounds off.
 */
const suppressed = new Set<SoundKind>();

export function suppressSound(kind: SoundKind, on: boolean): void {
  if (on) suppressed.add(kind);
  else suppressed.delete(kind);
}

export function isSuppressed(kind: SoundKind): boolean {
  return suppressed.has(kind);
}

/* ------------------------------------------------------------------ playing */

let lastPlayedAt = 0;

export async function playSound(kind: SoundKind): Promise<void> {
  const ctx: PlayContext = {
    enabled: soundOn,
    suppressed: isSuppressed(kind),
    appActive: AppState.currentState === 'active',
    now: Date.now(),
    lastPlayedAt,
  };
  if (!shouldPlay(ctx)) return;
  lastPlayedAt = ctx.now;
  const player = await playerFor(kind);
  if (!player) return;
  try {
    // Rewind first: a player that has already finished is parked at the end, and
    // `play()` on it does nothing audible. Rewinding is what makes the second
    // chime sound like the first.
    await player.seekTo(0);
    player.play();
  } catch {
    /* the phone refused; the app still works */
  }
}

/** True on platforms where a sound can be played at all in this build. */
export const soundSupported = Platform.OS === 'android' || Platform.OS === 'ios' || Platform.OS === 'web';

/** Exposed for tests and for a "try it" row in settings. */
export function __resetSoundStateForTests(): void {
  lastPlayedAt = 0;
  soundOn = true;
  loaded = false;
  suppressed.clear();
  modeReady = false;
}
