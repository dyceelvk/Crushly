import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  PanResponder,
  Pressable,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { LinkText } from '../../components/LinkText';
import { Avatar, Photo } from '../../components/Photo';
import { VerifiedBadge } from '../../components/Badges';
import { IconButton } from '../../components/IconButton';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { EmptyState, ErrorState, Skeleton } from '../../components/States';
import { BottomSheet } from '../../components/BottomSheet';
import { useToast } from '../../components/Toast';
import {
  useCommentOnPost,
  useDeletePost,
  useDeletePostComment,
  useFlow,
  useMe,
  usePost,
  usePostComments,
  useReactToPost,
} from '../../api/hooks';
import type { Post, PostComment } from '../../api/types';
import { mediaUrl } from '../../api/client';
import { mediaSource } from '../../lib/mediaHost';
import { EditedClip } from '../../components/EditedClip';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { timeAgo } from '../../lib/format';
import type { RootStackParamList, ScreenProps } from '../../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const SWIPE_THRESHOLD = 60;

/**
 * Watching one post — full screen, immersive.
 *
 * Layout per user spec:
 *   Back button (top-left)  ·  Three dots (top-right)
 *   Profile row (left, below back button)
 *   Media (center, large)
 *   Action column (right side, lower): Like · Comment · Save
 *   Caption (bottom-left)
 */
export function PostViewerScreen({ route, navigation }: ScreenProps<'PostViewer'>) {
  const { postId } = route.params;
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { colors } = useTheme();
  const toast = useToast();
  const nav = useNavigation<Nav>();

  const { data: me } = useMe();
  const flow = useFlow();
  const postQuery = usePost(postId);
  const post = postQuery.data ?? flow.data?.items.find((p) => p.id === postId) ?? null;
  const query = usePostComments(postId);
  const like = useReactToPost();
  const remove = useDeletePost();
  const removeComment = useDeletePostComment(postId);
  const send = useCommentOnPost(postId);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [threeDotsOpen, setThreeDotsOpen] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  const authorName = post?.mine ? 'You' : post?.author.name ?? '';
  const comments = query.data?.items ?? [];

  const close = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const resolveVideoUri = useCallback((mediaPath: string | null) => {
    if (!mediaPath) return '';
    const resolved = mediaSource(mediaUrl(mediaPath));
    return typeof resolved === 'string' ? resolved : resolved.uri;
  }, []);

  const toggleLike = useCallback(async () => {
    if (!post) return;
    try {
      await like.mutate({ postId: post.id, liked: !post.liked });
    } catch (e) {
      toast({ kind: 'error', title: 'Like not sent', message: (e as Error).message });
    }
  }, [post, like, toast]);

  const toggleSave = useCallback(() => {
    setIsSaved((prev) => {
      const next = !prev;
      toast({ kind: next ? 'success' : 'info', title: next ? 'Post saved' : 'Post unsaved' });
      return next;
    });
  }, []);

  const deletePost = useCallback(async () => {
    if (!post) return;
    try {
      await remove.mutateAsync(post.id);
      toast({ kind: 'success', title: 'Post deleted' });
      close();
    } catch (e) {
      toast({ kind: 'error', title: 'Not deleted', message: (e as Error).message });
    }
  }, [post, remove, close, toast]);

  const submitComment = useCallback(async () => {
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    try {
      await send.mutateAsync(body);
    } catch (e) {
      setDraft(body);
      toast({ kind: 'error', title: 'Comment not added', message: (e as Error).message });
    }
  }, [draft, send, toast]);

  const deleteComment = useCallback(async (id: number) => {
    try {
      await removeComment.mutateAsync(id);
    } catch (e) {
      toast({ kind: 'error', title: 'Comment not removed', message: (e as Error).message });
    }
  }, [removeComment, toast]);

  const openThreeDots = useCallback(() => {
    setThreeDotsOpen(true);
  }, []);

  // Vertical swipe down closes the viewer and returns to feed at scroll position.
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dy) > SWIPE_THRESHOLD,
      onPanResponderEnd: (_, gestureState) => {
        if (!post) return;
        if (gestureState.dy > SWIPE_THRESHOLD) {
          close();
        }
      },
    }),
  ).current;

  if (!post) {
    const loading = (flow.isLoading || postQuery.isLoading) && postQuery.data === undefined;
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + space.sm }}>
        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="large" color={colors.gold} />
          </View>
        ) : (
          <EmptyState
            icon="prism-outline"
            title="This post is gone"
            message="The post has been removed."
            action={{ label: 'Close', onPress: close }}
          />
        )}
      </View>
    );
  }

  const mediaUri = post.mediaUrl ? resolveVideoUri(post.mediaUrl) : '';
  const isVideo = post.mediaKind === 'video';
  const hasMedia = !!post.mediaUrl;

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {/* PanResponder for vertical swipe — covers the whole screen. */}
      <View {...panResponder.panHandlers} style={{ flex: 1, backgroundColor: '#000' }}>

        {/* Top header: Back button left, three dots right */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            paddingHorizontal: space.sm,
            paddingTop: Math.max(insets.top, space.sm),
          }}
        >
          <Pressable onPress={close} accessibilityLabel="Close" hitSlop={20}>
            <Ionicons name="close" size={24} color="#fff" />
          </Pressable>
          <Pressable
            accessibilityLabel="More options"
            hitSlop={20}
            onPress={openThreeDots}
            style={{ padding: 10 }}
          >
            <Ionicons name="ellipsis-vertical" size={24} color="#fff" />
          </Pressable>
        </View>

        {/* Profile row — left side, below back button */}
        <Pressable
          onPress={() =>
            post.mine
              ? nav.navigate('Main', { screen: 'Profile' })
              : nav.navigate('UserProfile', { id: post.author.id })
          }
          accessibilityRole="button"
          accessibilityLabel={post.mine ? 'Your Space' : `${authorName}’s Space`}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingHorizontal: space.sm,
            marginTop: space.sm,
          }}
        >
          <Avatar
            uri={post.author.photos[0]?.url ?? null}
            name={post.author.name}
            size={34}
            ring={post.author.verified ? 'gold' : undefined}
          />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt variant="bodyStrong" numberOfLines={1} style={{ color: '#fff' }}>
              {authorName}
            </Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
              {post.author.bio ? (
                <Txt variant="caption" color="#fff" numberOfLines={1} style={{ opacity: 0.9 }}>
                  {post.author.bio}
                </Txt>
              ) : null}
              {post.author.bio && post.author.username ? (
                <Txt variant="caption" color="#fff">·</Txt>
              ) : null}
              {post.author.username ? (
                <Txt variant="caption" color="#fff" numberOfLines={1} style={{ opacity: 0.9 }}>
                  @{post.author.username}
                </Txt>
              ) : null}
            </View>
          </View>
          {post.mine ? (
            <Ionicons name="ellipsis-vertical" size={20} color="rgba(255,255,255,0.7)" />
          ) : null}
        </Pressable>

        {/* Media — fills center of screen */}
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', marginTop: space.sm }}>
          {hasMedia && mediaUri ? (
            <View style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
              {isVideo ? (
                <EditedClip
                  uri={mediaUri}
                  live={post.edit ?? null}
                  style={{ width: '100%', height: '100%' }}
                  autoPlay
                  loop
                  contentFit="contain"
                />
              ) : (
                <Photo
                  uri={mediaUrl(post.mediaUrl)}
                  fit="contain"
                  contentPosition="center"
                  style={{ width: '100%', height: '100%' }}
                  alt={`Post by ${authorName}`}
                />
              )}
            </View>
          ) : null}

          {/* Text-only post fallback */}
          {!hasMedia && post.body ? (
            <View style={{ paddingHorizontal: space.xl, paddingTop: Math.max(insets.top, space.xl), gap: space.lg }}>
              <Txt variant="title" style={{ color: '#fff' }} numberOfLines={4}>
                {post.body}
              </Txt>
            </View>
          ) : null}
        </View>

        {/* Right-side action column — Like, Comment, Save (kept low and subtle) */}
        <View
          style={{
            position: 'absolute',
            right: space.sm,
            bottom: Math.max(insets.bottom, space.sm) + 110,
            gap: space.sm,
          }}
        >
          <Pressable
            onPress={toggleLike}
            accessibilityRole="button"
            accessibilityLabel={post.liked ? 'Take back your crush' : 'Crush'}
            hitSlop={20}
            style={{
              width: 46,
              height: 46,
              borderRadius: 23,
              backgroundColor: 'rgba(0,0,0,0.3)',
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.25)',
            }}
          >
            <Ionicons name={post.liked ? 'heart' : 'heart-outline'} size={22} color={post.liked ? colors.crush : '#fff'} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Comment, ${post.commentCount}`}
            hitSlop={20}
            onPress={() => setCommentsOpen(true)}
            style={{
              width: 46,
              height: 46,
              borderRadius: 23,
              backgroundColor: 'rgba(0,0,0,0.3)',
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.25)',
            }}
          >
            <Ionicons name="chatbubble-outline" size={22} color="#fff" />
          </Pressable>
          <Pressable
            onPress={toggleSave}
            accessibilityRole="button"
            accessibilityLabel={isSaved ? 'Unsave post' : 'Save post'}
            hitSlop={20}
            style={{
              width: 46,
              height: 46,
              borderRadius: 23,
              backgroundColor: isSaved ? colors.crush : 'rgba(0,0,0,0.3)',
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.25)',
            }}
          >
            <Ionicons name={isSaved ? 'bookmark' : 'bookmark-outline'} size={22} color="#fff" />
          </Pressable>
        </View>

        {/* Caption — bottom-left */}
        {post.body ? (
          <View
            style={{
              position: 'absolute',
              bottom: Math.max(insets.bottom, space.sm) + 10,
              left: space.sm,
              right: space.sm,
              maxWidth: width - space.xl,
            }}
          >
            <Txt
              variant="body"
              style={{
                color: '#fff',
                fontSize: 16,
                lineHeight: 22,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowRadius: 8,
                shadowOpacity: 0.95,
              }}
            >
              <LinkText text={post.body} bare />
            </Txt>
          </View>
        ) : null}
      </View>

      {/* Slide-up comments panel */}
      <BottomSheet
        visible={commentsOpen}
        onClose={() => setCommentsOpen(false)}
        title={`Comments · ${comments.length}`}
        maxHeight={0.9}
      >
        <View style={{ gap: space.sm }}>
          {query.isLoading ? (
            <Skeleton style={{ height: 60 }} />
          ) : query.isError ? (
            <ErrorState onRetry={() => void query.refetch()} />
          ) : comments.length === 0 ? (
            <Txt variant="body" color="textMuted" style={{ paddingVertical: space.lg, textAlign: 'center' }}>
              No comments yet. Be the first.
            </Txt>
          ) : (
            comments.map((c) => (
              <CommentRow key={c.id} comment={c} onDelete={() => deleteComment(c.id)} />
            ))
          )}
        </View>
        {/* Fixed comment input bar at bottom of sheet */}
        <View
          style={{
            backgroundColor: colors.elevated,
            borderRadius: radius.lg,
            paddingHorizontal: space.md,
            paddingVertical: space.sm,
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm,
            borderWidth: 1,
            borderColor: colors.border,
            marginTop: space.sm,
          }}
        >
          <Avatar uri={me?.profile.photos[0]?.url ?? null} size={30} />
          <Input
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={submitComment}
            returnKeyType="send"
            placeholder="Write a comment…"
            maxLength={1000}
            containerStyle={{ minWidth: 0 }}
            style={{ color: colors.text, flex: 1 }}
          />
          <IconButton
            icon="arrow-up"
            label="Send comment"
            onPress={submitComment}
            disabled={!draft.trim()}
            color={colors.crush}
            size={34}
            variant="gold"
          />
        </View>
      </BottomSheet>

      {/* Three dots action sheet (author: delete; others: report / remove crush) */}
      <BottomSheet
        visible={threeDotsOpen}
        onClose={() => setThreeDotsOpen(false)}
        title={post.mine ? 'Your post' : 'Options'}
        maxHeight={0.6}
      >
        <View style={{ gap: space.sm }}>
          {!post.mine ? (
            <>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setThreeDotsOpen(false);
                  toast({ kind: 'info', title: 'Report sent' });
                }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: space.md }}
              >
                <Ionicons name="alert-circle-outline" size={20} color={colors.danger} />
                <Txt variant="body" color="#000">
                  Report post
                </Txt>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setThreeDotsOpen(false);
                  toast({ kind: 'info', title: 'Crush removed' });
                }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: space.md }}
              >
                <Ionicons name="remove" size={20} color={colors.danger} />
                <Txt variant="body" color="#000">
                  Remove crush
                </Txt>
              </Pressable>
            </>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={deletePost}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: space.md }}
            >
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
              <Txt variant="body" color="#000">
                Delete post
              </Txt>
            </Pressable>
          )}
        </View>
      </BottomSheet>
    </View>
  );
}

function CommentRow({ comment: c, onDelete }: { comment: PostComment; onDelete: () => void }) {
  const nav = useNavigation<Nav>();
  const { colors } = useTheme();

  return (
    <Pressable
      onPress={() =>
        c.mine
          ? nav.navigate('Main', { screen: 'Profile' })
          : nav.navigate('UserProfile', { id: c.author.id })
      }
      accessibilityRole="button"
      style={{ flexDirection: 'row', gap: 10, paddingVertical: space.sm }}
    >
      <Avatar uri={c.author.photos[0]?.url ?? null} name={c.author.name} size={32} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="bodyStrong" style={{ color: colors.text }} numberOfLines={1}>
          {c.mine ? 'You' : c.author.name}
        </Txt>
        <Txt variant="body" style={{ color: colors.text, lineHeight: 20 }} selectable>
          {c.body}
        </Txt>
      </View>
      {c.mine ? (
        <IconButton icon="trash-outline" label="Delete comment" onPress={onDelete} color="textMuted" />
      ) : null}
    </Pressable>
  );
}
