import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  View,
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
import { useLayout } from '../../components/Layout';
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
import { EditedClip } from '../../components/EditedClip';
import { mediaUrl } from '../../api/client';
import { mediaSource } from '../../lib/mediaHost';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { timeAgo } from '../../lib/format';
import type { RootStackParamList, ScreenProps } from '../../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * Watching one post — full screen, with comments.
 *
 * Spacious, single-column layout: author header, title, body, media,
 * engagement line, action bar, then comments. Nothing is cramped — every
 * section has room to breathe.
 */
export function PostViewerScreen({ route, navigation }: ScreenProps<'PostViewer'>) {
  const { postId } = route.params;
  const insets = useSafeAreaInsets();
  const { contentWidth, gutter } = useLayout();
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
  const [draft, setDraft] = useState('');
  const [expanded, setExpanded] = useState(false);

  const authorName = post?.mine ? 'You' : post?.author.name ?? '';
  const comments = query.data?.items ?? [];

  const bodyText = post?.body ?? '';
  const firstPeriod = bodyText.indexOf('. ');
  const title = firstPeriod > 0 ? bodyText.slice(0, firstPeriod + 1) : bodyText;
  const rest = firstPeriod > 0 ? bodyText.slice(firstPeriod + 2) : '';
  const hashtags = bodyText.match(/#\w+/g) ?? [];

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

  const share = useCallback(() => {
    if (!post) return;
    void (globalThis as { share?: (o: { message: string }) => Promise<void> }).share?.({
      message: post.body ? `${post.body}\n\n— ${authorName} on Crushly` : `${authorName} on Crushly`,
    });
  }, [post, authorName]);

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

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + space.sm,
          paddingHorizontal: gutter,
          paddingBottom: insets.bottom + space.xxxl,
          gap: space.xl,
          width: '100%',
          alignSelf: 'center',
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Close + more at top */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            paddingHorizontal: space.sm,
            marginTop: space.xs,
          }}
        >
          <Pressable onPress={close} accessibilityLabel="Close" hitSlop={20}>
            <Ionicons name="close" size={24} color={colors.textMuted} />
          </Pressable>
          {post.mine ? (
            <IconButton
              icon="ellipsis-vertical"
              label="More options"
              color={colors.textMuted}
              onPress={() => deletePost()}
            />
          ) : (
            <IconButton
              icon="ellipsis-vertical"
              label="More options"
              color={colors.textMuted}
            />
          )}
        </View>

        {/* Author */}
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
            marginTop: space.xs,
          }}
        >
          <Avatar
            uri={post.author.photos[0]?.url ?? null}
            name={post.author.name}
            size={36}
            ring={post.author.verified ? 'gold' : undefined}
          />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt variant="bodyStrong" numberOfLines={1}>
              {authorName}
            </Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
              {post.author.bio ? (
                <Txt variant="caption" color="textMuted" numberOfLines={1}>
                  {post.author.bio}
                </Txt>
              ) : null}
              {post.author.bio && post.author.username ? (
                <Txt variant="caption" color="textMuted">·</Txt>
              ) : null}
              {post.author.username ? (
                <Txt variant="caption" color="textMuted" numberOfLines={1}>
                  @{post.author.username}
                </Txt>
              ) : null}
            </View>
            <Txt variant="caption" color="textMuted" style={{ marginTop: 2 }}>
              {timeAgo(post.createdAt)}
            </Txt>
          </View>
          <View
            style={{
              borderRadius: 999,
              paddingHorizontal: 8,
              paddingVertical: 3,
              backgroundColor: colors.elevated,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Txt variant="caption" color="textSecondary">
              {post.audience === 'everyone' ? 'Everyone' : 'Connections'}
            </Txt>
          </View>
        </Pressable>

        {/* Title */}
        {title ? (
          <Txt
            variant="title"
            style={{ paddingHorizontal: space.sm, marginTop: space.sm, color: colors.text }}
            numberOfLines={2}
          >
            {title}
          </Txt>
        ) : null}

        {/* Body */}
        {rest || (!title && bodyText) ? (
          <View style={{ paddingHorizontal: space.sm, marginTop: space.sm }}>
            <Txt
              variant="body"
              style={{ lineHeight: 24, color: colors.text }}
              selectable
              numberOfLines={expanded ? undefined : 4}
            >
              {expanded ? rest || bodyText : rest || bodyText}
            </Txt>
            {(rest || bodyText).length > 120 && (
              <Pressable
                onPress={() => setExpanded(!expanded)}
                accessibilityLabel={expanded ? 'Read less' : 'Read more'}
                hitSlop={12}
                style={{ marginTop: 8 }}
              >
                <Txt variant="caption" color="gold">
                  {expanded ? 'Read less' : 'Read more'}
                </Txt>
              </Pressable>
            )}
          </View>
        ) : null}

        {/* Hashtags */}
        {hashtags.length > 0 && (
          <View
            style={{
              paddingHorizontal: space.sm,
              marginTop: space.sm,
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: space.xs,
            }}
          >
            {hashtags.map((tag) => (
              <View
                key={tag}
                style={{
                  backgroundColor: colors.primarySoft,
                  borderRadius: radius.pill,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderWidth: 1,
                  borderColor: colors.primaryLine,
                }}
              >
                <Txt variant="caption" color="gold">
                  {tag}
                </Txt>
              </View>
            ))}
          </View>
        )}

        {/* Media */}
        {post.mediaUrl ? (
          <View style={{ marginTop: space.sm }}>
            {post.mediaKind === 'video' ? (
              <EditedClip
                uri={resolveVideoUri(post.mediaUrl)}
                live={post.edit ?? null}
                style={{ width: '100%', maxHeight: contentWidth * 1.6 }}
                autoPlay
                loop
              />
            ) : (
              <Photo
                uri={mediaUrl(post.mediaUrl)}
                fit="contain"
                contentPosition="center"
                style={{
                  width: '100%',
                  maxHeight: contentWidth * 1.6,
                  borderRadius: radius.lg,
                }}
                alt={`Post by ${authorName}`}
              />
            )}
          </View>
        ) : null}

        {/* Engagement: Likes · Comments */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: space.sm,
            marginTop: space.sm,
          }}
        >
          <Txt variant="bodyStrong" style={{ color: colors.text }}>
            {post.likeCount} Likes
          </Txt>
          <View style={{ width: 4, height: 4, backgroundColor: colors.textMuted, borderRadius: 2, marginHorizontal: 8 }} />
          <Txt variant="bodyStrong" style={{ color: colors.text }}>
            {post.commentCount} Comments
          </Txt>
        </View>

        {/* Action bar: Like · Comment · Save */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            paddingHorizontal: space.sm,
            marginTop: space.sm,
          }}
        >
          <Pressable
            onPress={toggleLike}
            accessibilityRole="button"
            accessibilityLabel={post.liked ? 'Take back your like' : 'Like'}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <Ionicons
              name={post.liked ? 'heart' : 'heart-outline'}
              size={24}
              color={post.liked ? colors.crush : colors.textMuted}
            />
            <Txt variant="bodyStrong" color={post.liked ? colors.crush : colors.textSecondary}>
              Like
            </Txt>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Comment, ${post.commentCount}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <Ionicons name="chatbubble-outline" size={24} color={colors.textMuted} />
            <Txt variant="bodyStrong" color={colors.textSecondary}>
              Comment
            </Txt>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <Ionicons name="bookmark-outline" size={24} color={colors.textMuted} />
            <Txt variant="bodyStrong" color={colors.textSecondary}>Save</Txt>
          </Pressable>
        </View>

        {/* Divider */}
        <View style={{ height: 1, backgroundColor: colors.border, marginVertical: space.sm }} />

        {/* Comments section */}
        <View style={{ paddingHorizontal: space.sm, gap: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Txt variant="bodyStrong" style={{ color: colors.text }}>
              Comments
            </Txt>
            <IconButton icon="chevron-down-outline" size={20} color={colors.textMuted} label="Collapse comments" />
          </View>

          {/* Write a comment input */}
          <View
            style={{
              backgroundColor: colors.elevated,
              borderRadius: radius.lg,
              paddingHorizontal: space.md,
              paddingVertical: space.sm,
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.sm,
            }}
          >
            <Avatar
              uri={me?.profile.photos[0]?.url ?? null}
              size={32}
            />
            <Input
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={submitComment}
              returnKeyType="send"
              placeholder="Write a comment..."
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
              size={36}
              variant="gold"
            />
          </View>

          {/* Comments list */}
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
      </ScrollView>

      <Pressable
        onPress={close}
        accessibilityLabel="Close"
        hitSlop={20}
        style={{
          position: 'absolute',
          top: insets.top + space.sm,
          right: space.sm,
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: colors.elevated,
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100,
        }}
      >
        <Ionicons name="close" size={24} color={colors.textMuted} />
      </Pressable>
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
