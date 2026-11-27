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
 *  · **Short and soft.** Every chime is under a second and peak-normalised well
 *    below full scale, so one is over before the next can overlap it. A loud or
 *    long alert is the one people switch off — and then there are no sounds at
 *    all, which is the bug this file exists to fix.
 *  · **The member's choice.** Six chimes ship (`soundChoices.ts`) and the one
 *    picked in Notification settings is the one used everywhere — including in
 *    the notification bar while the app is closed.
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
import { DEFAULT_SOUND, isSoundChoice } from './soundChoices';

export type SoundKind = 'message' | 'notification';
export type { SoundChoice } from './soundChoices';
export { SOUND_CHOICES, soundName, DEFAULT_SOUND } from './soundChoices';

/**
 * Which file each choice is. The map lives here because `require` of an audio
 * asset is a bundler concern, and the picker must not carry it.
 */
const FILES: Record<string, number> = {
  glass: require('../../assets/sounds/glass.wav'),
  pulse: require('../../assets/sounds/pulse.wav'),
  lumen: require('../../assets/sounds/lumen.wav'),
  bloom: require('../../assets/sounds/bloom.wav'),
  drip: require('../../assets/sounds/drip.wav'),
  orbit: require('../../assets/sounds/orbit.wav'),
};

/** The chosen sound, for the notification channel and for anything that needs it. */
export function soundChoice(): string {
  return choiceOn;
}

export function soundFileFor(id: string): number {
  return FILES[id] ?? FILES[DEFAULT_SOUND];
}

/** Set once the player is warm, so the first chime is not the one that fails. */
let modeReady = false;

type Player = { seekTo: (s: number) => Promise<void>; play: () => void };

const players: Partial<Record<string, Player>> = {};

/**
 * Created on first use, not at import.
 *
 * `createAudioPlayer` allocates a native player; doing that while the module
 * graph is still loading (on a cold start, behind the splash) is how audio
 * modules fail on slow devices. It is also the reason nothing here imports
 * `expo-audio` at the top: the web bundle must not evaluate it before it is
 * needed, and a failed import must cost a chime, not the app.
 */
async function playerFor(choice: string): Promise<Player | null> {
  if (players[choice]) return players[choice] ?? null;
  try {
    const audio = await import('expo-audio');
    // A sound played while the phone is on silent mode still needs to be audible
    // on iOS (where "silent" means the ringer switch), and it must never stop
    // somebody's music: this app is a background companion, not a channel.
    await audio.setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' });
    const player = audio.createAudioPlayer(soundFileFor(choice)) as unknown as Player;
    players[choice] = player;
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
const CHOICE_KEY = 'holup:soundChoice';

/**
 * On unless it has been turned off. Silence is the surprising default for a chat
 * app, and the switch lives in Notification settings where somebody who wants it
 * will look.
 */
let soundOn = true;
let choiceOn = DEFAULT_SOUND;
let loaded = false;
let onLoaded: (() => void) | null = null;

export function soundEnabled(): boolean {
  return soundOn;
}

export async function loadSoundSetting(): Promise<void> {
  if (loaded) return;
  loaded = true;
  const [raw, choice] = await Promise.all([storage.get(SOUND_KEY), storage.get(CHOICE_KEY)]);
  if (raw === 'off') soundOn = false;
  // An id from a build that shipped a sound we no longer have falls back rather
  // than playing nothing at all.
  if (isSoundChoice(choice)) choiceOn = choice as string;
  onLoaded?.();
}

/** Chooses a sound. Persisted on this phone, like the switch. */
export async function setSoundChoice(id: string): Promise<void> {
  if (!isSoundChoice(id)) return;
  choiceOn = id;
  await storage.set(CHOICE_KEY, id);
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

/**
 * Plays the chosen chime.
 *
 * `preview` is the member tapping a row in the picker: they asked to hear it, so
 * the suppression and the one-a-second floor do not apply — but a muted phone or
 * a backgrounded app still does, because nothing should make a noise from the
 * background.
 */
export async function playSound(kind: SoundKind, opts: { previewOf?: string } = {}): Promise<void> {
  const choice = isSoundChoice(opts.previewOf) ? (opts.previewOf as string) : choiceOn;
  const ctx: PlayContext = {
    enabled: opts.previewOf ? true : soundOn,
    suppressed: opts.previewOf ? false : isSuppressed(kind),
    appActive: AppState.currentState === 'active',
    now: Date.now(),
    lastPlayedAt: opts.previewOf ? 0 : lastPlayedAt,
  };
  if (!shouldPlay(ctx)) return;
  if (!opts.previewOf) lastPlayedAt = ctx.now;
  const player = await playerFor(choice);
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
  choiceOn = DEFAULT_SOUND;
  loaded = false;
  suppressed.clear();
  modeReady = false;
}
