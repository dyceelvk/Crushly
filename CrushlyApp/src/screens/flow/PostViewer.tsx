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
 * Edge-to-edge media, caption overlay bottom-left, author profile tappable,
 * right-side action column (Crush · comment · Space), vertical swipe down to
 * close and return to the feed at its position, and a slide-up comments panel
 * with a fixed input bar at the bottom.
 *
 * Posts with no media (text-only) stay in the feed — tapping them does nothing,
 * so this screen only opens for media posts.
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
  // The post is looked up directly first: a post view must not go empty just
  // because the post scrolled out of the current feed page.
  const postQuery = usePost(postId);
  const post = postQuery.data ?? flow.data?.items.find((p) => p.id === postId) ?? null;
  const query = usePostComments(postId);
  const like = useReactToPost();
  const remove = useDeletePost();
  const removeComment = useDeletePostComment(postId);
  const send = useCommentOnPost(postId);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [draft, setDraft] = useState('');

  const authorName = post?.mine ? 'You' : post?.author.name ?? '';
  const comments = query.data?.items ?? [];

  const close = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  // mediaSource() returns a plain string on web but { uri, headers } on native
  // when the file lives behind the media Worker. Extract the URI string so
  // EditedClip receives a usable value on every platform.
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

  // Vertical swipe between posts: pan down closes the viewer and returns to
  // the feed at its scroll position. Pan up is reserved for future next-post
  // navigation once adjacent post IDs are exposed by the feed.
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
        {/* Close / more header, top edge-to-edge */}
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
            onPress={() => void deletePost()}
            style={{ padding: 10 }}
          >
            <Ionicons name="ellipsis-vertical" size={24} color="#fff" />
          </Pressable>
        </View>

        {/* Media + caption overlay — fills the screen */}
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          {hasMedia && mediaUri ? (
            <View style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
              {isVideo ? (
                <EditedClip
                  uri={mediaUri}
                  live={post.edit ?? null}
                  style={{ width: '100%', height: '100%' }}
                  autoPlay
                  loop
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
              {/* Caption overlay, bottom-left */}
              {post.body ? (
                <View
                  style={{
                    position: 'absolute',
                    bottom: Math.max(insets.bottom, space.lg) + 60,
                    left: space.md,
                    right: space.md,
                    maxWidth: width - space.xl,
                  }}
                >
                  <Txt
                    variant="body"
                    style={{
                      color: '#fff',
                      fontSize: 18,
                      lineHeight: 26,
                      shadowColor: '#000',
                      shadowOffset: { width: 0, height: 2 },
                      shadowRadius: 6,
                      shadowOpacity: 0.8,
                    }}
                  >
                    <LinkText text={post.body} bare />
                  </Txt>
                </View>
              ) : null}
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

        {/* Author row, bottom-left */}
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
            position: 'absolute',
            bottom: Math.max(insets.bottom, space.sm) + 70,
            left: space.sm,
            right: space.sm,
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
        </Pressable>

        {/* Right-side action column: Crush · comment · Space */}
        <View style={{ position: 'absolute', right: space.sm, top: Math.max(insets.top, space.sm) + 56, gap: space.sm }}>
          <Pressable
            onPress={toggleLike}
            accessibilityRole="button"
            accessibilityLabel={post.liked ? 'Take back your crush' : 'Crush'}
            hitSlop={20}
            style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              backgroundColor: 'rgba(0,0,0,0.4)',
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.3)',
            }}
          >
            <Ionicons name={post.liked ? 'heart' : 'heart-outline'} size={24} color={post.liked ? colors.crush : '#fff'} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Comment, ${post.commentCount}`}
            hitSlop={20}
            onPress={() => setCommentsOpen(true)}
            style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              backgroundColor: 'rgba(0,0,0,0.4)',
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.3)',
            }}
          >
            <Ionicons name="chatbubble-outline" size={24} color="#fff" />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save"
            hitSlop={20}
            style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              backgroundColor: 'rgba(0,0,0,0.4)',
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.3)',
            }}
          >
            <Ionicons name="bookmark-outline" size={24} color="#fff" />
          </Pressable>
        </View>
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
      </BottomSheet>

      {/* Fixed comment input bar at bottom, keyboard-avoiding */}
      <View
        style={{
          position: 'absolute',
          bottom: Math.max(insets.bottom, space.sm),
          left: 0,
          right: 0,
          paddingHorizontal: space.sm,
        }}
      >
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
      </View>

      {post.mine ? (
        <BottomSheet
          visible={false}
          onClose={() => {}}
          title="Your post"
        >
          <Pressable onPress={deletePost} style={{ padding: space.md }}>
            <Ionicons name="trash-outline" size={20} color={colors.danger} />
          </Pressable>
        </BottomSheet>
      ) : null}
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
