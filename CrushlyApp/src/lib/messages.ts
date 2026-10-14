import type { Message } from '../api/types';
import { STICKERS } from './catalog';

/** One-line conversation preview — shared by the Messages list and search. */
export function messagePreview(m: Message | null, peerName: string): string {
  if (!m) return `You and ${peerName} have a Mutual Crush. Say hello.`;
  const prefix = m.mine ? 'You: ' : '';
  switch (m.kind) {
    case 'text':
      return prefix + m.body;
    case 'photo':
      return `${prefix}Sent a photo`;
    case 'call':
      return `${prefix}Voice call`;
    case 'video':
      return `${prefix}Video note`;
    case 'voice':
      return `${prefix}Voice note`;
    case 'sticker':
      return `${prefix}${STICKERS.find((s) => s.key === m.meta.sticker)?.emoji ?? ''} Sticker`;
    case 'profile':
      return `${prefix}Shared ${m.meta.name ?? 'a'} Space`;
    case 'moment_reply':
      return m.mine ? `You replied to ${peerName}’s Moment` : 'Replied to your Moment';
    default:
      return prefix + (m.body || 'New Whisper');
  }
}

/** Only a fetched page proves that all earlier incoming IDs were observed.
 * A send may race a peer's message; advancing past it silently loses that
 * message until reload. Older overlapping fetches must not move us backwards.
 */
export function nextMessageCursor(current: number, source: 'received' | 'sent', items: { id: number }[]): number {
  return source === 'sent' ? current : items.reduce((cursor, item) => Math.max(cursor, item.id), current);
}

/** Polls can catch up with an already-rendered outgoing message. Keep saved
 * messages unique and in server order, without discarding optimistic drafts.
 */
export function mergeMessagePage(current: Message[], incoming: Message[]): Message[] {
  const saved = new Map<number, Message>();
  for (const message of [...current, ...incoming]) {
    if (message.id > 0) saved.set(message.id, message);
  }
  return [...saved.values()].sort((a, b) => a.id - b.id)
    .concat(current.filter((message) => message.id <= 0));
}
