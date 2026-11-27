/**
 * What a system notification says, and where tapping it goes.
 *
 * Kept as a pure function for the same reason `soundRules` is: the words are the
 * part that can be wrong, and they can be checked here without a phone.
 *
 * The only thing the app actually knows is the badge counters — how many Whispers
 * and notifications are unread, and the newest notification's kind and body. So
 * nothing here invents a sender's name or a message: it says how many are waiting
 * and lets the tap do the rest. A notification that guessed would be worse than
 * one that admits it only knows the count.
 */
import type { Badges, NotificationKind } from '../api/types';

export type AlertRoute = 'messages' | 'notifications';

export interface SystemAlert {
  title: string;
  body: string;
  route: AlertRoute;
  /** Stable per event so Android replaces rather than stacks duplicates. */
  id: string;
}

/** The one-line title for each kind of thing that can arrive. */
export function titleForKind(kind: NotificationKind | null | undefined): string {
  switch (kind) {
    case 'crush': return 'New Add Up';
    case 'deep_crush': return 'Somebody is really into you';
    case 'mutual': return 'It is mutual';
    case 'moment_reply': return 'A reply to your Moment';
    case 'moment_reaction': return 'A reaction to your Moment';
    case 'verified': return 'You are verified';
    case 'verification_rejected': return 'About your verification';
    case 'post_reaction': return 'A reaction to your post';
    case 'post_comment': return 'A new comment';
    case 'post_repost': return 'Somebody reposted your post';
    case 'post_mention': return 'Somebody mentioned you';
    case 'keep': return 'Somebody is keeping you close';
    case 'message': return 'New Whisper';
    default: return 'holUpp';
  }
}

/**
 * One Whisper is "a Whisper"; more than one is a number, because "2 new
 * Whispers" is information and "You have new Whispers" is not.
 */
function whisperBody(unread: number): string {
  const n = Math.max(1, Math.round(unread));
  return n === 1 ? 'A Whisper is waiting for you.' : `${n} new Whispers are waiting.`;
}

export function systemAlertFor(
  kind: 'message' | 'notification',
  badges: Pick<Badges, 'messages' | 'notifications' | 'latestNotification'>,
): SystemAlert {
  if (kind === 'message') {
    return {
      title: 'New Whisper',
      body: whisperBody(badges.messages),
      route: 'messages',
      id: `whisper-${badges.messages}`,
    };
  }
  const latest = badges.latestNotification;
  return {
    title: titleForKind(latest?.kind),
    // The server already wrote this sentence for the notification centre; reusing
    // it keeps the notification and the list from disagreeing.
    body: latest?.body?.trim() || (badges.notifications > 1 ? `${badges.notifications} new notifications` : 'You have a new notification.'),
    route: 'notifications',
    id: `notification-${latest?.id ?? badges.notifications}`,
  };
}
