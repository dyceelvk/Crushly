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
      return `${prefix}Voice message`;
    case 'sticker':
      return `${prefix}${STICKERS.find((s) => s.key === m.meta.sticker)?.emoji ?? ''} Sticker`;
    case 'profile':
      return `${prefix}Shared ${m.meta.name ?? 'a'} profile`;
    case 'moment_reply':
      return m.mine ? `You replied to ${peerName}’s Moment` : 'Replied to your Moment';
    default:
      return prefix + (m.body || 'New message');
  }
}
