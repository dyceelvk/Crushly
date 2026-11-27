/**
 * The part that works while holUpp is closed.
 *
 * Android will not let an app sit on a socket in the background, so there is no
 * live delivery when holUpp is not running. What it *will* let an app do is wake
 * up every so often and check — WorkManager via `expo-background-task`, no
 * sooner than about every 15 minutes and later if the phone is saving battery.
 * That is enough to put a Whisper in the notification shade with its sound, and
 * it is honestly described as "every 15 minutes or so", never as instant.
 *
 * The task reuses the same badge counters the app polls, so it needs no new
 * table, no server function and no Firebase project: it asks the same question
 * the app asks itself, compares it with the last answer, and speaks only when the
 * answer went up.
 */
import { Platform } from 'react-native';
import { storage } from './storage';
import { systemAlertFor } from './alertContent';
import type { Badges, NotificationKind } from '../api/types';
import { postAlert } from './systemAlert';
import { soundChoice } from './sound';

export const BACKGROUND_TASK = 'holup-check-alerts';
const SNAPSHOT_KEY = 'holup:alertSnapshot';
/** WorkManager's floor. Asking for less does not make it fire sooner. */
export const BACKGROUND_INTERVAL_MINUTES = 15;

type Snapshot = { messages: number; notifications: number };

async function readSnapshot(): Promise<Snapshot | null> {
  const raw = await storage.get(SNAPSHOT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Snapshot;
    if (typeof parsed?.messages === 'number' && typeof parsed?.notifications === 'number') return parsed;
  } catch {
    /* an old or corrupt value is the same as no value */
  }
  return null;
}

export async function saveSnapshot(snapshot: Snapshot): Promise<void> {
  await storage.set(SNAPSHOT_KEY, JSON.stringify(snapshot));
}

/**
 * One check. Split out from the task registration so the app can run the same
 * thing when it comes back to the foreground after a long time away — the task
 * may not have run, and the member still deserves the tray to be right.
 */
export async function checkAlerts(since: Snapshot | null = null): Promise<Snapshot | null> {
  try {
    const { supabase } = await import('../api/client');
    const { data: session } = await supabase.auth.getSession();
    if (!session?.session) return null; // signed out: nothing to check
    const { data, error } = await supabase.rpc('badges');
    if (error || !data) return null;
    const badges = data as Badges;
    const before = since ?? (await readSnapshot());
    const next: Snapshot = { messages: badges.messages ?? 0, notifications: badges.notifications ?? 0 };

    if (before && (next.messages > before.messages || next.notifications > before.notifications)) {
      const kind = next.messages > before.messages ? 'message' : 'notification';
      const alert = systemAlertFor(kind, badges);
      await postAlert({
        title: alert.title,
        body: alert.body,
        route: alert.route,
        id: alert.id,
        kind: (badges.latestNotification?.kind as NotificationKind | null) ?? null,
        background: true,
        sound: soundChoice(),
      });
    }
    await saveSnapshot(next);
    return next;
  } catch {
    return null;
  }
}

let defined = false;

/**
 * Registers the task. Called once from the app shell after sign-in; safe to call
 * more than once, and silent if the phone refuses (some Android builds disable
 * background work for freshly installed apps until they are opened).
 */
export async function startBackgroundAlerts(): Promise<void> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return;
  try {
    const TaskManager = await import('expo-task-manager');
    const BackgroundTask = await import('expo-background-task');
    if (!defined) {
      TaskManager.defineTask(BACKGROUND_TASK, async () => {
        const result = await checkAlerts();
        return result ? BackgroundTask.BackgroundTaskResult.Success : BackgroundTask.BackgroundTaskResult.Failed;
      });
      defined = true;
    }
    const already = await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK);
    if (already) return;
    await BackgroundTask.registerTaskAsync(BACKGROUND_TASK, {
      minimumInterval: BACKGROUND_INTERVAL_MINUTES,
    });
  } catch {
    // No background checking on this device: notifications then only arrive while
    // the app is open, and the settings screen says so.
  }
}

export async function stopBackgroundAlerts(): Promise<void> {
  try {
    const BackgroundTask = await import('expo-background-task');
    await BackgroundTask.unregisterTaskAsync(BACKGROUND_TASK);
  } catch {
    /* nothing registered */
  }
}
