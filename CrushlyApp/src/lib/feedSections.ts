/**
 * Where the non-post sections sit in a feed.
 *
 * Connections is not a list of posts with a header bolted on: a room worth
 * joining and what is happening inside your own rooms belong *between* posts, so
 * that scrolling past them is the same gesture as scrolling past anything else.
 * A block pinned above the feed is an advertisement; a block you scroll to is a
 * part of the feed.
 *
 * So the page is built as one list of rows — items and section markers — and the
 * markers are placed by position. Keeping that arithmetic here rather than in
 * the screen is what makes it testable: a feed of forty posts and a feed of none
 * both have to put the sections somewhere sensible, and the second one is the
 * case that usually goes wrong.
 */
export type FeedRow<T> = { kind: 'item'; item: T; key: string } | { kind: 'section'; key: string };

/**
 * `after` is how many items come before the section. A section placed after the
 * first post has `after: 1`.
 *
 * A section whose position is past the end of the feed is appended rather than
 * dropped: an empty Connections page still has to show what a person could join,
 * or the page is a dead end with a button on it.
 */
export function buildFeedRows<T>(
  items: T[],
  sections: { after: number; key: string }[],
  itemKey: (item: T, index: number) => string,
): FeedRow<T>[] {
  const ordered = [...sections].sort((a, b) => a.after - b.after);
  const rows: FeedRow<T>[] = [];
  let next = 0;

  const flush = (upTo: number) => {
    for (let i = next; i < Math.min(upTo, items.length); i += 1) {
      rows.push({ kind: 'item', item: items[i], key: itemKey(items[i], i) });
    }
    next = Math.max(next, Math.min(upTo, items.length));
  };

  for (const section of ordered) {
    flush(section.after);
    rows.push({ kind: 'section', key: section.key });
  }
  flush(items.length);
  return rows;
}
