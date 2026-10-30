/**
 * Which card the reader is actually looking at.
 *
 * A feed reports scroll offset and each card reports its box; this turns those
 * into the one index that is in front of the reader. The rule is a focus line
 * rather than "the most visible card", because a feed is read top-down: the card
 * that should play is the one crossed by a line a little above centre, not the
 * one that happens to be tallest.
 */

export type CardBox = { id: number; y: number; height: number };

/** Where down the screen the reader's attention sits, as a fraction. */
export const FOCUS_LINE = 0.45;

/**
 * The id of the card under the focus line.
 *
 * Falls back to the nearest card when the line falls in a gap (between cards,
 * or above the first one), and to null when there is nothing to choose from.
 */
export function activeIdAt(
  boxes: CardBox[],
  scrollY: number,
  viewportHeight: number,
  focusLine = FOCUS_LINE,
): number | null {
  if (boxes.length === 0) return null;

  const line = scrollY + viewportHeight * focusLine;

  for (const box of boxes) {
    if (line >= box.y && line < box.y + box.height) return box.id;
  }

  // In a gap: the previous card is the one that was being read.
  let best: CardBox | null = null;
  let bestDistance = Infinity;
  for (const box of boxes) {
    const distance = line < box.y ? box.y - line : line - (box.y + box.height);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = box;
    }
  }
  return best ? best.id : null;
}
