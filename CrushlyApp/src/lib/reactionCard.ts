/**
 * Whether a tap belongs to the floating card, so the card does not close first.
 *
 * The reaction pop-up dismisses itself on the next press anywhere on the page.
 * That listener runs in the capture phase on the web, which means it sees the
 * press **before** the button under it does — so unless the press is recognised
 * as part of the card, the card is unmounted between pointerdown and click and
 * the button never fires. That is exactly why "Copy text" and "Delete" did
 * nothing: the tap landed, the pop-up vanished, and the press was thrown away
 * with it.
 *
 * Kept as a plain function over a duck-typed `closest` so it can be tested
 * without a DOM, and so the two listeners cannot drift apart.
 */
export const REACTION_UI_SELECTOR = [
  '[data-testid="reaction-row"]',
  '[data-testid="reaction-card"]',
  '[data-testid="reaction-control"]',
].join(', ');

type Closest = (selector: string) => unknown;

/** `target` is a DOM-ish node; anything without `closest` is not ours. */
export function insideReactionUI(target: { closest?: unknown } | null | undefined): boolean {
  const closest = target?.closest as Closest | undefined;
  if (typeof closest !== 'function') return false;
  return !!closest(REACTION_UI_SELECTOR);
}
