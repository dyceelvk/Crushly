import { FollowButton } from '../FollowButton';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../Photo';
import { Txt } from '../Txt';
import { useSwipeTabs } from '../SwipeTabs';
import { LinkText } from '../LinkText';
import { useToast } from '../Toast';
import { Suggestions } from '../Suggestions';
import { useMentionInput } from '../useMentionInput';
import { ConfirmSheet } from '../BottomSheet';
import {
  useCommentOnPost,
  useDeletePostComment,
  useReactToComment,
  useMe,
  usePostComments,
  usePostCommentSettings,
  usePostLikers,
} from '../../api/hooks';
import { formatCount } from '../../lib/counts';
import { timeAgo } from '../../lib/format';
import { fonts, radius } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { ReactionButton, type ShownReaction } from './Reactions';
import { useAndroidKeyboardOverlap } from '../../lib/useAndroidKeyboardOverlap';
import type { Post, PostComment } from '../../api/types';

/**
 * The sheet over a post: what was said, and who felt something.
 *
 * Two tabs, both backed by a real query — `post_comments_feed` for the words and
 * `post_likers` for the reactions — because the reference surface has tabs and a
 * tab that opens onto nothing is a decoration with a label on it.
 *
 * Three things were copied from the reference because they are right:
 *
 *   * the sheet follows the member's holUpp light or dark appearance;
 *   * the counts live in the tab strip, so you can see how much conversation
 *     there is without scrolling to the end of it;
 *   * a comment carries who its author is *to this post* — the person who wrote
 *     it is marked, and so is yours — instead of making you match avatars.
 *
 * A reply is one level deep, which is what the database allows, so there is no
 * "reply to a reply" dead end here.
 */

type Tab = 'comments' | 'likes';
type Sort = 'newest' | 'top';

const EMOJI = ['❤️', '🔥', '😂', '😮', '😢', '👏', '🙌', '💯', '😍', '🤝', '✨', '🎶', '👀', '😭', '🥹', '💫'];

export function CommentsSheet({
  post,
  visible,
  onClose,
  onOpenAuthor,
}: {
  post: Post | null;
  visible: boolean;
  onClose: () => void;
  onOpenAuthor?: (authorId: number) => void;
}) {
  const { colors } = useTheme();
  const NOIR = {
    sheet: colors.card, header: colors.card, divider: colors.border,
    text: colors.text, secondary: colors.textSecondary, muted: colors.textMuted,
    field: colors.elevated, accent: colors.primary, crush: colors.crush, gold: colors.gold,
  };
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const keyboard = useAndroidKeyboardOverlap();
  const { data: me } = useMe();
  const toast = useToast();

  const postId = post?.id ?? null;
  /*
   * Reactions on a comment belong to written posts only.
   *
   * A video or a photo is a thing you react to; the comments under it are a
   * conversation about that thing, and a row of faces on every reply turns the
   * thread into a second scoreboard. Written posts have no picture to carry the
   * reaction, so there the comment itself can be crushed — and that lives on the
   * text post screen, in words, beside Reply.
   */
  const commentReactions = !!post && !post.mediaUrl;
  const commentsQuery = usePostComments(visible ? postId : null);
  const settingsQuery = usePostCommentSettings(visible ? postId : null);
  const canComment = settingsQuery.data === true;
  const likersQuery = usePostLikers(visible ? postId : null);
  const send = useCommentOnPost(postId ?? 0);
  const reactToComment = useReactToComment(postId ?? 0);
  const removeComment = useDeletePostComment(postId ?? 0);

  const [tab, setTab] = useState<Tab>('comments');
  const tabSwipe = useSwipeTabs({ options: ['comments', 'likes'] as const, value: tab, onChange: setTab, width });
  const [sort, setSort] = useState<Sort>('newest');
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<PostComment | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [doomed, setDoomed] = useState<PostComment | null>(null);
  const input = useRef<TextInput>(null);
  const slide = useRef(new Animated.Value(0)).current;
  const native = Platform.OS !== 'web';

  useEffect(() => {
    if (!visible) return;
    setDraft('');
    setReplyTo(null);
    setEmojiOpen(false);
    setDoomed(null);
    setTab('comments');
    Animated.timing(slide, { toValue: 1, duration: 240, useNativeDriver: native }).start();
  }, [visible, slide, native]);

  const mention = useMentionInput(draft, setDraft);

  const comments = commentsQuery.data?.items ?? [];
  const likers = likersQuery.data ?? [];

  /** One level of threading: replies hang under the comment they answer. */
  const { roots, repliesByParent } = useMemo(() => {
    const roots: PostComment[] = [];
    const map = new Map<number, PostComment[]>();
    for (const c of comments) {
      if (c.parentId) {
        const list = map.get(c.parentId) ?? [];
        list.push(c);
        map.set(c.parentId, list);
      } else {
        roots.push(c);
      }
    }
    const ordered = sort === 'top'
      ? [...roots].sort((a, b) => (b.likeCount ?? 0) - (a.likeCount ?? 0) || b.createdAt - a.createdAt)
      : [...roots].sort((a, b) => b.createdAt - a.createdAt);
    return { roots: ordered, repliesByParent: map };
  }, [comments, sort]);

  const postAuthorId = post?.author.id;

  const submit = useCallback(async () => {
    const body = draft.trim();
    if (!body || sending || !canComment) return;
    const parent = replyTo;
    setSending(true);
    setDraft('');
    setReplyTo(null);
    try {
      await send.mutateAsync({ body, parentId: parent?.id ?? null });
    } catch (error) {
      // Put the words back and say why nothing was sent.
      setDraft(body);
      setReplyTo(parent);
      toast({ kind: 'error', title: 'Comment not sent', message: (error as Error).message });
    } finally {
      setSending(false);
    }
  }, [draft, replyTo, send, sending, canComment, toast]);

  const startReply = useCallback((comment: PostComment) => {
    setReplyTo(comment);
    setTab('comments');
    input.current?.focus();
  }, []);

  // Comments carry the same seven reactions as posts, and the same gesture.
  const react = useCallback(
    (comment: PostComment, kind: ShownReaction) => {
      reactToComment.mutate({ commentId: comment.id, kind });
    },
    [reactToComment],
  );

  const role = useCallback(
    (comment: PostComment) => {
      if (comment.author.id === postAuthorId) return 'Creator';
      if (comment.mine || (me && comment.author.id === me.id)) return 'You';
      return null;
    },
    [postAuthorId, me],
  );

  const renderComment = (comment: PostComment, depth: number) => {
    const label = role(comment);
    return (
      <Pressable
        key={comment.id}
        onLongPress={comment.mine && !comment.hidden ? () => setDoomed(comment) : undefined}
        delayLongPress={420}
        accessibilityRole="button"
        accessibilityLabel={
          comment.mine && !comment.hidden ? 'Your comment. Hold to delete it.' : `Comment by ${comment.author.name}`
        }
        style={{
          flexDirection: 'row',
          gap: 10,
          paddingLeft: depth ? 46 : 16,
          paddingRight: 16,
          paddingVertical: 11,
          backgroundColor: doomed?.id === comment.id ? NOIR.field : 'transparent',
        }}
      >
        <Pressable
          onPress={() => onOpenAuthor?.(comment.author.id)}
          accessibilityRole="button"
          accessibilityLabel={`Open ${comment.author.name}`}
          disabled={!onOpenAuthor}
        >
          <Avatar uri={comment.author.photos?.[0]?.url} name={comment.author.name} size={depth ? 30 : 38} />
        </Pressable>

        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
            <Txt
              style={{ fontFamily: fonts.bold, fontSize: 13, color: NOIR.secondary }}
              numberOfLines={1}
            >
              {comment.mine ? 'You' : comment.author.name}
            </Txt>
            {!comment.mine && !comment.hidden && post?.audience === 'everyone' ? <FollowButton id={comment.author.id} name={comment.author.name} compact /> : null}
            {label ? (
              <>
                <Txt style={{ fontSize: 12, color: NOIR.muted }}>·</Txt>
                <Txt style={{ fontFamily: fonts.semibold, fontSize: 12, color: NOIR.accent }}>{label}</Txt>
              </>
            ) : null}
          </View>

          <Txt
            style={{
              fontFamily: fonts.regular,
              fontSize: 14.5,
              lineHeight: 20,
              color: comment.hidden ? NOIR.muted : NOIR.text,
              marginTop: 3,
            }}
          >
            {comment.hidden ? 'This comment was removed.' : <LinkText text={comment.body} bare onBeforeOpenLink={onClose} />}
          </Txt>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 7 }}>
            <Txt style={{ fontSize: 12, color: NOIR.muted }}>{timeAgo(comment.createdAt)}</Txt>
            {!comment.hidden && canComment ? (
              <Pressable onPress={() => startReply(comment)} accessibilityRole="button" hitSlop={8}>
                <Txt style={{ fontFamily: fonts.bold, fontSize: 12.5, color: NOIR.secondary }}>Reply</Txt>
              </Pressable>
            ) : null}

            <View style={{ flex: 1 }} />

            {commentReactions ? (
              <ReactionButton
                myReaction={comment.myReaction ?? (comment.liked ? 'crush' : null)}
                count={comment.likeCount}
                size={17}
                word
                onReact={(kind) => react(comment, kind)}
              />
            ) : comment.likeCount ? (
              /* The count stays: it is what other people said, and hiding it
                 would quietly erase reactions that already exist. There is just
                 no way to add another here. */
              <Txt style={{ fontSize: 12, color: NOIR.muted }}>{formatCount(comment.likeCount)}</Txt>
            ) : null}
          </View>
        </View>
      </Pressable>
    );
  };

  const commentsTab = (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: 16 }}
      showsVerticalScrollIndicator={false}
    >
      {commentsQuery.isLoading ? (
        <Txt style={{ padding: 20, color: NOIR.muted, fontSize: 13 }}>Loading the conversation…</Txt>
      ) : roots.length === 0 ? (
        <Txt style={{ padding: 20, color: NOIR.muted, fontSize: 13, lineHeight: 19 }}>
          {canComment ? 'Nothing said yet. Be the first to comment.' : 'No comments yet.'}
        </Txt>
      ) : (
        roots.map((root) => (
          <View key={root.id}>
            {renderComment(root, 0)}
            {(repliesByParent.get(root.id) ?? []).map((reply) => renderComment(reply, 1))}
          </View>
        ))
      )}
    </ScrollView>
  );

  const likesTab = (
    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      {likersQuery.isLoading ? (
        <Txt style={{ padding: 20, color: NOIR.muted, fontSize: 13 }}>Loading…</Txt>
      ) : likers.length === 0 ? (
        <Txt style={{ padding: 20, color: NOIR.muted, fontSize: 13 }}>No reactions on this post yet.</Txt>
      ) : (
        likers.map((liker, i) => (
          <Pressable
            key={`${liker.author.id}-${i}`}
            onPress={() => onOpenAuthor?.(liker.author.id)}
            disabled={!onOpenAuthor}
            accessibilityRole="button"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 9 }}
          >
            <Avatar uri={liker.author.photos?.[0]?.url} name={liker.author.name} size={38} />
            <View style={{ flex: 1 }}>
              <Txt style={{ fontFamily: fonts.bold, fontSize: 13.5, color: NOIR.text }} numberOfLines={1}>
                {liker.author.name}
              </Txt>
              <Txt style={{ fontSize: 12, color: NOIR.muted, marginTop: 1 }}>{timeAgo(liker.createdAt)}</Txt>
            </View>
            <Ionicons name="heart" size={16} color={liker.kind === 'crush' ? NOIR.crush : NOIR.gold} />
          </Pressable>
        ))
      )}
    </ScrollView>
  );

  if (!visible || !post) return null;

  const commentCount = post.commentCount ?? comments.length;
  const likeCount = post.likeCount;

  return (
    <>
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View ref={keyboard.root} onLayout={keyboard.measure} style={{ flex: 1 }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }} onPress={onClose} accessibilityLabel="Close comments" accessibilityRole="button" />

        <Animated.View
          accessibilityViewIsModal
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: keyboard.overlap,
            height: Math.min(height * 0.74, 680, Math.max(160, height - keyboard.overlap - insets.top)),
            backgroundColor: NOIR.sheet,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            overflow: 'hidden',
            transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [height * 0.5, 0] }) }],
          }}
        >
          {/* ------------------------------------------------------------ header */}
          <View
            {...tabSwipe.panHandlers}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingLeft: 16,
              paddingRight: 8,
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: NOIR.divider,
            }}
          >
            <Pressable onPress={() => setTab('comments')} accessibilityRole="tab" accessibilityState={{ selected: tab === 'comments' }} hitSlop={6} style={{ marginRight: 20, paddingVertical: 14 }}>
              <Txt style={{ fontFamily: fonts.bold, fontSize: 16.5, color: tab === 'comments' ? NOIR.text : NOIR.muted }}>
                {commentCount ? `Comments ${formatCount(commentCount)}` : 'Comments'}
              </Txt>
              <View
                style={{
                  height: 2.5,
                  marginTop: 6,
                  borderRadius: 2,
                  backgroundColor: tab === 'comments' ? NOIR.text : 'transparent',
                }}
              />
            </Pressable>

            <Pressable onPress={() => setTab('likes')} accessibilityRole="tab" accessibilityState={{ selected: tab === 'likes' }} hitSlop={6} style={{ paddingVertical: 14 }}>
              <Txt style={{ fontFamily: fonts.bold, fontSize: 16.5, color: tab === 'likes' ? NOIR.text : NOIR.muted }}>
                {likeCount ? `Likes ${formatCount(likeCount)}` : 'Likes'}
              </Txt>
              <View
                style={{
                  height: 2.5,
                  marginTop: 6,
                  borderRadius: 2,
                  backgroundColor: tab === 'likes' ? NOIR.text : 'transparent',
                }}
              />
            </Pressable>

            <View style={{ flex: 1 }} />

            {tab === 'comments' ? (
              <Pressable
                onPress={() => setSort(sort === 'newest' ? 'top' : 'newest')}
                accessibilityRole="button"
                accessibilityLabel={sort === 'newest' ? 'Sorted by newest. Switch to top comments' : 'Sorted by top comments. Switch to newest'}
                hitSlop={10}
                style={{ padding: 8 }}
              >
                <Ionicons name={sort === 'newest' ? 'swap-vertical' : 'funnel'} size={20} color={NOIR.secondary} />
              </Pressable>
            ) : null}

            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} style={{ padding: 8 }}>
              <Ionicons name="close" size={24} color={NOIR.text} />
            </Pressable>
          </View>

          {/* -------------------------------------------------------------- body */}
          <View {...tabSwipe.panHandlers} style={{ flex: 1 }}>{tab === 'comments' ? commentsTab : likesTab}</View>

          {/* ---------------------------------------------------------- composer */}
          {tab === 'comments' && !canComment ? (
            <Txt style={{ padding: 16, color: NOIR.muted }}>
              {settingsQuery.isError ? 'Could not load comment settings. Reopen to retry.' : settingsQuery.isLoading ? 'Checking comment settings…' : 'Comments are turned off for this post.'}
            </Txt>
          ) : tab === 'comments' ? (
            <View
              style={{
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: NOIR.divider,
                paddingBottom: Math.max(insets.bottom, 8),
                backgroundColor: NOIR.sheet,
              }}
            >
              {mention.token ? (
                <View style={{ paddingHorizontal: 12 }}>
                  <Suggestions token={mention.token} onPick={mention.pick} quiet />
                </View>
              ) : null}

              {replyTo ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 8 }}>
                  <Txt style={{ fontSize: 12.5, color: NOIR.muted }} numberOfLines={1}>
                    Replying to {replyTo.author.name}
                  </Txt>
                  <Pressable onPress={() => setReplyTo(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel reply">
                    <Ionicons name="close-circle" size={16} color={NOIR.muted} />
                  </Pressable>
                </View>
              ) : null}

              {emojiOpen ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, paddingTop: 10, gap: 4 }}>
                  {EMOJI.map((e) => (
                    <Pressable
                      key={e}
                      onPress={() => setDraft((d) => d + e)}
                      accessibilityRole="button"
                      accessibilityLabel={`Add ${e}`}
                      style={{ width: 38, height: 34, alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Txt style={{ fontSize: 21 }}>{e}</Txt>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 16, paddingTop: 10 }}>
                <Avatar uri={me?.profile?.photos?.[0]?.url} name={me?.profile?.name ?? 'You'} size={34} />
                <View
                  style={{
                    flex: 1,
                    minWidth: 0,
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: NOIR.field,
                    borderRadius: radius.pill ?? 21,
                    paddingHorizontal: 14,
                    minHeight: 42,
                  }}
                >
                  <TextInput
                    ref={input}
                    value={draft}
                    onChangeText={mention.onChangeText}
                    onSelectionChange={mention.onSelectionChange}
                    placeholder={replyTo ? `Reply to ${replyTo.author.name}…` : 'Add comment…'}
                    placeholderTextColor={NOIR.muted}
                    style={{ flex: 1, minWidth: 0, color: NOIR.text, fontFamily: fonts.regular, fontSize: 14.5, paddingVertical: 10 }}
                    returnKeyType="send"
                    onSubmitEditing={() => void submit()}
                    multiline={false}
                    accessibilityLabel="Add a comment"
                  />
                  <Pressable
                    onPress={() => {
                      setDraft((d) => d + '@');
                      input.current?.focus();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Mention somebody"
                    style={{ width: 34, height: 38, flexShrink: 0, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Txt style={{ fontFamily: fonts.bold, fontSize: 16, color: NOIR.secondary }}>@</Txt>
                  </Pressable>
                  <Pressable
                    onPress={() => setEmojiOpen((v) => !v)}
                    accessibilityRole="button"
                    accessibilityLabel="Emoji"
                    accessibilityState={{ expanded: emojiOpen }}
                    style={{ width: 34, height: 38, flexShrink: 0, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Ionicons name="happy-outline" size={20} color={emojiOpen ? NOIR.accent : NOIR.secondary} />
                  </Pressable>
                </View>

                <Pressable
                  onPress={() => void submit()}
                  disabled={!draft.trim() || sending}
                  accessibilityRole="button"
                  accessibilityLabel="Send comment"
                  hitSlop={8}
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 19,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: draft.trim() ? NOIR.accent : colors.elevated,
                  }}
                >
                  <Ionicons name="arrow-up" size={19} color={draft.trim() ? colors.onPrimary : NOIR.muted} />
                </Pressable>
              </View>
            </View>
          ) : null}
        </Animated.View>
      </KeyboardAvoidingView>
      </View>
    </Modal>
      <ConfirmSheet
        visible={doomed !== null}
        title="Delete this comment?"
        message="It goes for everyone, replies included. You can say it again, but it starts over."
        confirmLabel="Delete it"
        destructive
        loading={removeComment.isPending}
        onCancel={() => setDoomed(null)}
        onConfirm={() => {
          const target = doomed;
          setDoomed(null);
          if (target) void removeComment.mutate(target.id);
        }}
      />
    </>
  );
}
