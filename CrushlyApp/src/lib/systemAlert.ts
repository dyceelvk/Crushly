/**
 * System notifications: the ones that appear at the top of the screen.
 *
 * Two different jobs, and they must not make two noises:
 *
 *  · **While holUpp is open.** The chime in `sound.ts` is the sound, because it
 *    is the sound the member chose and it is the one already proven to work on a
 *    real phone. The notification posted here rides along on a silent
 *    high-importance channel purely so the banner drops down over whatever is on
 *    screen. If Android decides not to show the banner, the chime still plays.
 *  · **While holUpp is closed.** Nothing of ours is running, so the notification
 *    is the whole thing, and it has to make its own sound: `BACKGROUND_CHANNEL`
 *    carries the bundled wav as a raw resource. This is the only path that
 *    reaches somebody who is not looking at the app.
 *
 * Everything is imported lazily. `expo-notifications` touches native modules at
 * import time, and a failure there must cost a banner, never the app — the same
 * rule the audio player follows.
 */
import { Platform } from 'react-native';
import type { NotificationBehavior } from 'expo-notifications';
import type { NotificationKind } from '../api/types';
import { soundChoice } from './sound';
import type { AlertRoute } from './alertContent';

const FOREGROUND_CHANNEL = 'holup-foreground';
/**
 * One channel per chime, because Android fixes a channel's sound when the channel
 * is first created and never changes it. Creating `holup-alerts` once with
 * whatever was chosen that day would freeze that sound forever; a channel per
 * choice lets the member change their mind.
 */
const backgroundChannel = (choice: string) => `holup-alerts-${choice}`;
/** Raw resources copied into res/raw by plugins/withNotificationSounds.js. */
const backgroundSound = (choice: string) => `holup_${choice}`;

type NotificationsModule = typeof import('expo-notifications');

let mod: NotificationsModule | null = null;
let handlerSet = false;

async function notifications(): Promise<NotificationsModule | null> {
  if (Platform.OS === 'web') return null; // the browser has its own idea of this
  if (mod) return mod;
  try {
    mod = await import('expo-notifications');
    if (!handlerSet) {
      // Foreground presentation: a banner and a place in the shade. `shouldPlaySound`
      // stays true because Android refuses to drop the banner when it is false —
      // the channel underneath is silent, so this is not a second sound.
      const behavior: NotificationBehavior = {
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      };
      mod.setNotificationHandler({ handleNotification: async () => behavior });
      handlerSet = true;
    }
    return mod;
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------- permission */

let granted: boolean | null = null;

export async function alertPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  if (granted !== null) return granted;
  const n = await notifications();
  if (!n) return false;
  try {
    const current = await n.getPermissionsAsync();
    granted = current.granted || current.status === 'granted';
  } catch {
    granted = false;
  }
  return granted;
}

/**
 * Asks once, and is safe to call on every start: Android answers from its own
 * record after the first time, so this does not nag.
 */
export async function requestAlertPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const n = await notifications();
  if (!n) return false;
  try {
    const current = await n.getPermissionsAsync();
    if (current.granted || current.status === 'granted') {
      granted = true;
      await channels(n);
      return true;
    }
    // "undetermined" is the only state where asking shows the system sheet; after
    // a refusal only Android settings can change it, and asking again would be a
    // silent no — so this returns false and the settings row says where to go.
    if (current.canAskAgain === false) {
      granted = false;
      return false;
    }
    const asked = await n.requestPermissionsAsync();
    granted = asked.granted || asked.status === 'granted';
    if (granted) await channels(n);
    return granted;
  } catch {
    granted = false;
    return false;
  }
}

/* ----------------------------------------------------------------- channels */

let channelsReady = false;
/** Channels are created lazily per choice, so a new choice needs one more. */
const madeChannels = new Set<string>();

async function channels(n: NotificationsModule): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await n.setNotificationChannelAsync(FOREGROUND_CHANNEL, {
      name: 'holUpp',
      description: 'Whispers and notifications while holUpp is open.',
      importance: n.AndroidImportance.HIGH,
      // Silent on purpose: the in-app chime is the sound here, and two sounds for
      // one message is the fastest way to get notifications switched off.
      sound: null,
      vibrationPattern: [0, 120],
      enableVibrate: true,
      lockscreenVisibility: n.AndroidNotificationVisibility.PRIVATE,
    });
    const choice = soundChoice();
    const channel = backgroundChannel(choice);
    if (!madeChannels.has(channel)) {
      await n.setNotificationChannelAsync(channel, {
        name: 'holUpp (while closed)',
        description: 'Whispers and notifications that arrived while holUpp was closed.',
        importance: n.AndroidImportance.HIGH,
        sound: `${backgroundSound(choice)}.wav`,
        vibrationPattern: [0, 120, 80, 120],
        enableVibrate: true,
        lockscreenVisibility: n.AndroidNotificationVisibility.PRIVATE,
      });
      madeChannels.add(channel);
    }
    channelsReady = true;
  } catch {
    /* channels are best effort; the notification still posts */
  }
}

/* ---------------------------------------------------------------- posting */

export interface PostOptions {
  title: string;
  body: string;
  /** Where a tap should land. */
  route: AlertRoute;
  /** Replaces an earlier one with the same id instead of stacking. */
  id: string;
  kind: NotificationKind | null;
  /** True when nothing of ours is running to play a chime. */
  background?: boolean;
  /** Which chime the background channel should use. Defaults to the member's. */
  sound?: string;
}

/**
 * Posts a notification. Returns whether it actually reached the phone, so the
 * caller knows whether it still owes a sound.
 */
export async function postAlert(opts: PostOptions): Promise<boolean> {
  const n = await notifications();
  if (!n) return false;
  if (!(await alertPermission())) return false;
  await channels(n);
  // A channel-aware trigger with no schedule is Android's "immediately, on this
  // channel". Everywhere else there is no channel and the trigger is null.
  const onChannel = Platform.OS === 'android';
  try {
    await n.scheduleNotificationAsync({
      identifier: opts.id,
      content: {
        title: opts.title,
        body: opts.body,
        sound: opts.background ? `${backgroundSound(opts.sound ?? soundChoice())}.wav` : false,
        data: { route: opts.route, kind: opts.kind ?? 'unknown' },
        ...(onChannel ? { priority: n.AndroidNotificationPriority.HIGH } : {}),
      },
      trigger: onChannel
        ? { channelId: opts.background ? backgroundChannel(opts.sound ?? soundChoice()) : FOREGROUND_CHANNEL }
        : null,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Tapping a notification, whenever it happens — including from a cold start, when
 * the app was not running to hear the tap.
 */
export async function onAlertTapped(handler: (route: AlertRoute) => void): Promise<() => void> {
  const n = await notifications();
  if (!n) return () => {};
  const sub = n.addNotificationResponseReceivedListener((response) => {
    const route = response.notification.request.content.data?.route;
    if (route === 'messages' || route === 'notifications') handler(route);
  });
  try {
    // The tap that launched the app is not delivered to the listener above.
    const last = await n.getLastNotificationResponseAsync();
    const route = last?.notification.request.content.data?.route;
    if (route === 'messages' || route === 'notifications') handler(route);
    if (last?.notification.request.identifier) await n.clearLastNotificationResponseAsync();
  } catch {
    /* nothing was waiting */
  }
  return () => sub.remove();
}
