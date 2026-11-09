/** Space obscured by the keyboard when Android has not resized the root view. */
export function keyboardOverlap(rootTop: number, rootHeight: number, keyboardTop: number): number {
  if (![rootTop, rootHeight, keyboardTop].every(Number.isFinite) || rootHeight <= 0) return 0;
  return Math.max(0, Math.min(rootHeight, Math.ceil(rootTop + rootHeight - keyboardTop)));
}
