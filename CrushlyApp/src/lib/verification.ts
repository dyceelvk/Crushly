/** Same-tab navigation is not subject to asynchronous popup blocking. */
export function redirectToVerification(url: string, location: { assign: (url: string) => void }): void {
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.username || target.password) {
    throw new Error('The verification link is invalid. Please try again.');
  }
  location.assign(target.href);
}

export function isVerificationReturn(search: string): boolean {
  return new URLSearchParams(search).get('didit') === 'done';
}

/** Never infer review merely from the existence of a session or a pending badge. */
export function verificationPhase(diditStatus: string | null): 'ready' | 'progress' | 'review' {
  if (diditStatus === 'In Review') return 'review';
  if (diditStatus === 'In Progress') return 'progress';
  return 'ready';
}
