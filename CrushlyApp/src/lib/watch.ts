import type { WatchPost } from '../api/types';

/**
 * What the front page leads with, and how a visitor's search is ordered.
 *
 * Kept out of `service.ts` deliberately: that file imports React Native, so a
 * function living there can only be exercised with a platform mock. These are
 * rules about text — pure, and worth testing on their own.
 */

/**
 * The subjects a visitor's feed and search lead with.
 *
 * Entertainment, animation and football, because those are what somebody who is
 * not a member yet most likely came for. Search still returns everything after
 * them — a wall around three subjects would make search useless the first time
 * somebody typed a name — but these come first, and a page with none of them
 * still shows the room rather than an empty screen.
 */
export const WATCH_CATEGORIES = [
  {
    id: 'football',
    label: 'Football',
    words: ['football', 'soccer', 'premier league', 'la liga', 'serie a', 'bundesliga', 'ligue 1',
      'champions league', 'uefa', 'fifa', 'world cup', 'afcon', 'messi', 'ronaldo', 'neymar', 'mbappe',
      'osimhen', 'salah', 'chelsea', 'arsenal', 'manchester', 'liverpool', 'real madrid', 'barcelona',
      'juventus', 'psg', 'striker', 'derby', 'matchday', 'match day'],
  },
  {
    id: 'animation',
    label: 'Animation',
    words: ['animation', 'animated', 'anime', 'cartoon', 'manga', 'toon', 'pixar', 'disney',
      'naruto', 'one piece', 'jujutsu', 'demon slayer', 'attack on titan', 'studio ghibli'],
  },
  {
    id: 'entertainment',
    label: 'Entertainment',
    words: ['entertainment', 'comedy', 'skit', 'standup', 'stand-up', 'movie', 'film', 'series',
      'netflix', 'celebrity', 'afrobeats', 'amapiano', 'music', 'concert', 'dance', 'challenge', 'viral'],
  },
] as const;

export type WatchCategoryId = typeof WATCH_CATEGORIES[number]['id'];

/** Which of the three a piece of text belongs to, if any. First match wins. */
export function watchCategoryOf(text: string | null | undefined): WatchCategoryId | null {
  const body = (text ?? '').toLowerCase();
  if (!body) return null;
  for (const category of WATCH_CATEGORIES) {
    if (category.words.some((w) => body.includes(w))) return category.id;
  }
  return null;
}

/**
 * Reorder a page of public posts so the three subjects lead.
 *
 * Stable: within each band the server's newest-first order is kept, so the result
 * still reads as a feed rather than three lists stapled together. Nothing is
 * dropped — a page of ordinary posts is still a page of ordinary posts, just
 * after the football.
 */
export function leadWithCategories(posts: WatchPost[]): WatchPost[] {
  const rank = (p: WatchPost) => {
    const id = watchCategoryOf(`${p.body ?? ''} ${p.location ?? ''}`);
    return id == null ? WATCH_CATEGORIES.length : WATCH_CATEGORIES.findIndex((c) => c.id === id);
  };
  return posts
    .map((post, index) => ({ post, index, r: rank(post) }))
    .sort((a, b) => a.r - b.r || a.index - b.index)
    .map((x) => x.post);
}

/**
 * Whether a page has anything in the three subjects at all.
 *
 * The brief was specific: if there is no football, animation or entertainment yet,
 * show what holUpp itself has posted rather than an empty room. This is how the
 * screen knows to say so.
 */
export function hasCategoryLead(posts: WatchPost[]): boolean {
  return posts.some((p) => watchCategoryOf(`${p.body ?? ''} ${p.location ?? ''}`) != null);
}

/**
 * holUpp's own public posts, for when the room is still empty.
 *
 * Same public feed, filtered to the company's accounts, so a visitor lands on
 * something with a voice instead of a blank page.
 */
export function publicWatchHousePosts(posts: WatchPost[]): WatchPost[] {
  const handles = ['holupp', 'info_holup'];
  return posts.filter((p) => p.author?.username && handles.includes(p.author.username.toLowerCase()));
}
