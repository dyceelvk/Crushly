/**
 * The thing that actually notices something arrived.
 *
 * Two paths deliver news, and they must not make two noises:
 *
 *  · **While holUpp is open** this poll is the path. `badges` is asked every 10s
 *    (that is `useBadges`), and a count that went *up* is the arrival signal —
 *    which costs no extra traffic, cannot fire twice for the same event, and stops
 *    on its own when the app is backgrounded. When it goes up: the member's chosen
 *    chime plays, a haptic, and a system notification is posted so the banner
 *    drops over whatever is on screen and the line stays in the shade.
 *  · **While holUpp is closed** nothing here runs; `backgroundAlerts.ts` wakes on
 *    Android's schedule and the server pushes (`supabase/functions/push-dispatch`).
 *    The snapshot saved below is what keeps the two from announcing the same event
 *    twice.
 *
 * Silence is a feature here: no chime and no banner for the screen you are already
 * looking at, for your own actions, or twice inside a second.
 */
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useBadges } from '../api/hooks';
import { haptic } from '../lib/haptics';
import { isSuppressed, playSound } from '../lib/sound';
import { systemAlertFor } from '../lib/alertContent';
import { postAlert, requestAlertPermission } from '../lib/systemAlert';
import { saveSnapshot } from '../lib/backgroundAlerts';
import { registerPushToken } from '../lib/push';

type Counters = { messages: number; notifications: number };

export function SoundAlerts({ enabled }: { enabled: boolean }) {
  const badges = useBadges(enabled);
  const previous = useRef<Counters | null>(null);

  useEffect(() => {
    if (!badges.data) return;
    const next: Counters = {
      messages: badges.data.messages ?? 0,
      notifications: badges.data.notifications ?? 0,
    };
    const before = previous.current;
    previous.current = next;

    // The background checker and the server compare against this, so an event
    // already heard here is not announced again by a later wake-up.
    void saveSnapshot(next);

    // The first reading is the state of the world, not an event: a member opening
    // the app with three unread Whispers should not be chimed at three times.
    if (!before) return;
    if (AppState.currentState !== 'active') return;

    /*
     * A message wins over a notification when both went up in the same poll: two
     * chimes a second apart reads as a fault, not as two events. The other one is
     * not lost — its count is still higher than the badge the member will see, so
     * the number on the tab is right whether or not a sound played for it.
     */
    const kind = next.messages > before.messages
      ? 'message'
      : next.notifications > before.notifications
        ? 'notification'
        : null;
    if (!kind) return;
    // You are reading it: no sound, and no banner over the screen you are on.
    if (isSuppressed(kind)) return;

    void playSound(kind);
    haptic.soft();

    const alert = systemAlertFor(kind, badges.data);
    void postAlert({
      title: alert.title,
      body: alert.body,
      route: alert.route,
      id: alert.id,
      kind: badges.data.latestNotification?.kind ?? null,
    });
  }, [badges.data]);

  /**
   * The permission prompt and the push token, once there is somebody signed in to
   * notify. Order matters: Firebase will not issue a token to an app the member
   * has not allowed to post notifications.
   */
  useEffect(() => {
    if (!enabled) return;
    void requestAlertPermission().then((ok) => (ok ? registerPushToken() : false));
  }, [enabled]);

  return null;
}
