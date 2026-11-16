/**
 * The thing that actually notices something arrived.
 *
 * There is no push channel in this app — nothing is delivered while it is closed,
 * and that is stated plainly in the Notification settings screen rather than
 * promised. What exists is polling: `badges` every 10s and the notification list
 * every few seconds. So the arrival signal is a **count that went up**, which has
 * three properties this needs: it costs nothing extra, it cannot fire twice for
 * the same event, and it stops on its own when the app is backgrounded.
 *
 * The counters are the only thing compared; nothing here reads a message body or
 * decides whether a message is "important". A chime means "something new is
 * waiting", and the same chime for every whisper, which is what a chat app should
 * sound like.
 */
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useBadges } from '../api/hooks';
import { haptic } from '../lib/haptics';
import { playSound } from '../lib/sound';

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
    // The first reading is the state of the world, not an event: a member opening
    // the app with three unread Whispers should not be chimed at three times.
    if (!before) return;
    if (AppState.currentState !== 'active') return;

    /*
     * A message wins over a notification when both went up in the same poll,
     * because it is the more specific thing and two chimes a second apart reads
     * as a fault, not as two events. The other one is not lost: its count is
     * still higher than the badge the member will see, so the number on the tab
     * is right whether or not a sound played for it.
     */
    if (next.messages > before.messages) {
      void playSound('message');
      haptic.soft();
      return;
    }
    if (next.notifications > before.notifications) {
      void playSound('notification');
      haptic.soft();
    }
  }, [badges.data]);

  return null;
}
