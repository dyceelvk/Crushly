import type { CircleHighlight } from '../api/types';

/**
 * What a Circle's preview tile is being shown for.
 *
 * Every caption is a fact the database counted, not a decoration: the room had
 * the post people reacted to most, or it is the room that has been talking this
 * week. Nothing is inferred and nothing is seeded — a Circle with no reactions
 * and no messages is not a highlight and never reaches this function.
 *
 * The words are this product's. A post is a Crush, so the post that collected
 * the most reactions is the **Most Crushed Post**, not the "most liked" one.
 */
export type HighlightCaption = {
  caption: string;
  icon: 'trophy' | 'chatbubbles-outline' | 'chatbubble-ellipses';
};

export function describeHighlight(h: Pick<CircleHighlight, 'kind' | 'likes' | 'comments'>): HighlightCaption {
  if (h.kind === 'conversation') return { caption: 'Most Talked Conversation', icon: 'chatbubble-ellipses' };
  if (h.comments > h.likes) return { caption: 'Most Talked Post', icon: 'chatbubbles-outline' };
  return { caption: 'Most Crushed Post', icon: 'trophy' };
}
