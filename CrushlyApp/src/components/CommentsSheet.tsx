import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated, FlatList, Keyboard, Modal, Platform, Pressable, TextInput, View, useWindowDimensions,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from './Txt';
import { Avatar } from './Photo';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import { timeAgo } from '../lib/format';
import { useMe, useCommentOnPost, useDeletePostComment, usePostComments, useReactToPostComment } from '../api/hooks';
import type { PostComment } from '../api/types';
import { canSendComment, composerOffset, sheetPlacement } from '../lib/comments';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * The sheet's height and the keyboard's effect on it come from lib/comments,
 * where they are covered by tests. In short: the sheet is measured from the
 * top of the *visible* area and ends exactly at its bottom edge, so when a
 * keyboard takes part of the screen the sheet — and the composer pinned to its
 * floor — moves up rather than being drawn underneath.
 */

type Props = {
  postId: number;
  visible: boolean;
  onClose: () => void;
  /** The post's own comment count, so the header is right before the thread loads. */
  commentCount?: number;
};

/**
 * The comments under one post, in one bottom sheet.
 *
 * This is deliberately the only comments surface in the app: the Flow card and
 * the PostViewer both open this, so a like, a reply or a delete behaves the
 * same wherever it is done. There used to be two copies — one per screen — and
 * they drifted the moment one of them changed.
 *
 * WHAT THE SHEET SHOWS
 * The heading counts what is actually in the thread, not what the feed last
 * heard. Each comment carries its own like count, a Reply action, and — when
 * somebody answered it — a line that opens the answers in place. Answers are
 * drawn indented under the comment they belong to, never on a second screen.
 *
 * A comment with answers that its author deletes is emptied rather than
 * removed; it reads "This comment was deleted." and the answers stay put.
 * That is the database's behaviour, and the sheet simply draws it.
 */
export function CommentsSheet({ postId, visible, onClose, commentCount }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const nav = useNavigation<Nav>();

  /**
   * How much of the window the keyboard is covering.
   *
   * Measured rather than assumed, because the platforms disagree: iOS reports
   * it in `endCoordinates`, Android only reliably reports whether it is up.
   * When all we know is "up", the sheet gets the 45% that a phone keyboard
   * typically takes — better to make room for a keyboard that turned out to be
   * smaller than to hide the composer behind one that is bigger.
   */
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    if (!visible) {
      setKeyboardHeight(0);
      return;
    }
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => {
      const reported = e?.endCoordinates?.height ?? 0;
      setKeyboardHeight(reported > 0 ? reported : Math.round(height * 0.45));
    });
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => {
      setKeyboardHeight(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [visible, height]);

  const query = usePostComments(visible ? postId : null);
  const { data: me } = useMe();
  const send = useCommentOnPost(postId);
  const remove = useDeletePostComment(postId);
  const like = useReactToPostComment(postId);

  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<PostComment | null>(null);
  const [open, setOpen] = useState<number[]>([]);
  const [mounted, setMounted] = useState(visible);
  const y = useRef(new Animated.Value(1)).current;
  const { reduceMotion } = useTheme();
  const native = Platform.OS !== 'web';

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(y, { toValue: 0, duration: reduceMotion ? 0 : 260, useNativeDriver: native }).start();
    } else if (mounted) {
      Animated.timing(y, { toValue: 1, duration: reduceMotion ? 0 : 200, useNativeDriver: native }).start(() => setMounted(false));
    }
  }, [visible, mounted, y, reduceMotion, native]);

  const items = query.data?.items ?? [];

  /** The first two people who answered a comment, for its avatar stack. */
  const answerers = useMemo(() => {
    const out = new Map<number, PostComment[]>();
    for (const c of items) {
      if (c.parentId === null) continue;
      const list = out.get(c.parentId) ?? [];
      if (list.length < 2) list.push(c);
      out.set(c.parentId, list);
    }
    return out;
  }, [items]);

  /** Comments at the top of the thread, each with its answers underneath. */
  const rows = useMemo(() => {
    const byParent = new Map<number, PostComment[]>();
    for (const c of items) {
      if (c.parentId === null) continue;
      const list = byParent.get(c.parentId) ?? [];
      list.push(c);
      byParent.set(c.parentId, list);
    }
    const out: { comment: PostComment; depth: 0 | 1 }[] = [];
    for (const c of items) {
      if (c.parentId !== null) continue;
      out.push({ comment: c, depth: 0 });
      if (open.includes(c.id)) {
        for (const r of byParent.get(c.id) ?? []) out.push({ comment: r, depth: 1 });
      }
    }
    return out;
  }, [items, open]);

  // Replies that are hidden because their parent is collapsed still count, so
  // the heading never contradicts the "View N replies" line under a comment.
  const total = items.length || commentCount || 0;

  // Where the sheet stands right now, with any keyboard taken off the bottom.
  const placement = sheetPlacement({ viewportHeight: height, keyboardHeight });

  const submit = useCallback(async () => {
    const body = draft.trim();
    if (!body) return;
    const parent = replyTo;
    setDraft('');
    setReplyTo(null);
    try {
      await send.mutateAsync({ body, parentId: parent?.id ?? null });
      // Open the answers so the reply you just wrote is on screen.
      if (parent && !open.includes(parent.id)) setOpen((prev) => [...prev, parent.id]);
    } catch (e) {
      setDraft(body);
      setReplyTo(parent);
    }
  }, [draft, replyTo, send, open]);

  const toggleOpen = useCallback((id: number) => {
    setOpen((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  }, []);

  const startReply = useCallback((comment: PostComment) => {
    setReplyTo(comment);
  }, []);

  const openProfile = useCallback(
    (comment: PostComment) => {
      if (comment.mine) nav.navigate('Main', { screen: 'Profile' });
      else nav.navigate('UserProfile', { id: comment.author.id });
    },
    [nav],
  );

  if (!mounted) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1 }}>
        <Animated.View
          style={{
            flex: 1,
            backgroundColor: colors.scrim,
            opacity: y.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
          }}
        >
          <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close comments" />
        </Animated.View>

        <Animated.View
          accessibilityViewIsModal
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            // Sits on the floor of what is visible — which is the top of the
            // keyboard once it is up, not the bottom of the window.
            top: placement.top,
            transform: [{ translateY: y.interpolate({ inputRange: [0, 1], outputRange: [0, height * 0.6] }) }],
          }}
        >
          <View
            style={{
              height: placement.height,
              backgroundColor: colors.bgSecondary,
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              borderWidth: 1,
              borderBottomWidth: 0,
              borderColor: colors.border,
              overflow: 'hidden',
            }}
          >
            {/* Drag handle */}
            <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 2 }}>
              <View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong }} />
            </View>

            {/* Heading and close */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: space.lg,
                paddingTop: space.sm,
                paddingBottom: space.md,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                <Txt variant="title" accessibilityRole="header">
                  Comments
                </Txt>
                <Txt variant="body" color="textMuted">
                  {total.toLocaleString()}
                </Txt>
              </View>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close comments"
                hitSlop={14}
                style={{ padding: 6 }}
              >
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </Pressable>
            </View>

            {/* The thread */}
            {query.isLoading ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <Txt variant="body" color="textMuted">
                  Loading comments…
                </Txt>
              </View>
            ) : query.isError ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingHorizontal: space.xl }}>
                <Txt variant="body" color="textMuted" align="center">
                  Comments could not load.
                </Txt>
                <Pressable onPress={() => void query.refetch()} accessibilityRole="button" hitSlop={12}>
                  <Txt variant="bodyStrong" color="gold">
                    Try again
                  </Txt>
                </Pressable>
              </View>
            ) : rows.length === 0 ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl, gap: 6 }}>
                <Ionicons name="chatbubble-outline" size={30} color={colors.textMuted} />
                <Txt variant="bodyStrong" align="center">
                  No comments yet
                </Txt>
                <Txt variant="body" color="textMuted" align="center">
                  Be the first to say something.
                </Txt>
              </View>
            ) : (
              <FlatList
                data={rows}
                keyExtractor={(row) => String(row.comment.id)}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: space.md }}
                renderItem={({ item }) => (
                  <CommentRow
                    comment={item.comment}
                    depth={item.depth}
                    answerers={answerers.get(item.comment.id) ?? []}
                    expanded={open.includes(item.comment.id)}
                    onToggleReplies={() => toggleOpen(item.comment.id)}
                    onReply={() => startReply(item.comment)}
                    onLike={() => like.mutate({ commentId: item.comment.id, liked: !item.comment.liked })}
                    onDelete={() => remove.mutate(item.comment.id)}
                    onOpenProfile={() => openProfile(item.comment)}
                  />
                )}
              />
            )}

            {/* What you are answering, when you are answering somebody */}
            {replyTo ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingHorizontal: space.lg,
                  paddingVertical: 6,
                  backgroundColor: colors.elevated,
                }}
              >
                <Txt variant="caption" color="textSecondary" numberOfLines={1} style={{ flex: 1 }}>
                  Replying to <Txt variant="caption" color="gold">{replyTo.mine ? 'yourself' : replyTo.author.name}</Txt>
                </Txt>
                <Pressable onPress={() => setReplyTo(null)} accessibilityRole="button" accessibilityLabel="Cancel reply" hitSlop={12}>
                  <Ionicons name="close" size={16} color={colors.textMuted} />
                </Pressable>
              </View>
            ) : null}

            {/* Composer */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-end',
                gap: space.sm,
                paddingHorizontal: space.lg,
                paddingTop: space.sm,
                paddingBottom: composerOffset(insets.bottom),
                borderTopWidth: 1,
                borderTopColor: colors.border,
              }}
            >
              <Avatar uri={me?.profile.photos[0]?.url ?? null} name={me?.profile.name} size={34} />
              <View
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'flex-end',
                  gap: 4,
                  borderRadius: 24,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.card,
                  paddingLeft: 14,
                  paddingRight: 4,
                  paddingVertical: 2,
                  minHeight: 44,
                }}
              >
                <Pressable
                  onPress={() => setDraft((value) => `${value}😊`)}
                  accessibilityRole="button"
                  accessibilityLabel="Add an emoji"
                  hitSlop={10}
                  style={{ paddingVertical: 10 }}
                >
                  <Ionicons name="happy-outline" size={21} color={colors.textMuted} />
                </Pressable>
                {/* A plain TextInput keeps the send button from being pushed off
                    screen by a long draft, and grows with the text. */}
                <DraftInput
                  value={draft}
                  placeholder={replyTo ? `Reply to ${replyTo.mine ? 'yourself' : replyTo.author.name}…` : 'Add a comment…'}
                  onChangeText={setDraft}
                  onSubmit={submit}
                  color={colors.text}
                  placeholderColor={colors.textMuted}
                />
              </View>
              <Pressable
                onPress={submit}
                disabled={!canSendComment(draft, send.isPending)}
                accessibilityRole="button"
                accessibilityLabel="Send comment"
                hitSlop={8}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  alignItems: 'center',
                  justifyContent: 'center',
                  // The one place the accent is a filled surface: sending.
                  backgroundColor: colors.crush,
                  opacity: canSendComment(draft, send.isPending) ? 1 : 0.45,
                }}
              >
                <Ionicons name="arrow-up" size={21} color={colors.onCrush} />
              </Pressable>
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

/** The text field inside the pill. Its own component so the pill can wrap it. */
function DraftInput({
  value, placeholder, onChangeText, onSubmit, color, placeholderColor,
}: {
  value: string;
  placeholder: string;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
  color: string;
  placeholderColor: string;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={placeholderColor}
      multiline
      maxLength={1000}
      onSubmitEditing={onSubmit}
      returnKeyType="send"
      blurOnSubmit
      accessibilityLabel="Write a comment"
      style={{
        flex: 1,
        minHeight: 40,
        maxHeight: 110,
        paddingVertical: 9,
        paddingHorizontal: 2,
        fontSize: 15,
        color,
      }}
    />
  );
}

/**
 * One comment, or one answer to a comment.
 *
 * Answers are drawn with a left rule and a smaller avatar, so the thread is
 * legible at a glance without indenting deeper than one level.
 */
function CommentRow({
  comment: c, depth, answerers, expanded, onToggleReplies, onReply, onLike, onDelete, onOpenProfile,
}: {
  comment: PostComment;
  depth: 0 | 1;
  /** Up to two people who answered, for the stack beside "View N replies". */
  answerers: PostComment[];
  expanded: boolean;
  onToggleReplies: () => void;
  onReply: () => void;
  onLike: () => void;
  onDelete: () => void;
  onOpenProfile: () => void;
}) {
  const { colors } = useTheme();
  const nested = depth === 1;
  const name = c.mine ? 'You' : c.author.name;

  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 10,
        paddingVertical: space.sm,
        marginLeft: nested ? 34 : 0,
        paddingLeft: nested ? 12 : 0,
        borderLeftWidth: nested ? 2 : 0,
        borderLeftColor: colors.border,
        borderBottomWidth: nested ? 0 : 1,
        borderBottomColor: colors.border,
      }}
    >
      <Pressable onPress={onOpenProfile} accessibilityRole="button" accessibilityLabel={`${name}'s Space`} hitSlop={6}>
        <Avatar uri={c.author.photos[0]?.url ?? null} name={c.author.name} size={nested ? 26 : 36} />
      </Pressable>

      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
          <Pressable onPress={onOpenProfile} accessibilityRole="button" hitSlop={4}>
            <Txt variant="bodyStrong" numberOfLines={1}>
              {name}
            </Txt>
          </Pressable>
          <Txt variant="caption" color="textMuted">
            {timeAgo(c.createdAt)}
          </Txt>
          {c.author.verified ? <Ionicons name="checkmark-circle" size={13} color={colors.gold} /> : null}
        </View>

        {c.hidden ? (
          <Txt variant="body" color="textMuted" style={{ fontStyle: 'italic' }}>
            This comment was deleted.
          </Txt>
        ) : (
          <Txt variant={nested ? 'caption' : 'body'} selectable style={{ lineHeight: nested ? 19 : 21 }}>
            {c.body}
          </Txt>
        )}

        {c.hidden ? null : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg, marginTop: 2 }}>
            {depth === 0 ? (
              <Pressable
                onPress={onReply}
                accessibilityRole="button"
                accessibilityLabel={`Reply to ${name}`}
                hitSlop={10}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}
              >
                <Ionicons name="arrow-undo-outline" size={14} color={colors.textMuted} />
                <Txt variant="caption" color="textSecondary">
                  Reply
                </Txt>
              </Pressable>
            ) : null}
            {c.canDelete ? (
              <Pressable onPress={onDelete} accessibilityRole="button" accessibilityLabel="Delete comment" hitSlop={10}>
                <Txt variant="caption" color="textMuted">
                  Delete
                </Txt>
              </Pressable>
            ) : null}
          </View>
        )}

        {depth === 0 && c.replyCount > 0 ? (
          <Pressable
            onPress={onToggleReplies}
            accessibilityRole="button"
            accessibilityLabel={expanded ? 'Hide replies' : `View ${c.replyCount} replies`}
            hitSlop={10}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}
          >
            <View style={{ flexDirection: 'row' }}>
              {answerers.map((reply, i) => (
                <View
                  key={reply.id}
                  style={{ marginLeft: i === 0 ? 0 : -7, borderRadius: 10, borderWidth: 1.5, borderColor: colors.bgSecondary }}
                >
                  <Avatar uri={reply.author.photos[0]?.url ?? null} name={reply.author.name} size={19} />
                </View>
              ))}
            </View>
            <Txt variant="caption" color="textSecondary">
              {expanded ? 'Hide replies' : `View ${c.replyCount} ${c.replyCount === 1 ? 'reply' : 'replies'}`}
            </Txt>
            <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={13} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {c.hidden ? null : (
        <Pressable
          onPress={onLike}
          accessibilityRole="button"
          accessibilityLabel={c.liked ? `Unlike comment by ${name}` : `Like comment by ${name}`}
          hitSlop={10}
          style={{ alignItems: 'center', gap: 2, minWidth: 30, paddingTop: 2 }}
        >
          <Ionicons
            name={c.liked ? 'heart' : 'heart-outline'}
            size={nested ? 16 : 18}
            color={c.liked ? colors.crush : colors.textMuted}
          />
          {c.likeCount > 0 ? (
            <Txt variant="caption" color={c.liked ? 'crush' : 'textMuted'} style={{ fontSize: 11 }}>
              {c.likeCount}
            </Txt>
          ) : null}
        </Pressable>
      )}
    </View>
  );
}
