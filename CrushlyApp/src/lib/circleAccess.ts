import type { CircleJoinPolicy, CircleStanding } from '../api/types';

/**
 * What the one button on a Circle should say.
 *
 * The button is never the rule — the database decides everything below — but the
 * button still has to be honest, and there are six honest states. Working them
 * out in one pure function means the card, the preview page and the room itself
 * cannot disagree about whether a room can be walked into.
 *
 * The order matters, and it is the order of the person's own situation:
 *
 *   1. you are in it        → nothing to press
 *   2. you asked            → pending, nothing to press
 *   3. they asked you       → accept, which is a different verb from asking
 *   4. the room is full     → nothing to press, and say why
 *   5. open                 → Join
 *   6. approved             → Request to join
 *   7. invited only         → nothing to press; the owner adds people
 */
export type JoinActionKind = 'member' | 'pending' | 'accept' | 'full' | 'join' | 'request' | 'none';

export type JoinAction = {
  kind: JoinActionKind;
  label: string;
  /** False when the state is a fact rather than something to do. */
  pressable: boolean;
  /** One line under the button, when the label alone would be ambiguous. */
  hint?: string;
};

export function joinAction(input: {
  state: CircleStanding;
  joinPolicy: CircleJoinPolicy;
  full?: boolean;
}): JoinAction {
  const { state, joinPolicy, full } = input;

  if (state === 'member') return { kind: 'member', label: 'You’re in', pressable: false };
  if (state === 'pending') {
    return { kind: 'pending', label: 'Request sent', pressable: false, hint: 'Waiting for the owner.' };
  }
  if (state === 'invited') {
    return { kind: 'accept', label: 'Accept invitation', pressable: true, hint: 'They asked you in.' };
  }
  if (full) return { kind: 'full', label: 'Full', pressable: false, hint: 'Twelve is the limit.' };

  if (joinPolicy === 'open') return { kind: 'join', label: 'Join', pressable: true };
  if (joinPolicy === 'request') return { kind: 'request', label: 'Request to join', pressable: true };
  return { kind: 'none', label: 'Invitation only', pressable: false, hint: 'The owner adds people.' };
}

/**
 * The line under a room's name in a discovery card.
 *
 * Counts rather than adjectives: a room is worth joining because people were in
 * it this week, and "buzzing" is not a number.
 */
export function activityLine(input: { memberCount: number; postsThisWeek: number; messagesThisWeek: number; friendsInside?: number }): string {
  const people = `${input.memberCount}/12`;
  const bits: string[] = [people];
  if (input.postsThisWeek > 0) bits.push(`${input.postsThisWeek} ${input.postsThisWeek === 1 ? 'post' : 'posts'} this week`);
  if (input.messagesThisWeek > 0) bits.push(`${input.messagesThisWeek} ${input.messagesThisWeek === 1 ? 'message' : 'messages'}`);
  if ((input.friendsInside ?? 0) > 0) {
    const n = input.friendsInside as number;
    bits.push(`${n} ${n === 1 ? 'connection' : 'connections'} inside`);
  }
  if (bits.length === 1) bits.push('no activity yet');
  return bits.join(' · ');
}

/** How a room takes people, in the owner's own words, for the settings list. */
export function policyLabel(policy: CircleJoinPolicy): string {
  if (policy === 'open') return 'Anyone can join';
  if (policy === 'invite') return 'Invitation only';
  return 'Ask to join';
}
