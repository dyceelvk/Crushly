import type { NotificationKind } from '../api/types';
export type NotificationCategory = 'all' | 'whispers' | 'posts' | 'addUps' | 'keptClose' | 'moments' | 'circles';
export function fromHolup(kind: NotificationKind): boolean {
  return kind === 'verified' || kind === 'verification_rejected';
}
export function notificationCategory(kind: NotificationKind): Exclude<NotificationCategory, 'all'> | 'holup' {
  switch (kind) {
    case 'message': case 'moment_reply': return 'whispers';
    case 'post_reaction': case 'post_comment': case 'post_mention': return 'posts';
    case 'crush': case 'deep_crush': case 'mutual': return 'addUps';
    case 'keep': return 'keptClose';
    case 'moment_reaction': return 'moments';
    case 'verified': case 'verification_rejected': return 'holup';
    default: return 'circles';
  }
}
