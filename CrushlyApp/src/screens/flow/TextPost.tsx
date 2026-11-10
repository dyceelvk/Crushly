import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { LinkText } from '../../components/LinkText';
import { Avatar } from '../../components/Photo';
import { VerifiedBadge } from '../../components/Badges';
import { CommentsSheet } from '../../components/feed/CommentsSheet';
import { ShareToWhisper } from '../../components/ShareToWhisper';
import { EmptyState, LoadingBlock } from '../../components/States';
import { ReactionButton, reactionLook } from '../../components/feed/Reactions';
import { useProfileTap } from '../../lib/useProfileTap';
import { useTrackPostView } from '../../lib/useTrackPostView';
import { useMemberActions } from '../../state/memberActions';
import { useToast } from '../../components/Toast';
import { useLayout } from '../../components/Layout';
import {
  useCommentOnPost,
  useMe,
  usePost,
  usePostComments,
  usePostCommentSettings,
  useReactToComment,
  useReactToPost,
  useSavePost,
} from '../../api/hooks';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space, stroke } from '../../theme/tokens';
import { timeAgo } from '../../lib/format';
import { formatCount } from '../../lib/counts';
import type { PostComment } from '../../api/types';
import type { ShownReaction } from '../../components/feed/Reactions';
import type { ScreenProps } from '../../navigation/types';

/**
 * A post with no picture in it, read the way it should be read.
 *
 * A written post used to open in the same full-screen pager as a clip: a page
 * of black with a paragraph marooned in the middle of it, the comments behind a
 * sheet, and nothing at the bottom to answer with. A post that is only words is
 * a conversation somebody started, so the page is built like one:
 *
 *   back · their face · their name · ⋯
 *   the words, with room around them
 *   💕  comment  share                                    pick
 *   ────────────────────────────────────────────────────────────
 *   what people said, as far down as it goes
 *   a field at the bottom, where your thumb already is
 *
 * A clip or a photograph still opens in the pager — see `PostViewer` — because
 * there the picture is the point and it should own the screen. Text never
 * belonged in that room, which is why it also no longer appears in it.
 */
export function TextPostScreen({ route, navigation }: ScreenProps<'TextPost'>) {
  const { postId } = route.params;
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { contentWidth } = useLayout();
  const openProfile = useProfileTap();
  const toast = useToast();
  const { openActions } = useMemberActions();

  const postQuery = usePost(postId);
  const post = postQuery.data ?? null;
  useTrackPostView(post?.id ?? null, !!post, post?.mine ?? false);

  const { data: me } = useMe();
  const react = useReactToPost();
  const save = useSavePost();
  const comments = usePostComments(postId);
  const settings = usePostCommentSettings(postId);
  const canComment = settings.data !== false;
  const send = useCommentOnPost(postId);
  const reactComment = useReactToComment(postId);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const input = useRef<TextInput>(null);

  const authorName = post?.mine ? 'You' : post?.author.name ?? '';
  const preview = (comments.data?.items ?? []).slice(0, 6);

  /**
   * The server treats "the same kind again" as taking it back, so the button does
   * not need to know whether this is a first reaction or an undo.
   */
  const reactWith = useCallback(async (kind: ShownReaction) => {
    if (!post) return;
    try {
      await react.mutateAsync({ postId: post.id, liked: true, kind });
    } catch (e) {
      toast({ kind: 'error', title: 'Reaction not sent', message: (e as Error).message });
    }
  }, [post, react, toast]);

  const keep = useCallback(async () => {
    if (!post) return;
    try {
      await save.mutateAsync({ postId: post.id, saved: !post.saved });
    } catch (e) {
      toast({ kind: 'error', title: 'Couldn’t save it', message: (e as Error).message });
    }
  }, [post, save, toast]);

  const submit = useCallback(async () => {
    const body = draft.trim();
    if (!body || !post || sending) return;
    setSending(true);
    try {
      await send.mutateAsync({ body, parentId: null });
      setDraft('');
      // The list below is the point of this screen, so it is scrolled to the end
      // by the sheet's own refetch rather than by a scroll position we guess at.
    } catch (e) {
      toast({ kind: 'error', title: 'Comment not sent', message: (e as Error).message });
    } finally {
      setSending(false);
    }
  }, [draft, post, send, sending, toast]);

  if (postQuery.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + space.md }}>
        <LoadingBlock label="Opening the post" />
      </View>
    );
  }

  if (!post) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + space.md }}>
        <EmptyState
          icon="document-text-outline"
          title="This post is gone"
          message="It was removed, or it was never shared with you."
          action={{ label: 'Back', onPress: () => navigation.goBack() }}
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      {/* ---------------------------------------------------------------- head */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          paddingTop: insets.top + space.xs,
          paddingHorizontal: space.sm,
          paddingBottom: space.xs,
        }}
      >
        <Pressable
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={12}
          style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.6 : 1 })}
        >
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>

        <Pressable
          onPress={() => openProfile(post.author.id)}
          accessibilityRole="button"
          accessibilityLabel={`Open ${authorName}’s Space`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}
        >
          <Avatar uri={post.author.photos?.[0]?.url} name={post.author.name} size={36} />
          <View style={{ flexShrink: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Txt variant="bodyStrong" numberOfLines={1}>{authorName}</Txt>
              {post.author.verified ? <VerifiedBadge size={13} /> : null}
            </View>
            <Txt variant="caption" color="textMuted" numberOfLines={1}>
              {post.author.username ? `@${post.author.username} · ` : ''}
              {timeAgo(post.createdAt)}
            </Txt>
          </View>
        </Pressable>

        <Pressable
          onPress={() => openActions({ id: post.author.id, name: post.author.name })}
          accessibilityRole="button"
          accessibilityLabel="More"
          hitSlop={12}
          style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.6 : 1 })}
        >
          <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
        </Pressable>
      </View>

      {/* ---------------------------------------------------------------- body */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          width: contentWidth,
          alignSelf: 'center',
          paddingHorizontal: space.md,
          paddingBottom: space.xl,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/*
          The words are the whole page, so they get the size and the leading of
          something written rather than the 15 px of a caption in a card. Nothing
          caps the height: a long post is a long post.
        */}
        <Txt
          variant="body"
          selectable
          style={{ fontSize: 19, lineHeight: 28, marginTop: space.sm }}
        >
          <LinkText text={post.body} bare />
        </Txt>

        {/* ------------------------------------------------------------ actions */}
        {/*
          Three things, not four.

          The comment control was here and it was redundant: the comments are the
          rest of this page and the field is at the bottom of it, so a button that
          jumped you to a sheet of what you were already looking at was a fourth
          door into the same room. It went.

          The heart is a hold now: tap gives your reaction (a crush if you have
          none), hold opens all seven. See Reactions.
        */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.lg,
            marginTop: space.lg,
            paddingBottom: space.md,
          }}
        >
          <ReactionButton
            myReaction={post.myReaction}
            count={post.likeCount}
            onReact={(kind) => void reactWith(kind)}
            size={24}
          />
          <Action
            icon="paper-plane-outline"
            label="Share"
            onPress={() => setShareOpen(true)}
          />
          <View style={{ flex: 1 }} />
          <Action
            icon={post.saved ? 'bookmark' : 'bookmark-outline'}
            tint={post.saved ? colors.primary : colors.textSecondary}
            label={post.saved ? 'Remove from picks' : 'Pick this post'}
            onPress={() => void keep()}
          />
        </View>

        <View style={{ height: stroke.hairline, backgroundColor: colors.border }} />

        {/* ----------------------------------------------------------- comments */}
        <View style={{ marginTop: space.md }}>
          {comments.isLoading ? (
            <ActivityIndicator color={colors.textMuted} style={{ marginTop: space.lg }} />
          ) : preview.length ? (
            <>
              {preview.map((c) => (
                <CommentLine
                  key={c.id}
                  comment={c}
                  onOpenAuthor={openProfile}
                  onReact={(kind) => reactComment.mutate({ commentId: c.id, kind })}
                />
              ))}
              {(comments.data?.items.length ?? 0) > preview.length ? (
                <Pressable
                  onPress={() => setAllOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel="See every comment"
                  style={({ pressed }) => ({ paddingVertical: space.sm, opacity: pressed ? 0.6 : 1 })}
                >
                  <Txt variant="small" color="textMuted">
                    {`See all ${formatCount(post.commentCount)} comments`}
                  </Txt>
                </Pressable>
              ) : null}
            </>
          ) : (
            <Txt variant="small" color="textMuted" style={{ marginTop: space.sm }}>
              Nothing said yet. Be the first — that is how a conversation starts.
            </Txt>
          )}
        </View>
      </ScrollView>

      {/* ------------------------------------------------------------- compose */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingHorizontal: space.md,
          paddingTop: space.sm,
          paddingBottom: Math.max(insets.bottom, space.sm),
          borderTopWidth: stroke.hairline,
          borderTopColor: colors.border,
          backgroundColor: colors.bg,
        }}
      >
        <Avatar uri={me?.profile?.photos?.[0]?.url} name={me?.profile?.name} size={30} />
        <TextInput
          ref={input}
          value={draft}
          onChangeText={setDraft}
          placeholder={canComment ? 'Add a comment…' : 'Comments are off on this post'}
          placeholderTextColor={colors.textMuted}
          editable={canComment}
          multiline
          onSubmitEditing={() => void submit()}
          returnKeyType="send"
          accessibilityLabel="Write a comment"
          style={{
            flex: 1,
            minHeight: 38,
            maxHeight: 120,
            paddingHorizontal: 14,
            paddingVertical: 9,
            borderRadius: radius.pill ?? 19,
            backgroundColor: colors.elevated,
            color: colors.text,
            fontSize: 15,
          }}
        />
        <Pressable
          onPress={() => void submit()}
          disabled={!draft.trim() || sending}
          accessibilityRole="button"
          accessibilityLabel="Send comment"
          hitSlop={8}
          style={({ pressed }) => ({
            width: 38,
            height: 38,
            borderRadius: 19,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: draft.trim() ? colors.primary : colors.elevated,
            opacity: pressed ? 0.75 : 1,
          })}
        >
          {sending ? (
            <ActivityIndicator size="small" color={colors.onPrimary} />
          ) : (
            <Ionicons
              name="arrow-up"
              size={20}
              color={draft.trim() ? colors.onPrimary : colors.textMuted}
            />
          )}
        </Pressable>
      </View>

      <CommentsSheet
        post={post}
        visible={allOpen}
        onClose={() => setAllOpen(false)}
        onOpenAuthor={openProfile}
      />
      <ShareToWhisper post={post} visible={shareOpen} onClose={() => setShareOpen(false)} />
    </KeyboardAvoidingView>
  );
}

/** One of the four things you can do with a post, in the row under it. */
function Action({
  icon,
  count,
  tint,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  count?: number;
  tint?: string;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const colour = tint ?? colors.textSecondary;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={count != null ? `${label}, ${count}` : label}
      hitSlop={10}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name={icon} size={22} color={colour} />
      {count != null && count > 0 ? (
        <Txt variant="small" color="textSecondary">{formatCount(count)}</Txt>
      ) : null}
    </Pressable>
  );
}

/**
 * One comment, as it sits in the column under a text post.
 *
 * Smaller and quieter than the sheet's row: this is a preview of the
 * conversation, and the sheet — one tap away at the bottom of it — is where you
 * reply, react and hold to delete. Nothing here is a second version of that.
 */
function CommentLine({
  comment,
  onOpenAuthor,
  onReact,
}: {
  comment: PostComment;
  onOpenAuthor: (id: number) => void;
  onReact: (kind: ShownReaction) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 10, paddingVertical: 9 }}>
      <Pressable
        onPress={() => onOpenAuthor(comment.author.id)}
        accessibilityRole="button"
        accessibilityLabel={`Open ${comment.author.name}`}
        hitSlop={6}
      >
        <Avatar uri={comment.author.photos?.[0]?.url} name={comment.author.name} size={30} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Txt variant="small" color="textSecondary" numberOfLines={1} style={{ fontWeight: '700' }}>
            {comment.mine ? 'You' : comment.author.name}
          </Txt>
          <Txt variant="caption" color="textMuted">{timeAgo(comment.createdAt)}</Txt>
        </View>
        <Txt
          variant="small"
          color={comment.hidden ? 'textMuted' : 'text'}
          style={{ marginTop: 2, lineHeight: 19 }}
        >
          {comment.hidden ? 'This comment was removed.' : <LinkText text={comment.body} bare />}
        </Txt>
        {/* A comment can be reacted to as well as a post — same seven, same hold. */}
        {!comment.hidden ? (
          <View style={{ marginTop: 4, alignSelf: 'flex-start' }}>
            <ReactionButton
              myReaction={comment.myReaction}
              count={comment.likeCount}
              onReact={onReact}
              size={16}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}
