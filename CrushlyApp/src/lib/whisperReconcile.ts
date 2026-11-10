import type { Message } from '../api/types';

/** Remove only IDs the server checked and no longer permits; preserve pending
 * and newly arrived messages. Never keep a cached quote to a removed message. */
export function reconcileWhisperMessages(messages: Message[], checked: ReadonlySet<number>, visible: ReadonlySet<number>): Message[] {
  return messages.filter((m) => m.id <= 0 || !checked.has(m.id) || visible.has(m.id)).map((m) => {
    const quote = Number(m.meta?.replyTo?.id ?? 0);
    if (!checked.has(quote) || visible.has(quote)) return m;
    const { replyTo: _deleted, ...meta } = m.meta;
    return { ...m, meta };
  });
}
