/**
 * Per-call realtime channel naming. Kept pure (no react-native imports) so it
 * is unit-testable in plain Node.
 */

/** Random per-call channel name — unguessable, so only the invited member joins. */
export function newCallChannel(randomBytes?: Uint8Array): string {
  const bytes = randomBytes ?? globalThis.crypto?.getRandomValues(new Uint8Array(16));
  if (!bytes || bytes.length !== 16) throw new Error('Secure calling is unavailable.');
  return `call-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Keep the invitation token in the RPC payload, not just the optimistic UI. */
export function callMessageMeta(channel: string): { channel: string } {
  if (!/^call-[a-z0-9-]{16,100}$/.test(channel)) throw new Error('Invalid call invitation.');
  return { channel };
}
