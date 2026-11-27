/** Small, shared repost presentation/state helpers kept free of React and I/O. */
export function repostAttribution(name: string): string {
  const clean = String(name ?? '').trim();
  return clean ? `${clean} reposted` : 'Someone reposted';
}

export function repostActionLabel(active: boolean): string {
  return active ? 'Undo Repost' : 'Repost to your profile';
}

export function optimisticRepostCount(count: number | null | undefined, before: boolean, next: boolean): number {
  const current = Math.max(0, Number.isFinite(count ?? NaN) ? Number(count) : 0);
  if (before === next) return current;
  return Math.max(0, current + (next ? 1 : -1));
}
