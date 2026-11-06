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

export function describeHighlight(
  h: Pick<CircleHighlight, 'kind' | 'likes' | 'comments'>,
): HighlightCaption | null {
  if (h.kind === 'conversation') return { caption: 'Most Talked Conversation', icon: 'chatbubble-ellipses' };
  /*
   * The database no longer offers a post with nothing on it (see the 1.0.69
   * migration), and this is the same rule stated where the words are chosen: a
   * tile cannot claim "Most Crushed Post" for a post nobody crushed. Null means
   * there is nothing to say, and the tile is not drawn.
   */
  if (h.likes <= 0 && h.comments <= 0) return null;
  if (h.comments > h.likes) return { caption: 'Most Talked Post', icon: 'chatbubbles-outline' };
  return { caption: 'Most Crushed Post', icon: 'trophy' };
}
