/**
 * The words for "are you sure", in one place.
 *
 * Deleting is the only action in holUpp that cannot be taken back, so it asks
 * first — everywhere, the same way. The copy lives here rather than in fifteen
 * screens because it had already drifted: some screens said "Delete this post?"
 * and showed what would happen, some asked nothing at all and deleted the post
 * the instant the bin was touched. A member cannot tell which bin is safe.
 *
 * One title, one sentence, two buttons. A surface may add `detail` when it knows
 * something the member needs — that a Whisper goes for both people, that a
 * Circle member loses their access — but it never changes the question itself.
 */

export const DELETE_COPY = {
  title: 'Delete this item?',
  message: 'Are you sure you want to delete this? This action cannot be undone.',
  confirmLabel: 'Delete',
  cancelLabel: 'Cancel',
} as const;

/** What a caller may pass to say more about the thing being deleted. */
export type DeleteRequest = {
  /** One extra sentence of fact, in the member's words. Optional. */
  detail?: string;
  /** Shown when it worked. Defaults to `Deleted`. */
  successTitle?: string;
  /** Shown when it failed. Defaults to `Not deleted`. */
  errorTitle?: string;
};

/** The toast title after a successful delete. */
export function deleteSuccessTitle(request?: DeleteRequest): string {
  const given = request?.successTitle?.trim();
  return given && given.length > 0 ? given : 'Deleted';
}

/** The toast title after a failed one. */
export function deleteErrorTitle(request?: DeleteRequest): string {
  const given = request?.errorTitle?.trim();
  return given && given.length > 0 ? given : 'Not deleted';
}

/**
 * The sentence under the message: what this particular delete does that a
 * generic warning cannot say. Trailing space is trimmed so an empty string is
 * never rendered as a gap.
 */
export function deleteDetail(detail?: string): string | null {
  const trimmed = detail?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

/**
 * A refusal must never read as success, and a failure must never leave the
 * dialog looking like it is still working. This is the one rule the component
 * follows: while the delete is in flight it is loading; when it throws it stops
 * loading and stays open so the member can try again or cancel.
 */
export function deleteOutcome(ok: boolean): { close: boolean; kind: 'success' | 'error' } {
  return ok ? { close: true, kind: 'success' } : { close: false, kind: 'error' };
}
