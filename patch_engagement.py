import pathlib

def patch(rel, pairs):
    p = pathlib.Path(rel)
    s = p.read_text()
    for old, new in pairs:
        assert old in s, "MISS in %s: %s" % (rel, old[:90])
        s = s.replace(old, new, 1)
    p.write_text(s)
    print(rel + ": ok")

# ---------------------------------------------------------------- types
patch("CrushlyApp/src/api/types.ts", [
("""  audience: PostAudience;
  /** Set when the post was written into a Circle; null everywhere else. */
  circleId: number | null;
  createdAt: number;
  author: Profile;
  mine: boolean;
};""",
"""  audience: PostAudience;
  /** Set when the post was written into a Circle; null everywhere else. */
  circleId: number | null;
  createdAt: number;
  author: Profile;
  mine: boolean;
  /** How many have liked it, whether you are one of them, how many comments. */
  likeCount: number;
  liked: boolean;
  commentCount: number;
};

/** One comment left on a post. */
export type PostComment = {
  id: number;
  body: string;
  createdAt: number;
  mine: boolean;
  author: Profile;
};"""),
])

# -------------------------------------------------------------- service
patch("CrushlyApp/src/api/service.ts", [
("""  Preferences, Privacy, ReplyQuote, NotificationSettings, Profile, MomentStyle, SearchResults, Vibe } from './types';""",
 """  Preferences, Privacy, ReplyQuote, NotificationSettings, PostComment, Profile, MomentStyle, SearchResults, Vibe } from './types';"""),

("""export async function deletePost(postId: number): Promise<void> {
  await rpc<boolean>('delete_post', { p_post_id: postId });
}""",
"""export async function deletePost(postId: number): Promise<void> {
  await rpc<boolean>('delete_post', { p_post_id: postId });
}

/**
 * Liking is one-way news: the author hears about the first like and not about
 * anybody changing their mind afterwards.
 */
export async function reactToPost(postId: number, liked = true): Promise<{ liked: boolean; likeCount: number }> {
  const r = await rpc<{ liked: boolean; likeCount: number }>('react_to_post', {
    p_post_id: postId,
    p_liked: liked,
  });
  return { liked: r?.liked ?? liked, likeCount: r?.likeCount ?? 0 };
}

export async function postComments(postId: number, limit = 50): Promise<{ items: PostComment[] }> {
  const page = await rpc<{ items: PostComment[] }>('post_comments_feed', { p_post_id: postId, p_limit: limit });
  return { items: page?.items ?? [] };
}

export async function commentOnPost(postId: number, body: string): Promise<PostComment> {
  return rpc<PostComment>('comment_on_post', { p_post_id: postId, p_body: str(body, 'Comment', { max: 1000 }) });
}

/** Yours to remove, or the post is yours and the comment was left on it. */
export async function deletePostComment(commentId: number): Promise<void> {
  await rpc<boolean>('delete_post_comment', { p_comment_id: commentId });
}"""),
])

# ---------------------------------------------------------------- hooks
patch("CrushlyApp/src/api/hooks.ts", [
("""  circleMessages: (id: number) => ['circle-messages', id] as const,""",
 """  circleMessages: (id: number) => ['circle-messages', id] as const,
  postComments: (id: number) => ['post-comments', id] as const,"""),

("""export function useDeletePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (postId: number) => service.deletePost(postId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.flow }),
  });
}""",
"""export function useDeletePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (postId: number) => service.deletePost(postId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.flow }),
  });
}

export function useReactToPost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ postId, liked }: { postId: number; liked: boolean }) => service.reactToPost(postId, liked),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.flow }),
  });
}

export function usePostComments(postId: number | null) {
  return useQuery({
    queryKey: keys.postComments(postId ?? 0),
    queryFn: () => service.postComments(postId as number),
    enabled: postId !== null,
  });
}

export function useCommentOnPost(postId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => service.commentOnPost(postId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.postComments(postId) });
      void qc.invalidateQueries({ queryKey: keys.flow });
    },
  });
}

export function useDeletePostComment(postId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (commentId: number) => service.deletePostComment(commentId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.postComments(postId) });
      void qc.invalidateQueries({ queryKey: keys.flow });
    },
  });
}"""),
])
