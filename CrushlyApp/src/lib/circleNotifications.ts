/**
 * What a Circle says in Notifications, and where saying it leads.
 *
 * All five are about a room, and the payload is always the room: `refId` is a
 * Circle id and the body is the Circle's name. That makes the sentence easy
 * ("Riel let you into Sunday Go Sharp") and the destination unambiguous.
 *
 * The one that needed care is the pair of `approved`/`joined`. Being let into a
 * room and somebody getting into *your* room are the same database event read
 * from opposite ends, and an earlier version sent the same kind to both ends —
 * which told the owner they had been approved by the person they approved. Two
 * kinds, two sentences, and each end reads its own.
 */
import type { AppNotification } from '../api/types';

export type CircleNotificationKind = Extract<AppNotification['kind'], 'circle_request' | 'circle_approved' | 'circle_joined' | 'circle_declined' | 'circle_invite'>;

export const isCircleNotification = (kind: string): kind is CircleNotificationKind => kind.startsWith('circle_');

/** The sentence, from the side of whoever is reading it. */
export function circleNotificationText(
  kind: CircleNotificationKind,
  room: string,
  actorName = 'Someone',
): { title: string; detail?: string } {
  switch (kind) {
    case 'circle_request':
      return { title: `${actorName} asked to join ${room}.`, detail: 'Say yes or no from the Circle.' };
    case 'circle_approved':
      return { title: `${actorName} let you into ${room}.`, detail: 'The whole room is open to you now.' };
    case 'circle_joined':
      // You own the room and somebody got in — by asking, by accepting your
      // invitation, or by walking into an open room.
      return { title: `${actorName} is now in ${room}.` };
    case 'circle_declined':
      return { title: `${actorName} didn’t let you into ${room}.`, detail: 'Nothing else changes — it can be asked again later.' };
    case 'circle_invite':
      return { title: `${actorName} invited you into ${room}.`, detail: 'Open it to accept.' };
  }
}

export type CircleDestination =
  | { screen: 'CircleManage'; params: { circleId: number; tab: 'requests' } }
  | { screen: 'Circle'; params: { circleId: number } }
  | { screen: 'CirclePreview'; params: { circleId: number } };

/**
 * A request is work, so it opens the owner's Requests list. Membership news
 * opens the room. A decline or an invitation opens the preview — the place a
 * person who is not in the room can see where they stand, and, for an
 * invitation, the door.
 */
export function circleRoute(kind: CircleNotificationKind, circleId: number): CircleDestination | null {
  if (!circleId) return null;
  if (kind === 'circle_request') return { screen: 'CircleManage', params: { circleId, tab: 'requests' } };
  if (kind === 'circle_approved' || kind === 'circle_joined') return { screen: 'Circle', params: { circleId } };
  return { screen: 'CirclePreview', params: { circleId } };
}
