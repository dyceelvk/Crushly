import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import * as service from './service';
import type {
  AppNotification, Badges, BlockedMember, ConversationDetail, ConversationSummary, CrushesResponse, CrushResult,
  DiscoverPage, FullProfile, Me, Message, MomentsFeed, Preferences, Privacy, NotificationSettings, Moment,
  Post, PostComment, ReactionKind,
} from './types';

export const keys = {
  me: ['me'] as const,
  discover: ['discover'] as const,
  user: (id: number) => ['user', id] as const,
  crushes: ['crushes'] as const,
  conversations: ['conversations'] as const,
  conversation: (id: number) => ['conversation', id] as const,
  moments: ['moments'] as const,
  flow: ['flow'] as const,
  notifications: ['notifications'] as const,
  badges: ['badges'] as const,
  blocks: ['blocks'] as const,
  circles: ['circles'] as const,
  circle: (id: number) => ['circle', id] as const,
  circleFeed: (id: number) => ['circle-feed', id] as const,
  circleMessages: (id: number) => ['circle-messages', id] as const,
  post: (id: number) => ['post', id] as const,
  postComments: (id: number) => ['post-comments', id] as const,
  closeOnes: ['close-ones'] as const,
  vibes: ['vibes'] as const,
  publicFlow: ['public-flow'] as const,
  update: ['app-update'] as const,
  search: (q: string) => ['search', q] as const,
  keep: (id: number) => ['keep', id] as const,
};

/* ------------------------------------------------------------------ queries */

export const useMe = (enabled = true) =>
  useQuery({ queryKey: keys.me, queryFn: () => service.getMe(), enabled, staleTime: 30_000 });

export const useDiscover = () =>
  useQuery({ queryKey: keys.discover, queryFn: () => service.discover(), staleTime: 60_000 });

export const useUser = (id: number) =>
  useQuery({ queryKey: keys.user(id), queryFn: () => service.loadProfile(id), staleTime: 30_000 });

export const useCrushes = () =>
  useQuery({ queryKey: keys.crushes, queryFn: () => service.crushes(), staleTime: 15_000 });

export const useConversations = () =>
  useQuery({
    queryKey: keys.conversations,
    queryFn: () => service.conversations(),
    staleTime: 5_000,
    refetchInterval: 12_000,
  });

export const useConversation = (id: number) =>
  useQuery({ queryKey: keys.conversation(id), queryFn: () => service.conversation(id) });

export const useMoments = () =>
  useQuery({ queryKey: keys.moments, queryFn: () => service.momentsFeed(), staleTime: 20_000 });

export const useVibes = () =>
  useQuery({ queryKey: keys.vibes, queryFn: () => service.vibesFeed(), staleTime: 20_000 });

/** Debounced by the caller: only queries once the text is worth asking about. */
export const useSearch = (query: string) =>
  useQuery({
    queryKey: keys.search(query),
    queryFn: () => service.searchAll(query),
    enabled: query.trim().length >= 2,
    staleTime: 15_000,
  });

export const usePublicFlow = () =>
  useQuery({ queryKey: keys.publicFlow, queryFn: () => service.publicFlow(), staleTime: 30_000 });

/**
 * Is there a newer build? Only asked on Android, and only every few hours —
 * an update check is not worth a request on every open.
 */
export const useAppUpdate = (currentVersionCode: number) =>
  useQuery({
    queryKey: keys.update,
    queryFn: () => service.appUpdate(),
    enabled: Platform.OS === 'android',
    staleTime: 6 * 60 * 60 * 1000,
    retry: 1,
    select: (u) => ({
      ...u,
      // An update is only an update if the number actually went up, and only
      // worth offering if we can hand over a file.
      available: !!u.apkUrl && u.versionCode > currentVersionCode,
      required: !!u.apkUrl && u.minVersionCode > currentVersionCode,
    }),
  });

export const useNotifications = () =>
  useQuery({
    queryKey: keys.notifications,
    queryFn: () => service.notifications(),
    staleTime: 5_000,
  });

export const useBlocks = () =>
  useQuery({ queryKey: keys.blocks, queryFn: () => service.listBlocks() });

export const useMyCircles = () =>
  useQuery({
    queryKey: keys.circles,
    queryFn: () => service.myCircles(),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

export const useCircle = (circleId: number) =>
  useQuery({
    queryKey: keys.circle(circleId),
    queryFn: () => service.circleSpace(circleId),
    staleTime: 15_000,
  });

/** What a Circle has posted. Paginated like the Flow: older posts load on ask. */
export function useCircleFeed(circleId: number, limit = 20) {
  const [after, setAfter] = useState<number | null>(null);
  const query = useQuery({
    queryKey: [...keys.circleFeed(circleId), limit, after],
    queryFn: () => service.circleFeed(circleId, limit, after),
  });
  const posts = useMemo(() => query.data?.items ?? [], [query.data]);
  return {
    ...query,
    posts,
    loadOlder: () => {
      const oldest = posts[posts.length - 1];
      if (oldest && !query.isFetching) setAfter(oldest.id);
    },
    refresh: () => {
      setAfter(null);
      void query.refetch();
    },
  };
}

/**
 * A room's conversation. Polls rather than subscribes — the same reason Whispers
 * do: it is simple, it survives a dropped socket, and a Circle is a small room
 * where a few seconds' delay costs nothing.
 */
export const useCircleMessages = (circleId: number) =>
  useQuery({
    queryKey: keys.circleMessages(circleId),
    queryFn: () => service.circleMessages(circleId),
    staleTime: 3_000,
    refetchInterval: 8_000,
  });

export const useCloseOnes = () =>
  useQuery({ queryKey: keys.closeOnes, queryFn: () => service.closeOnes(), staleTime: 30_000 });

/** Whether you keep this member close, whether they keep you, and the counts. */
export const useKeepState = (memberId: number, enabled = true) =>
  useQuery({
    queryKey: keys.keep(memberId),
    queryFn: () => service.keepState(memberId),
    enabled: enabled && Number.isFinite(memberId),
    staleTime: 30_000,
  });

/** Polls lightweight counters; pauses while the app is backgrounded. */
export function useBadges(enabled: boolean) {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);
  return useQuery({
    queryKey: keys.badges,
    queryFn: () => service.badges(),
    enabled,
    refetchInterval: active ? 10_000 : false,
  });
}

/* ---------------------------------------------------------------- mutations */

const setMe = (qc: QueryClient) => (me: Me) => qc.setQueryData(keys.me, me);

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Record<string, unknown>) => service.updateProfile(patch),
    onSuccess: (me) => {
      setMe(qc)(me);
      qc.invalidateQueries({ queryKey: keys.discover });
    },
  });
}

export function useUpdatePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prefs: Preferences) => service.updatePreferences(prefs),
    onSuccess: (me) => {
      setMe(qc)(me);
      qc.invalidateQueries({ queryKey: keys.discover });
    },
  });
}

/**
 * Changing a handle is server-side: the database owns the format and the
 * "once a day" rule, so the app just reports what came back.
 */
/**
 * The Flow. Posts do not expire, so this is a normal paginated list rather
 * than a countdown — and it is invalidated whenever anything is posted.
 */
export function useFlow(limit = 20) {
  const [after, setAfter] = useState<number | null>(null);
  const query = useQuery({
    queryKey: [...keys.flow, limit, after],
    queryFn: () => service.flowFeed(limit, after),
  });
  const posts = useMemo(() => query.data?.items ?? [], [query.data]);
  return {
    ...query,
    posts,
    loadOlder: () => {
      const oldest = posts[posts.length - 1];
      if (oldest && !query.isFetching) setAfter(oldest.id);
    },
    refresh: () => {
      setAfter(null);
      void query.refetch();
    },
  };
}

export function useCreatePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof service.createPost>[0]) => service.createPost(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.flow });
      void qc.invalidateQueries({ queryKey: keys.me });
    },
  });
}

export function useDeletePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (postId: number) => service.deletePost(postId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.flow }),
  });
}

export function useReactToPost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ postId, liked, kind }: { postId: number; liked: boolean; kind?: ReactionKind }) =>
      service.reactToPost(postId, liked, kind),
    onSuccess: (_r, vars) => {
      void qc.invalidateQueries({ queryKey: keys.flow });
      void qc.invalidateQueries({ queryKey: keys.post(vars.postId) });
    },
  });
}

/**
 * Rewrite one post wherever it is already on screen.
 *
 * A saved flag and a fresh reaction are both things the eye should see before
 * the network answers, but a post is never in just one place: it is the post
 * view (a `Post` under `keys.post`), and it is also a row inside every feed page
 * that happens to be cached. Patching only the post view would leave the same
 * post un-saved one back-step away.
 *
 * Returns the entries it changed so `onError` can put exactly those back —
 * restoring from a full snapshot of the cache would also discard anything else
 * that settled while the request was in flight.
 */
type PostListPage = { items?: Post[] };

function patchCachedPost(
  qc: QueryClient,
  postId: number,
  update: (post: Post) => Post,
): Array<[readonly unknown[], unknown]> {
  const touched: Array<[readonly unknown[], unknown]> = [];
  const apply = (post: Post | undefined) =>
    post && post.id === postId ? update(post) : post;

  const singleKey = keys.post(postId);
  const single = qc.getQueryData<Post>(singleKey);
  if (single && single.id === postId) {
    touched.push([singleKey, single]);
    qc.setQueryData(singleKey, update(single));
  }

  for (const query of qc.getQueryCache().findAll({ predicate: (q) => isPostListKey(q.queryKey) })) {
    const data = qc.getQueryData<PostListPage | Post[]>(query.queryKey);
    if (!data) continue;
    if (Array.isArray(data)) {
      if (!data.some((p) => p?.id === postId)) continue;
      touched.push([query.queryKey, data]);
      qc.setQueryData(query.queryKey, data.map((p) => apply(p) as Post));
    } else if (Array.isArray(data.items) && data.items.some((p) => p?.id === postId)) {
      touched.push([query.queryKey, data]);
      qc.setQueryData(query.queryKey, { ...data, items: data.items.map((p) => apply(p) as Post) });
    }
  }

  return touched;
}

/** Every cached query whose payload is a page of posts under `items`. */
const POST_LIST_HEADS = ['flow', 'public-flow', 'circle-feed', 'space-posts', 'saved-posts'] as const;

function isPostListKey(key: readonly unknown[]): boolean {
  return POST_LIST_HEADS.includes(key[0] as (typeof POST_LIST_HEADS)[number]);
}

/**
 * Keep a post for later. Silent: the author is never told.
 *
 * Optimistic, because keeping is a private, reversible whim: the bookmark should
 * fill under the finger. The server's answer replaces the guess on success, and
 * a failure puts the bookmark back rather than leaving a lie on screen.
 */
export function useSavePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ postId, saved }: { postId: number; saved: boolean }) => service.savePost(postId, saved),
    onMutate: ({ postId, saved }) => {
      const touched = patchCachedPost(qc, postId, (post) => ({ ...post, saved }));
      return { touched };
    },
    onError: (_e, _v, ctx) => {
      for (const [key, data] of ctx?.touched ?? []) qc.setQueryData(key, data);
    },
    onSuccess: (result, vars) => {
      // The server may disagree (a post whose audience just narrowed comes back
      // unsaved), so the guess is corrected from the answer before the refetch.
      patchCachedPost(qc, vars.postId, (post) => ({ ...post, saved: result.saved }));
      void qc.invalidateQueries({ queryKey: keys.post(vars.postId) });
    },
  });
}

/**
 * Like a comment. The count and the heart come back from the same call.
 *
 * Optimistic for the same reason, and it moves the count with the heart: a
 * heart that fills while the number stays put reads as broken. The result
 * overwrites both, so a double tap that races itself settles on the truth.
 */
export function useLikePostComment(postId: number) {
  const qc = useQueryClient();
  const key = keys.postComments(postId);
  return useMutation({
    mutationFn: ({ commentId, liked }: { commentId: number; liked: boolean }) =>
      service.likePostComment(commentId, liked),
    onMutate: ({ commentId, liked }) => {
      const before = qc.getQueryData<{ items: PostComment[] }>(key);
      if (before?.items) {
        qc.setQueryData(key, {
          ...before,
          items: before.items.map((c) =>
            c.id === commentId
              ? { ...c, liked, likeCount: Math.max(0, (c.likeCount ?? 0) + (liked ? 1 : -1)) }
              : c,
          ),
        });
      }
      return { before };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(key, ctx.before);
    },
    onSuccess: (result, vars) => {
      const current = qc.getQueryData<{ items: PostComment[] }>(key);
      if (current?.items) {
        qc.setQueryData(key, {
          ...current,
          items: current.items.map((c) =>
            c.id === vars.commentId ? { ...c, liked: result.liked, likeCount: result.likeCount } : c,
          ),
        });
      }
      void qc.invalidateQueries({ queryKey: key });
    },
  });
}

/** One post, fetched directly so a post view never depends on the post
 * still sitting in the current feed page. */
export function usePost(postId: number | null) {
  return useQuery({
    queryKey: keys.post(postId ?? 0),
    queryFn: () => service.loadPost(postId as number),
    enabled: postId !== null,
  });
}

export function usePostComments(postId: number | null) {
  return useQuery({
    queryKey: keys.postComments(postId ?? 0),
    queryFn: () => service.postComments(postId as number),
    enabled: postId !== null,
  });
}

/** A comment on the post, or a reply when `parentId` is given. */
export type CommentInput = string | { body: string; parentId?: number | null };

export function useCommentOnPost(postId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CommentInput) => {
      const body = typeof input === 'string' ? input : input.body;
      const parentId = typeof input === 'string' ? null : input.parentId ?? null;
      return service.commentOnPost(postId, body, parentId);
    },
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
}

/* ------------------------------------------------------ keep close, circles */

export function useKeepClose() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (memberId: number) => service.keepClose(memberId),
    onSuccess: (state, memberId) => {
      qc.setQueryData(keys.keep(memberId), state);
      void qc.invalidateQueries({ queryKey: keys.closeOnes });
    },
  });
}

export function useLetGo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (memberId: number) => service.letGo(memberId),
    onSuccess: (_r, memberId) => {
      void qc.invalidateQueries({ queryKey: keys.keep(memberId) });
      void qc.invalidateQueries({ queryKey: keys.closeOnes });
    },
  });
}

export function useCreateCircle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof service.createCircle>[0]) => service.createCircle(input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.circles }),
  });
}

export function useRenameCircle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ circleId, name }: { circleId: number; name: string }) => service.renameCircle(circleId, name),
    onSuccess: (_r, { circleId }) => {
      void qc.invalidateQueries({ queryKey: keys.circles });
      void qc.invalidateQueries({ queryKey: keys.circle(circleId) });
    },
  });
}

export function useDeleteCircle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (circleId: number) => service.deleteCircle(circleId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.circles }),
  });
}

export function useAddCircleMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ circleId, memberId }: { circleId: number; memberId: number }) =>
      service.addCircleMember(circleId, memberId),
    onSuccess: (_r, { circleId }) => void qc.invalidateQueries({ queryKey: keys.circle(circleId) }),
  });
}

export function useRemoveCircleMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ circleId, memberId }: { circleId: number; memberId: number }) =>
      service.removeCircleMember(circleId, memberId),
    onSuccess: (_r, { circleId }) => {
      void qc.invalidateQueries({ queryKey: keys.circle(circleId) });
      void qc.invalidateQueries({ queryKey: keys.circles });
    },
  });
}

export function useLeaveCircle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (circleId: number) => service.leaveCircle(circleId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.circles });
      void qc.invalidateQueries({ queryKey: ['circle-feed'] });
    },
  });
}

export function useCreateCirclePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof service.createPost>[0]) => service.createPost(input),
    onSuccess: (_r, input) => {
      if (input.circleId) void qc.invalidateQueries({ queryKey: keys.circleFeed(input.circleId) });
      void qc.invalidateQueries({ queryKey: keys.flow });
      void qc.invalidateQueries({ queryKey: keys.me });
    },
  });
}

export function useSendCircleMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof service.sendCircleMessage>[0]) => service.sendCircleMessage(input),
    onSuccess: (_r, input) => {
      void qc.invalidateQueries({ queryKey: keys.circleMessages(input.circleId) });
      void qc.invalidateQueries({ queryKey: keys.circles });
    },
  });
}

/** Marks the room read as you look at it. */
export function useReadCircle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (circleId: number) => service.readCircle(circleId),
    onSuccess: (_r, circleId) => void qc.invalidateQueries({ queryKey: keys.circle(circleId) }),
  });
}

export function useSetUsername() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (username: string) => service.setUsername(username),
    onSuccess: (username) => {
      const prev = qc.getQueryData<Me>(keys.me);
      if (prev) qc.setQueryData<Me>(keys.me, { ...prev, profile: { ...prev.profile, username } });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.me }),
  });
}

export function useUpdatePrivacy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Privacy>) => service.updatePrivacy(patch),
    onMutate: async (patch) => {
      // Toggles feel instant; we roll back if the backend disagrees.
      const prev = qc.getQueryData<Me>(keys.me);
      if (prev) qc.setQueryData<Me>(keys.me, { ...prev, privacy: { ...prev.privacy, ...patch } });
      return { prev };
    },
    onError: (_e, _p, ctx) => ctx?.prev && qc.setQueryData(keys.me, ctx.prev),
    onSuccess: setMe(qc),
  });
}

export function useUpdateNotificationSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<NotificationSettings>) => service.updateNotificationSettings(patch),
    onMutate: async (patch) => {
      const prev = qc.getQueryData<Me>(keys.me);
      if (prev) qc.setQueryData<Me>(keys.me, { ...prev, notifications: { ...prev.notifications, ...patch } });
      return { prev };
    },
    onError: (_e, _p, ctx) => ctx?.prev && qc.setQueryData(keys.me, ctx.prev),
    onSuccess: setMe(qc),
  });
}

export function useUploadPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ uri, mimeType }: { uri: string; mimeType?: string }) => service.uploadPhoto(uri, mimeType),
    onSuccess: setMe(qc),
  });
}

export function useDeletePhoto() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: number) => service.deletePhoto(id), onSuccess: setMe(qc) });
}

export function useReorderPhotos() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (ids: number[]) => service.reorderPhotos(ids), onSuccess: setMe(qc) });
}

function removeFromDiscover(qc: QueryClient, id: number) {
  qc.setQueryData<DiscoverPage>(keys.discover, (page) =>
    page ? { ...page, items: page.items.filter((p) => p.id !== id), total: Math.max(0, page.total - 1) } : page,
  );
}

export function useCrush() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, deep, note }: { id: number; deep?: boolean; note?: string }) =>
      service.crush(id, { deep, note }),
    onSuccess: (_res, { id }) => {
      removeFromDiscover(qc, id);
      qc.invalidateQueries({ queryKey: keys.crushes });
      qc.invalidateQueries({ queryKey: keys.user(id) });
      qc.invalidateQueries({ queryKey: keys.me });
      qc.invalidateQueries({ queryKey: keys.badges });
    },
  });
}

export function useUndoCrush() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => service.uncrush(id),
    onSuccess: (_r, id) => {
      qc.invalidateQueries({ queryKey: keys.crushes });
      qc.invalidateQueries({ queryKey: keys.user(id) });
      qc.invalidateQueries({ queryKey: keys.discover });
    },
  });
}

export function usePass() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => service.pass(id),
    onMutate: (id) => removeFromDiscover(qc, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.crushes }),
    onError: () => qc.invalidateQueries({ queryKey: keys.discover }),
  });
}

function invalidateSocial(qc: QueryClient, id: number) {
  removeFromDiscover(qc, id);
  qc.removeQueries({ queryKey: keys.user(id) });
  for (const k of [keys.crushes, keys.conversations, keys.moments, keys.notifications, keys.badges, keys.blocks]) {
    qc.invalidateQueries({ queryKey: k });
  }
}

export function useBlock() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: number) => service.block(id), onSuccess: (_r, id) => invalidateSocial(qc, id) });
}

export function useUnblock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => service.unblock(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.blocks });
      qc.invalidateQueries({ queryKey: keys.discover });
    },
  });
}

export function useReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; reason: string; details?: string; context?: string; alsoBlock?: boolean }) =>
      service.report(id, body),
    onSuccess: (res, { id }) => res.blocked && invalidateSocial(qc, id),
  });
}

export function useRemoveConnection() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: number) => service.removeConnection(id), onSuccess: (_r, id) => invalidateSocial(qc, id) });
}

export function useOpenConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: number) => service.openConversation(userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.conversations }),
  });
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { ids?: number[]; kinds?: string[] } = {}) => service.markNotificationsRead(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.notifications });
      qc.invalidateQueries({ queryKey: keys.badges });
    },
  });
}

export function useMomentReaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, kind }: { id: number; kind: string | null }) => service.reactToMoment(id, kind),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.moments }),
  });
}

/* ------------------------------------------------------------------- chat */

const POLL_MS = 3000;

/**
 * Conversation state: initial page, incremental polling for new messages,
 * paging back through history, and optimistic sends with retry.
 */
export function useChat(conversationId: number) {
  const qc = useQueryClient();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const lastIdRef = useRef(0);
  const lastReadRef = useRef<number | null>(null);

  const markRead = useCallback(() => {
    service.markConversationRead(conversationId).then(() => {
      qc.invalidateQueries({ queryKey: keys.badges });
      qc.invalidateQueries({ queryKey: keys.conversations });
    }).catch(() => {});
  }, [conversationId, qc]);

  const applyReadState = useCallback((lastReadMine: number | null) => {
    lastReadRef.current = lastReadMine;
    if (!lastReadMine) return;
    setMessages((prev) => prev.map((m) => (m.mine && !m.readAt && m.id <= lastReadMine ? { ...m, readAt: Date.now() } : m)));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await service.getMessages(conversationId, { limit: 40 });
      setMessages(res.items);
      setHasMore(res.hasMore);
      lastIdRef.current = res.items.length ? res.items[res.items.length - 1].id : 0;
      markRead();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [conversationId, markRead]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (loading || error) return;
    let cancelled = false;
    const tick = async () => {
      if (AppState.currentState !== 'active') return;
      try {
        const res = await service.getMessages(conversationId, { after: lastIdRef.current });
        if (cancelled) return;
        if (res.items.length) {
          lastIdRef.current = res.items[res.items.length - 1].id;
          setMessages((prev) => {
            const known = new Set(prev.map((m) => m.id));
            return [...prev, ...res.items.filter((m) => !known.has(m.id))];
          });
          if (res.items.some((m) => !m.mine)) markRead();
        }
        if (res.lastReadMine !== lastReadRef.current) applyReadState(res.lastReadMine);
      } catch {
        /* transient; next tick retries */
      }
    };
    const timer = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [conversationId, loading, error, markRead, applyReadState]);

  const loadOlder = useCallback(async () => {
    if (!hasMore || loadingMore || !messages.length) return;
    setLoadingMore(true);
    try {
      const firstId = messages.find((m) => m.id > 0)?.id;
      const res = await service.getMessages(conversationId, { before: firstId, limit: 40 });
      setMessages((prev) => [...res.items, ...prev]);
      setHasMore(res.hasMore);
    } finally {
      setLoadingMore(false);
    }
  }, [conversationId, hasMore, loadingMore, messages]);

  type Draft = service.SendDraft;

  const send = useCallback(
    async (draft: Draft, retryLocalId?: string) => {
      const localId = retryLocalId || `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const optimistic: Message = {
        id: -Date.now(),
        localId,
        conversationId,
        senderId: 0,
        mine: true,
        kind: draft.kind,
        body: draft.kind === 'text' ? draft.body : draft.kind === 'call' ? 'Voice call' : '',
        mediaUrl: draft.kind === 'photo' || draft.kind === 'voice' || draft.kind === 'video' ? draft.uri : null,
        meta: {
          ...(draft.kind === 'sticker'
            ? { sticker: draft.sticker }
            : draft.kind === 'voice' || draft.kind === 'video'
              ? { duration: draft.duration }
              : draft.kind === 'call'
                ? { channel: draft.channel }
                : {}),
          ...(draft.replyQuote ? { replyTo: draft.replyQuote } : {}),
        },
        createdAt: Date.now(),
        readAt: null,
        reactions: [],
        pending: true,
      };
      setMessages((prev) => (retryLocalId ? prev.map((m) => (m.localId === localId ? optimistic : m)) : [...prev, optimistic]));
      try {
        const saved = await service.sendMessage(conversationId, draft);
        lastIdRef.current = Math.max(lastIdRef.current, saved.id);
        setMessages((prev) => {
          const without = prev.filter((m) => m.id !== saved.id);
          return without.map((m) => (m.localId === localId ? saved : m));
        });
        qc.invalidateQueries({ queryKey: keys.conversations });
        return { ok: true as const };
      } catch (e) {
        setMessages((prev) => prev.map((m) => (m.localId === localId ? { ...m, pending: false, failed: true, meta: { ...m.meta, draft } } : m)));
        return { ok: false as const, error: (e as Error).message };
      }
    },
    [conversationId, qc],
  );

  const discard = useCallback((localId: string) => setMessages((prev) => prev.filter((m) => m.localId !== localId)), []);

  const react = useCallback(async (messageId: number, kind = 'crush') => {
    const updated = await service.reactToMessage(messageId, kind);
    setMessages((prev) => prev.map((m) => (m.id === messageId ? updated : m)));
  }, []);

  return { messages, loading, error, reload: load, hasMore, loadOlder, loadingMore, send, discard, react };
}

export type ChatDraft = Parameters<ReturnType<typeof useChat>['send']>[0];

/** Watching someone's Vibe. Never counted for your own. */
export const useViewVibe = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => service.viewVibe(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.vibes }),
  });
};

/** Posts a Vibe. */
export const useCreateVibe = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof service.createVibe>[0]) => service.createVibe(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.vibes }),
  });
};
