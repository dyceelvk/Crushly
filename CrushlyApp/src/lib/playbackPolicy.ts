/** Screen visibility always wins over a viewer's manual play choice. */
export function playbackAction(paused: boolean, held: 'playing' | 'paused' | null, autoPlay: boolean, ended: boolean): 'play' | 'pause' | 'none' {
  if (paused || held === 'paused') return 'pause';
  if ((held === 'playing' || autoPlay) && !ended) return 'play';
  return 'none';
}

/** No sufficiently visible page means no player is active. */
export function visiblePageIndex(items: readonly { index: number | null }[]): number | null {
  return items[0]?.index ?? null;
}
