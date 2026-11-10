/**
 * What a Whisper looks like while it is still a request.
 *
 * A Whisper does not open by existing. Asking for one opens the thread — both
 * people are looking at the same conversation — the sender writes up to two
 * messages, and the recipient answers inside that thread: accept, decline, or
 * reply (a reply is consent). This module turns the server's state into the
 * exact words and the composer's rules, so the screen and the tests agree.
 *
 * The rules it encodes, and why each one is here:
 *  - Only a *pending* request limits anyone. Once accepted, a Whisper is a
 *    Whisper: no counters, no prompts.
 *  - The limit is on the sender, and it is two. `remaining` comes from the
 *    server because a deleted message must not reset it.
 *  - The recipient can always answer with a message instead of a button; the
 *    database treats that reply as acceptance.
 *  - Declined and blocked threads stay visible as such and cannot be written to.
 *  - A thread that predates the request model has no state at all, and stays
 *    open. Inventing a request for it would shut conversations people are
 *    already having.
 */

export type WhisperPhase = 'pending' | 'accepted' | 'declined' | 'blocked';

export type WhisperState = {
  state: WhisperPhase;
  /** Messages the sender has spent while waiting for an answer (0–2). */
  sent: number;
  /** True when the caller is the one who asked. */
  requester: boolean;
  /** Messages left to the sender; null once the request is answered. */
  remaining: number | null;
  canSend: boolean;
  /** The recipient has a request to answer, and can answer it right here. */
  needsDecision: boolean;
  /** The recipient has open messaging on — a reply may not need a tap. */
  peerOpen: boolean;
};

export type WhisperBannerKind = 'none' | 'decision' | 'waiting' | 'declined' | 'blocked';

export type WhisperView = {
  kind: WhisperBannerKind;
  title: string;
  body: string;
  /** Whether the composer may be used. */
  canCompose: boolean;
  /** Show Accept/Decline in the thread. */
  showDecision: boolean;
};

const LIMIT = 2;

export function whisperView(whisper: WhisperState | null | undefined, peerName: string): WhisperView {
  // Threads that predate the request model (or a backend that does not speak
  // it) keep working exactly as they did.
  if (!whisper) return { kind: 'none', title: '', body: '', canCompose: true, showDecision: false };

  const name = peerName || 'They';

  if (whisper.state === 'accepted') {
    return { kind: 'none', title: '', body: '', canCompose: whisper.canSend, showDecision: false };
  }

  if (whisper.state === 'declined') {
    return {
      kind: 'declined',
      title: 'This Whisper request was declined',
      body: 'Nothing more can be sent here. Their Space is still open if you want to try again later.',
      canCompose: false,
      showDecision: false,
    };
  }

  if (whisper.state === 'blocked') {
    return {
      kind: 'blocked',
      title: 'This conversation has ended',
      body: 'You can’t send or receive Whispers here.',
      canCompose: false,
      showDecision: false,
    };
  }

  // Pending.
  if (whisper.needsDecision) {
    const waiting = whisper.sent === 1 ? '1 message is waiting' : `${whisper.sent} messages are waiting`;
    return {
      kind: 'decision',
      title: `${name} wants to Whisper`,
      body: `${waiting}. Accept to open the conversation, or decline to close it.`,
      canCompose: whisper.canSend,
      showDecision: true,
    };
  }

  const sent = Math.min(whisper.sent, LIMIT);
  if (whisper.canSend) {
    const left = Math.max(0, LIMIT - sent);
    return {
      kind: 'waiting',
      title: 'Whisper request sent',
      body:
        sent === 0
          ? `You can send ${LIMIT} messages before ${name} answers. Make them count.`
          : `${sent} of ${LIMIT} messages sent — ${left} left until ${name} answers.`,
      canCompose: true,
      showDecision: false,
    };
  }

  return {
    kind: 'waiting',
    title: 'Both messages sent',
    body: whisper.peerOpen
      ? `${name} has open messaging on, so they may reply without accepting first.`
      : `Waiting for ${name} to accept. You’ll be able to write again once they do.`,
    canCompose: false,
    showDecision: false,
  };
}

/** The one-line label a conversation row shows while a request is unanswered. */
export function whisperRowLabel(whisper: WhisperState | null | undefined): string | null {
  if (!whisper || whisper.state !== 'pending') return null;
  if (whisper.needsDecision) return 'Wants to Whisper';
  return whisper.sent > 0 ? `Request sent · ${Math.min(whisper.sent, LIMIT)}/${LIMIT}` : 'Request sent';
}
