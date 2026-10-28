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
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { EmptyState, ErrorState, Skeleton } from '../../components/States';
import { useLayout } from '../../components/Layout';
import { useToast } from '../../components/Toast';
import {
  useCommentOnPost,
  useDeletePost,
  useDeletePostComment,
  useFlow,
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
 * Tapping a post in the Flow opens this instead of an inline bottom sheet, so
 * the post and its conversation get the room they deserve. The author's Space
 * is one tap away, and the post's like, comment and share all live here.
 */
export function PostViewerScreen({ route, navigation }: ScreenProps<'PostViewer'>) {
  const { postId } = route.params;
  const insets = useSafeAreaInsets();
  const { contentWidth, gutter } = useLayout();
  const { colors } = useTheme();
  const toast = useToast();
  const nav = useNavigation<Nav>();

  const flow = useFlow();
  const post = flow.data?.items.find((p) => p.id === postId) ?? null;
  const query = usePostComments(postId);
  const like = useReactToPost();
  const remove = useDeletePost();
  const removeComment = useDeletePostComment(postId);
  const send = useCommentOnPost(postId);
  const [draft, setDraft] = useState('');

  const authorName = post?.mine ? 'You' : post?.author.name ?? '';

  const close = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

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
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + space.sm }}>
        {flow.isLoading || query.isLoading ? (
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

  const comments = query.data?.items ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + space.sm,
          paddingHorizontal: gutter,
          paddingBottom: insets.bottom + space.xxxl,
          gap: space.lg,
          width: '100%',
          maxWidth: contentWidth,
          alignSelf: 'center',
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Author */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingHorizontal: space.sm,
            flex: 1,
          }}
        >
          <Pressable
            onPress={() =>
              post.mine
                ? nav.navigate('Main', { screen: 'Profile' })
                : nav.navigate('UserProfile', { id: post.author.id })
            }
            accessibilityRole="button"
            accessibilityLabel={post.mine ? 'Your Space' : `${authorName}’s Space`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}
          >
            <Avatar
              uri={post.author.photos[0]?.url ?? null}
              name={post.author.name}
              size={38}
              ring={post.author.verified ? 'gold' : undefined}
            />
            <View style={{ flexShrink: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Txt variant="bodyStrong" numberOfLines={1}>
                  {authorName}
                </Txt>
                {post.author.verified ? <VerifiedBadge size={14} /> : null}
              </View>
              <Txt variant="caption" color="textMuted" numberOfLines={1}>
                {[post.author.username ? `@${post.author.username}` : null, timeAgo(post.createdAt)]
                  .filter(Boolean)
                  .join('  ·  ')}
              </Txt>
            </View>
          </Pressable>
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
          {post.mine ? (
            <IconButton
              icon="trash-outline"
              label="Delete post"
              onPress={deletePost}
              color={colors.textMuted}
            />
          ) : (
            <IconButton icon="ellipsis-horizontal" label={`More options for ${authorName}`} color={colors.textMuted} />
          )}
        </View>

        {/* Post body */}
        {post.body ? (
          <View style={{ paddingHorizontal: space.sm }}>
            <Txt variant="body" style={{ fontSize: 17, lineHeight: 24 }} selectable>
              <LinkText text={post.body} bare />
            </Txt>
          </View>
        ) : null}

        {/* Post media */}
        {post.mediaUrl ? (
          <View style={{ marginTop: space.sm, borderRadius: radius.lg, overflow: 'hidden' }}>
            {post.mediaKind === 'video' ? (
              <EditedClip
                uri={mediaSource(mediaUrl(post.mediaUrl)) as string}
                live={post.edit ?? null}
                style={{ width: '100%', aspectRatio: 9 / 16 }}
                autoPlay
                loop
              />
            ) : (
              <Photo
                uri={mediaUrl(post.mediaUrl)}
                style={{ width: '100%', aspectRatio: 4 / 3 }}
                alt={`Post by ${authorName}`}
              />
            )}
          </View>
        ) : null}

        {/* Actions: like, comment, share */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm }}>
          <Pressable
            onPress={toggleLike}
            accessibilityRole="button"
            accessibilityLabel={post.liked ? 'Take back your like' : 'Like'}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 10, borderRadius: radius.md }}
          >
            <Ionicons
              name={post.liked ? 'heart' : 'heart-outline'}
              size={20}
              color={post.liked ? colors.gold : colors.textMuted}
            />
            <Txt variant="caption" color={post.liked ? 'gold' : 'textSecondary'}>
              {post.likeCount > 0 ? String(post.likeCount) : ''}
            </Txt>
          </Pressable>

          <View style={{ width: 1, height: 20, backgroundColor: colors.border, marginHorizontal: 10 }} />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Comments, ${post.commentCount}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 10, borderRadius: radius.md }}
          >
            <Ionicons name="chatbubble-outline" size={20} color={colors.textMuted} />
            <Txt variant="caption" color="textSecondary">
              {post.commentCount > 0 ? String(post.commentCount) : ''}
            </Txt>
          </Pressable>

          <Pressable
            onPress={share}
            accessibilityRole="button"
            accessibilityLabel="Share this post"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 10, borderRadius: radius.md, marginLeft: 12 }}
          >
            <Ionicons name="share-social-outline" size={20} color={colors.textMuted} />
          </Pressable>

          <View style={{ flex: 1 }} />
        </View>

        {/* Comments */}
        <View style={{ paddingHorizontal: space.sm, gap: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Txt variant="label" color="textSecondary">
              Comments
            </Txt>
            <Txt variant="caption" color="textMuted">
              {post.commentCount}
            </Txt>
          </View>

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

        {/* Compose comment */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            gap: 8,
            paddingTop: space.sm,
            paddingHorizontal: space.sm,
            borderTopWidth: 1,
            borderColor: colors.border,
          }}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <Input
              value={draft}
              onChangeText={setDraft}
              placeholder="Write a comment"
              maxLength={1000}
              multiline
              containerStyle={{ minWidth: 0 }}
            />
          </View>
          <Button title="Send" size="sm" onPress={submitComment} loading={send.isPending} disabled={!draft.trim()} />
        </View>
      </ScrollView>

      <Pressable
        onPress={close}
        accessibilityLabel="Close"
        hitSlop={20}
        style={{
          position: 'absolute',
          bottom: insets.bottom + 24,
          right: 24,
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: colors.primary,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: colors.primaryDeep,
          shadowOpacity: 0.4,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 8,
          zIndex: 100,
        }}
      >
        <Ionicons name="close" size={26} color="#fff" />
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
        <Txt variant="caption" color="textMuted">
          {c.mine ? 'You' : c.author.name} · {timeAgo(c.createdAt)}
        </Txt>
        <Txt variant="body" selectable>
          {c.body}
        </Txt>
      </View>
      {c.mine ? (
        <IconButton icon="trash-outline" label="Delete comment" onPress={onDelete} color="textMuted" />
      ) : null}
    </Pressable>
  );
}
