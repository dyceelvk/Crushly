/** At most a few images the reader is about to see, in feed order. Never fetch
 * video bytes or files from messages / Moments as image prefetches. */
export function feedImagePaths(posts: ReadonlyArray<{
  mediaKind: string | null;
  mediaUrl: string | null;
  author: { photos: ReadonlyArray<{ url: string | null }> };
}>, max = 8): string[] {
  const result: string[] = [];
  const add = (path: string | null | undefined) => {
    if (path && !result.includes(path) && result.length < max) result.push(path);
  };
  for (const post of posts) {
    if (post.mediaKind === 'photo') add(post.mediaUrl);
    add(post.author.photos[0]?.url);
    if (result.length >= max) break;
  }
  return result;
}
