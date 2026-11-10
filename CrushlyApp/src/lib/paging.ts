/**
 * Turning a list of pages into one list.
 *
 * Every paged feed in the app does this, and doing it inline four times is how
 * three of them ended up *replacing* the page instead of appending to it: a
 * `useQuery` keyed on the cursor hands back one page at a time, so the screen
 * shows page two and page one is gone. That is what "everything disappears when I
 * scroll down" was, on Home, on Picked and inside a Circle.
 *
 * One function, tested, so the next feed cannot get it wrong quietly.
 */

export type Page = { items: { id: number }[] };

/**
 * All the items of all the pages, in page order.
 *
 * Duplicates are dropped, keeping the first occurrence. They are real: a post
 * published while somebody is reading pushes every older row down by one, so the
 * boundary row can arrive twice — and a duplicated key in a `FlatList` is both a
 * warning and a row that draws twice.
 */
export function pagesToItems<Item extends { id: number }>(pages?: { items: Item[] }[] | null): Item[] {
  if (!pages?.length) return [];
  const seen = new Set<number>();
  const out: Item[] = [];
  for (const page of pages) {
    for (const item of page.items ?? []) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}
