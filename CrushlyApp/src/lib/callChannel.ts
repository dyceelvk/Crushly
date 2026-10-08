/**
 * Per-call realtime channel naming. Kept pure (no react-native imports) so it
 * is unit-testable in plain Node.
 */

/** Random per-call channel name — unguessable, so only the invited member joins. */
export function newCallChannel(): string {
  const rnd = () => Math.random().toString(36).slice(2, 10);
  return `call-${Date.now().toString(36)}-${rnd()}${rnd()}`;
}
