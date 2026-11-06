/**
 * What a Whisper's tick means.
 *
 * Five states, and each one is a different fact — which is exactly why they
 * cannot be one boolean and why the screen must never show a state it does not
 * actually know:
 *
 *   sending    it is on my phone and in nobody else's hands yet
 *   sent       the server has it
 *   delivered  their device has it
 *   read       they opened the thread (only when both sides allow receipts)
 *   failed     the server refused it; it can be retried
 *
 * The ladder is computed from the message itself, not from a screen's opinion,
 * so a bubble that arrives late over a socket and a bubble that arrives from a
 * page of history show the same tick.
 */

import type { Message } from '../api/types';

export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

/**
 * Retention: the ladder only climbs. A deliverability fact that arrives out of
 * order — a stale fetch after a fresh socket event — must not walk a message
 * backwards from "read" to "delivered", because that looks like a lie about
 * something the recipient already did.
 */
export function messageStatus(m: Pick<Message, 'mine' | 'pending' | 'failed' | 'readAt' | 'deliveredAt' | 'id'>): MessageStatus | null {
  // Only my own messages carry a status at all. Theirs are not mine to report.
  if (!m.mine) return null;
  if (m.failed) return 'failed';
  if (m.pending) return 'sending';
  if (m.readAt) return 'read';
  if (m.deliveredAt) return 'delivered';
  return 'sent';
}

/** Rank, so two answers about the same message can be reconciled by keeping the later one. */
export function statusRank(s: MessageStatus | null): number {
  switch (s) {
    case 'failed':
      return 0;
    case 'sending':
      return 1;
    case 'sent':
      return 2;
    case 'delivered':
      return 3;
    case 'read':
      return 4;
    default:
      return -1;
  }
}

/**
 * A socket event says "read everything up to id 41". Applying it means moving
 * every one of my messages at or below 41 to that state — but never moving one
 * that is already further along, and never stamping a message that has not even
 * been sent yet (a negative local id is a draft, not a message).
 */
export function applyUpTo(
  messages: Message[],
  upToId: number,
  field: 'deliveredAt' | 'readAt',
  stamp = Date.now(),
): Message[] {
  if (!Number.isFinite(upToId) || upToId <= 0) return messages;
  let changed = false;
  const next = messages.map((m) => {
    if (!m.mine || m.id <= 0 || m.id > upToId) return m;
    if (m[field]) return m;
    changed = true;
    return { ...m, [field]: stamp };
  });
  return changed ? next : messages;
}

/**
 * The number of unread messages from the other side. Used by the inbox and the
 * thread's own "new since you left" rule; kept pure so both can share it.
 */
export function unreadFrom(messages: Pick<Message, 'mine' | 'readAt' | 'id'>[]): number {
  let n = 0;
  for (const m of messages) if (!m.mine && m.id > 0 && !m.readAt) n++;
  return n;
}
