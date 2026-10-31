import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { LinkText } from '../../components/LinkText';
import { Avatar, Photo } from '../../components/Photo';
import { VerifiedBadge } from '../../components/Badges';
import { IconButton } from '../../components/IconButton';
import { EmptyState } from '../../components/States';
import { BottomSheet } from '../../components/BottomSheet';
import { useLayout } from '../../components/Layout';
import { useToast } from '../../components/Toast';
import {
  useCommentOnPost,
  useDeletePost,
  useDeletePostComment,
  useFlow,
  useLikePostComment,
  useMe,
  useOpenConversation,
  usePost,
  usePostComments,
  useReactToPost,
  useSavePost,
} from '../../api/hooks';
import type { Post, PostComment, ReactionKind } from '../../api/types';
import { REACTION_KINDS } from '../../api/types';
import { EditedClip } from '../../components/EditedClip';
import { mediaUrl } from '../../api/client';
import { mediaSource } from '../../lib/mediaHost';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { timeAgo } from '../../lib/format';
import { formatCount, spokenCount } from '../../lib/counts';
import type { RootStackParamList, ScreenProps } from '../../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * Watching one post.
 *
 * One deliberate surface: the clip holds the screen, everything you can do to
 * the post sits on a dock at the bottom, and the comments come up over it in a
 * sheet rather than pushing the post down a long scroll.
 *
 * The old shape stacked author, title, body, media, counts, actions and a flat
 * comment list into a single ScrollView, which meant the clip slid away as you
 * read and the comments were always below the fold. This keeps the thing you
 * came to watch in place.
 */
/** The palette's word for each reaction, so a like is the crush colour. */
const REACTION_TINT: Record<ReactionKind, string> = {
  crush: '#FF4081',
  fire: '#FF8A3D',
  laugh: '#FFC940',
  wow: '#A040FF',
  clap: '#00C6FF',
};

/** The same five reactions, drawn in the app's icon set rather than as emoji. */
const REACTION_ICON: Record<ReactionKind, keyof typeof Ionicons.glyphMap> = {
  crush: 'heart',
  fire: 'flame',
  laugh: 'happy',
  wow: 'alert-circle',
  clap: 'hand-left',
};

const REACTION_GLYPH: Record<ReactionKind, string> = {
  crush: '❤️',
  fire: '🔥',
  laugh: '😂',
  wow: '😮',
  clap: '👏',
};

const REACTION_NAME: Record<ReactionKind, string> = {
  crush: 'Crush',
  fire: 'Fire',
  laugh: 'Laugh',
  wow: 'Wow',
  clap: 'Clap',
};

export function PostViewerScreen({ route, navigation }: ScreenProps<'PostViewer'>) {
  const { postId } = route.params;
  const insets = useSafeAreaInsets();
  const { contentWidth, gutter } = useLayout();
  const { colors } = useTheme();
  const toast = useToast();

  const { data: me } = useMe();
  const flow = useFlow();
  // A post view must not go empty just because the post scrolled out of the
  // current feed page, so it is fetched directly and falls back to the page.
  const postQuery = usePost(postId);
  const post = postQuery.data ?? flow.data?.items.find((p) => p.id === postId) ?? null;

  const query = usePostComments(postId);
  const react = useReactToPost();
  const keep = useSavePost();
  const remove = useDeletePost();
  const removeComment = useDeletePostComment(postId);
  const likeComment = useLikePostComment(postId);
  const send = useCommentOnPost(postId);
  const openWhisper = useOpenConversation();

  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<PostComment | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const lastTap = useRef(0);

  const authorName = post?.mine ? 'You' : post?.author.name ?? '';
  const comments = query.data?.items ?? [];

  // One level of threading: replies hang off their parent, and a reply to a
  // reply is not allowed by the database either.
  const { roots, repliesByParent } = useMemo(() => {
    const roots: PostComment[] = [];
    const repliesByParent = new Map<number, PostComment[]>();
    for (const c of comments) {
      if (c.parentId) {
        const list = repliesByParent.get(c.parentId) ?? [];
        list.push(c);
        repliesByParent.set(c.parentId, list);
      } else {
        roots.push(c);
      }
    }
    return { roots, repliesByParent };
  }, [comments]);

  const close = useCallback(() => navigation.goBack(), [navigation]);

  // mediaSource() is a plain string on web but { uri, headers } on native when
  // the file is behind the media Worker.
  const resolveVideoUri = useCallback((mediaPath: string | null) => {
    if (!mediaPath) return '';
    const resolved = mediaSource(mediaUrl(mediaPath));
    return typeof resolved === 'string' ? resolved : resolved.uri;
  }, []);

  const reactWith = useCallback(
    async (kind: ReactionKind) => {
      if (!post) return;
      setReactionsOpen(false);
      try {
        await react.mutateAsync({ postId: post.id, liked: true, kind });
      } catch (e) {
        toast({ kind: 'error', title: 'Reaction not sent', message: (e as Error).message });
      }
    },
    [post, react, toast],
  );

  /** Tapping the heart clears your reaction; it does not flip to a different one. */
  const tapHeart = useCallback(async () => {
    if (!post) return;
    try {
      await react.mutateAsync({
        postId: post.id,
        liked: !post.liked,
        kind: post.myReaction ?? 'crush',
      });
    } catch (e) {
      toast({ kind: 'error', title: 'Reaction not sent', message: (e as Error).message });
    }
  }, [post, react, toast]);

  const onMediaTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTap.current < 320 && post && !post.liked) void reactWith('crush');
    lastTap.current = now;
  }, [post, reactWith]);

  const toggleKeep = useCallback(async () => {
    if (!post) return;
    try {
      await keep.mutateAsync({ postId: post.id, saved: !post.saved });
    } catch (e) {
      toast({ kind: 'error', title: 'Not kept', message: (e as Error).message });
    }
  }, [post, keep, toast]);

  const submitComment = useCallback(async () => {
    const body = draft.trim();
    if (!body) return;
    const parent = replyTo;
    setDraft('');
    setReplyTo(null);
    try {
      await send.mutateAsync({ body, parentId: parent?.id ?? null });
    } catch (e) {
      setDraft(body);
      setReplyTo(parent);
      toast({ kind: 'error', title: 'Comment not added', message: (e as Error).message });
    }
  }, [draft, replyTo, send, toast]);

  const deletePost = useCallback(async () => {
    if (!post) return;
    try {
      await remove.mutateAsync(post.id);
      close();
    } catch (e) {
      toast({ kind: 'error', title: 'Not deleted', message: (e as Error).message });
    }
  }, [post, remove, close, toast]);

  const whisper = useCallback(async () => {
    if (!post) return;
    try {
      const conv = await openWhisper.mutateAsync(post.author.id);
      navigation.navigate('Chat', { conversationId: conv.id });
    } catch (e) {
      toast({ kind: 'error', title: 'Couldn’t open your Whisper', message: (e as Error).message });
    }
  }, [post, openWhisper, navigation, toast]);

  const share = useCallback(async () => {
    if (!post) return;
    try {
      await Share.share({
        message: post.body ? `${post.body}\n\n— ${authorName} on Crushly` : `${authorName} on Crushly`,
      });
    } catch {
      // Backing out of a share sheet is not a failure worth reporting.
    }
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

  const kinds = post.reactionKinds ?? {};
  const totalReactions = (Object.values(kinds) as number[]).reduce((a, b) => a + b, 0) || post.likeCount;
  const topKinds = REACTION_KINDS.filter((k) => (kinds[k] ?? 0) > 0).slice(0, 3);
  const body = post.body ?? '';
  const needsReadMore = body.length > 140;

  return (
    <View style={{ flex: 1, backgroundColor: '#05060f' }}>
      {/* ---------------------------------------------------------- the stage */}
      <Pressable
        onPress={onMediaTap}
        accessibilityLabel={post.mediaKind === 'video' ? 'Video post, double tap to react' : 'Post'}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      >
        {post.mediaUrl ? (
          post.mediaKind === 'video' ? (
            /* The stage is the box here, so the clip fills it and letterboxes
               inside it rather than shaping itself — a 16:9 clip on a phone
               screen is a band with black above and below, which is correct.
               `controls` gives it the tap-to-pause it never had, and double tap
               still reacts: both gestures are decided in one place so a double
               tap cannot also fire the pause. */
            <EditedClip
              uri={resolveVideoUri(post.mediaUrl)}
              live={post.edit ?? null}
              autoPlay
              loop
              fill
              controls
              onDoubleTap={() => void reactWith('crush')}
              style={{ width: '100%', height: '100%' }}
              accessibilityLabel={`Video by ${authorName}`}
            />
          ) : (
            /* A photo viewer fills the stage. `contain` letterboxes, and the
               letterbox is black — which on this screen read as a broken layout
               with a band of nothing above and below the picture. */
            <Photo
              uri={post.mediaUrl}
              fit="cover"
              contentPosition="center"
              style={{ width: '100%', height: '100%' }}
              alt={`Post by ${authorName}`}
            />
          )
        ) : (
          <LinearGradient
            colors={['#101a3d', '#2a1747', '#0A0E27']}
            start={{ x: 0.1, y: 0 }}
            end={{ x: 0.9, y: 1 }}
            style={{ width: '100%', height: '100%' }}
          />
        )}
      </Pressable>

      {/* Scrims so the words are readable over any frame. */}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(7,7,8,0.82)', 'rgba(7,7,8,0.14)', 'rgba(7,7,8,0)']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 190 }}
      />
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(7,7,8,0)', 'rgba(7,7,8,0.72)', 'rgba(7,7,8,0.96)']}
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 430 }}
      />

      {/* ------------------------------------------------------------ top bar */}
      <View
        style={{
          position: 'absolute',
          top: insets.top + space.xs,
          left: gutter,
          right: gutter,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
        }}
      >
        <IconButton icon="close" label="Close" variant="glass" onPress={close} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt variant="caption" color="textMuted" style={{ letterSpacing: 1.4 }}>
            THE FLOW
          </Txt>
          <Txt variant="bodyStrong" numberOfLines={1}>
            {post.audience === 'everyone' ? 'Everyone' : 'Your connections'}
          </Txt>
        </View>
        {post.mine ? (
          <IconButton icon="trash-outline" label="Delete post" variant="glass" onPress={deletePost} />
        ) : null}
      </View>

      {/* ----------------------------------------------------------- the rail */}
      <View
        style={{
          position: 'absolute',
          right: gutter,
          bottom: insets.bottom + 168,
          alignItems: 'center',
          gap: space.lg,
          maxWidth: Math.min(contentWidth, 420) / 2,
        }}
      >
        <RailAction
          icon={post.liked ? 'heart' : 'heart-outline'}
          tint={post.liked ? colors.crush : '#FFFFFF'}
          label={post.liked ? 'Take back your reaction' : 'React to this post, hold for more'}
          count={formatCount(totalReactions)}
          spoken={spokenCount(totalReactions, 'reaction')}
          onPress={tapHeart}
          onLongPress={() => setReactionsOpen(true)}
        />
        <RailAction
          icon="chatbubble-ellipses-outline"
          label="Open comments"
          count={formatCount(post.commentCount)}
          spoken={spokenCount(post.commentCount, 'comment')}
          onPress={() => setCommentsOpen(true)}
        />
        <RailAction
          icon={post.saved ? 'bookmark' : 'bookmark-outline'}
          tint={post.saved ? colors.primary : '#FFFFFF'}
          label={post.saved ? 'Let it go' : 'Keep for later'}
          count={post.saved ? 'Kept' : 'Keep'}
          onPress={toggleKeep}
        />
        <RailAction icon="arrow-redo-outline" label="Share this post" count="Share" onPress={share} />
      </View>

      {/* -------------------------------------------------------- the caption */}
      <View
        style={{
          position: 'absolute',
          left: gutter,
          right: gutter + 76,
          bottom: insets.bottom + 132,
        }}
      >
        <Pressable
          onPress={() =>
            post.mine
              ? navigation.navigate('Main', { screen: 'Profile' })
              : navigation.navigate('UserProfile', { id: post.author.id })
          }
          accessibilityRole="button"
          accessibilityLabel={`Open ${authorName}’s Space`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 8 }}
        >
          <Avatar
            uri={post.author.photos[0]?.url ?? null}
            name={post.author.name}
            size={34}
            ring={post.author.verified ? 'gold' : undefined}
          />
          <View style={{ flexShrink: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Txt variant="bodyStrong" numberOfLines={1}>
                {authorName}
              </Txt>
              {post.author.verified ? <VerifiedBadge size={13} /> : null}
            </View>
            <Txt variant="caption" color="textMuted" numberOfLines={1}>
              {[post.author.username ? `@${post.author.username}` : null, timeAgo(post.createdAt)]
                .filter(Boolean)
                .join(' · ')}
            </Txt>
          </View>
        </Pressable>

        {body ? (
          <View>
            <Txt
              variant="body"
              numberOfLines={expanded ? undefined : 2}
              style={{ lineHeight: 21, color: '#FFFFFF' }}
              selectable
            >
              <LinkText text={body} bare />
            </Txt>
            {needsReadMore && !expanded ? (
              <Pressable
                onPress={() => setExpanded(true)}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Read the whole caption"
                style={{ marginTop: 4, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 2 }}
              >
                <Txt variant="caption" color="textSecondary">
                  Read more
                </Txt>
                <Ionicons name="chevron-down" size={12} color={colors.textSecondary} />
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* Who reacted, and with what — the count becomes a breakdown. */}
        {topKinds.length > 0 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: 10 }}>
            {/* Overlapping discs with the app's own icon set in them. The emoji
                version sat next to an Ionicons heart in the rail and read as two
                different products sharing a screen. */}
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {topKinds.map((k, i) => (
                <View
                  key={k}
                  style={{
                    width: 20, height: 20, borderRadius: 10,
                    backgroundColor: REACTION_TINT[k],
                    borderWidth: 1.5, borderColor: '#05060f',
                    alignItems: 'center', justifyContent: 'center',
                    marginLeft: i === 0 ? 0 : -6,
                  }}
                >
                  <Ionicons name={REACTION_ICON[k]} size={10} color="#FFFFFF" />
                </View>
              ))}
            </View>
            <Txt variant="numeric" color="textSecondary">
              {formatCount(totalReactions)} reacted
            </Txt>
          </View>
        ) : null}

        {post.edit?.look?.music ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
            <Ionicons name="musical-notes" size={12} color="#FFFFFF" />
            <Txt variant="caption" color="textSecondary" numberOfLines={1}>
              Original sound · {authorName}
            </Txt>
          </View>
        ) : null}
      </View>

      {/* ------------------------------------------------- the docked control plane */}
      <View
        style={{
          position: 'absolute',
          left: gutter,
          right: gutter,
          bottom: insets.bottom + space.xs,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          height: 52,
          paddingHorizontal: 8,
          borderRadius: radius.lg,
          backgroundColor: 'rgba(16,16,20,0.82)',
          borderWidth: 1,
          borderColor: colors.borderStrong,
        }}
      >
        <Pressable
          onPress={() => setCommentsOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Add a comment"
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9, paddingLeft: 8 }}
        >
          <Avatar uri={me?.profile.photos[0]?.url ?? null} name={me?.profile.name || 'You'} size={28} />
          <Txt variant="small" color="textMuted" numberOfLines={1} style={{ flex: 1 }}>
            Add a thought…
          </Txt>
        </Pressable>
        {!post.mine && post.author.crush?.mutual ? (
          <Pressable
            onPress={whisper}
            accessibilityRole="button"
            accessibilityLabel="Whisper this person"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: 14,
              height: 38,
              borderRadius: radius.md,
              backgroundColor: colors.gold,
            }}
          >
            <Ionicons name="send" size={14} color={colors.onGold} />
            <Txt variant="bodyStrong" style={{ color: colors.onGold }}>
              Whisper
            </Txt>
          </Pressable>
        ) : null}
      </View>

      {/* ------------------------------------------------- reaction picker */}
      <BottomSheet
        visible={reactionsOpen}
        onClose={() => setReactionsOpen(false)}
        title="React"
        subtitle="The same words a Moment accepts."
        maxHeight={0.34}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: space.md }}>
          {REACTION_KINDS.map((kind) => {
            const on = post.myReaction === kind;
            return (
              <Pressable
                key={kind}
                onPress={() => void reactWith(kind)}
                accessibilityRole="button"
                accessibilityLabel={REACTION_NAME[kind]}
                style={{
                  alignItems: 'center',
                  gap: 6,
                  paddingVertical: space.sm,
                  paddingHorizontal: space.xs,
                  borderRadius: radius.md,
                  backgroundColor: on ? colors.crushSoft : 'transparent',
                  minWidth: 56,
                }}
              >
                <Txt style={{ fontSize: 26 }}>{REACTION_GLYPH[kind]}</Txt>
                <Txt variant="caption" color={on ? 'crush' : 'textMuted'}>
                  {REACTION_NAME[kind]}
                </Txt>
              </Pressable>
            );
          })}
        </View>
      </BottomSheet>

      {/* ---------------------------------------------------- the comment sheet */}
      <BottomSheet
        visible={commentsOpen}
        onClose={() => {
          setCommentsOpen(false);
          setReplyTo(null);
        }}
        title="Thoughts"
        subtitle={`${post.commentCount} under this post · ${post.audience === 'everyone' ? 'everyone' : 'connections only'}`}
        maxHeight={0.86}
        footer={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
            <Avatar uri={me?.profile.photos[0]?.url ?? null} name={me?.profile.name || 'You'} size={30} />
            <View
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                height: 40,
                paddingHorizontal: 13,
                borderRadius: radius.pill,
                backgroundColor: colors.elevated,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder={replyTo ? `Reply to ${replyTo.author.name}…` : 'Add a thought…'}
                placeholderTextColor={colors.textMuted}
                onSubmitEditing={() => void submitComment()}
                returnKeyType="send"
                style={{ flex: 1, color: colors.text, paddingVertical: 0 }}
                accessibilityLabel="Write a comment"
              />
            </View>
            <Pressable
              onPress={() => void submitComment()}
              disabled={!draft.trim() || send.isPending}
              accessibilityRole="button"
              accessibilityLabel="Send comment"
              style={{
                width: 38,
                height: 38,
                borderRadius: 19,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: draft.trim() ? colors.gold : colors.elevated,
              }}
            >
              {send.isPending ? (
                <ActivityIndicator size="small" color={colors.onGold} />
              ) : (
                <Ionicons
                  name="arrow-forward"
                  size={17}
                  color={draft.trim() ? colors.onGold : colors.textMuted}
                />
              )}
            </Pressable>
          </View>
        }
      >
        {replyTo ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingVertical: 8,
              paddingHorizontal: space.sm,
              borderRadius: radius.sm,
              backgroundColor: colors.primarySoft,
              marginBottom: space.xs,
            }}
          >
            <Txt variant="caption" color="textSecondary" style={{ flex: 1 }} numberOfLines={1}>
              Replying to {replyTo.author.name}
            </Txt>
            <Pressable onPress={() => setReplyTo(null)} accessibilityLabel="Cancel reply" hitSlop={10}>
              <Ionicons name="close" size={15} color={colors.textMuted} />
            </Pressable>
          </View>
        ) : null}

        {query.isLoading ? (
          <View style={{ paddingVertical: space.xxl, alignItems: 'center' }}>
            <ActivityIndicator color={colors.gold} />
          </View>
        ) : roots.length === 0 ? (
          <View style={{ paddingVertical: space.xxl, alignItems: 'center', gap: 6 }}>
            <Ionicons name="chatbubble-outline" size={22} color={colors.textMuted} />
            <Txt variant="small" color="textMuted">
              No comments yet. Be the first.
            </Txt>
          </View>
        ) : (
          roots.map((c) => (
            <CommentRow
              key={c.id}
              comment={c}
              replies={repliesByParent.get(c.id) ?? []}
              postAuthorId={post.author.id}
              onReply={() => setReplyTo(c)}
              onLike={() =>
                void likeComment.mutate({ commentId: c.id, liked: !c.liked })
              }
              onLikeReply={(r) =>
                void likeComment.mutate({ commentId: r.id, liked: !r.liked })
              }
              onDelete={() => void removeComment.mutate(c.id)}
              onDeleteReply={(r) => void removeComment.mutate(r.id)}
            />
          ))
        )}
      </BottomSheet>
    </View>
  );
}

/* --------------------------------------------------------------------- pieces */

/**
 * One control in the viewer's rail.
 *
 * The button is a 46pt glass disc and the word under it is the same shape for
 * every action — a count for the things that have one, a verb for the things
 * that don't. It used to also draw a second, smaller glyph underneath for the
 * reader's own reaction, which was the same fact the filled heart was already
 * telling them, in a size too small to read.
 */
function RailAction({
  icon,
  label,
  count,
  spoken,
  tint = '#FFFFFF',
  onPress,
  onLongPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  count: string;
  /** The exact, unshortened figure for assistive tech. See lib/counts. */
  spoken?: string;
  tint?: string;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={380}
      accessibilityRole="button"
      accessibilityLabel={spoken ? `${label}, ${spoken}` : label}
      hitSlop={8}
      style={{ alignItems: 'center', gap: 4 }}
    >
      <View
        style={{
          width: 46,
          height: 46,
          borderRadius: 23,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(20,20,23,0.58)',
          borderWidth: 1,
          borderColor: colors.borderStrong,
        }}
      >
        <Ionicons name={icon} size={21} color={tint} />
      </View>
      <Txt variant="numeric" style={{ color: tint }} numberOfLines={1}>
        {count}
      </Txt>
    </Pressable>
  );
}

function CommentRow({
  comment,
  replies,
  postAuthorId,
  onReply,
  onLike,
  onLikeReply,
  onDelete,
  onDeleteReply,
}: {
  comment: PostComment;
  replies: PostComment[];
  postAuthorId: number;
  onReply: () => void;
  onLike: () => void;
  onLikeReply: (r: PostComment) => void;
  onDelete: () => void;
  onDeleteReply: (r: PostComment) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <CommentBody
        c={comment}
        postAuthorId={postAuthorId}
        onReply={onReply}
        onLike={onLike}
        onDelete={onDelete}
      />
      {replies.length > 0 ? (
        <View
          style={{
            marginTop: space.sm,
            marginLeft: space.lg,
            paddingLeft: space.sm,
            borderLeftWidth: 2,
            borderLeftColor: colors.border,
            gap: space.sm,
          }}
        >
          {replies.map((r) => (
            <CommentBody
              key={r.id}
              c={r}
              postAuthorId={postAuthorId}
              onReply={onReply}
              onLike={() => onLikeReply(r)}
              onDelete={() => onDeleteReply(r)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function CommentBody({
  c,
  postAuthorId,
  onReply,
  onLike,
  onDelete,
}: {
  c: PostComment;
  postAuthorId: number;
  onReply: () => void;
  onLike: () => void;
  onDelete: () => void;
}) {
  const { colors } = useTheme();
  const isAuthor = c.author.id === postAuthorId;
  return (
    <View style={{ flexDirection: 'row', gap: 9 }}>
      <Avatar uri={c.author.photos[0]?.url ?? null} name={c.author.name} size={30} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Txt variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
            {c.mine ? 'You' : c.author.name}
          </Txt>
          {isAuthor ? (
            <View
              style={{
                paddingHorizontal: 5,
                paddingVertical: 1,
                borderRadius: 4,
                backgroundColor: colors.primarySoft,
                borderWidth: 1,
                borderColor: colors.primaryLine,
              }}
            >
              <Txt variant="caption" color="gold" style={{ fontSize: 9, letterSpacing: 0.6 }}>
                AUTHOR
              </Txt>
            </View>
          ) : null}
          <Txt variant="caption" color="textMuted" style={{ marginLeft: 'auto' }}>
            {timeAgo(c.createdAt)}
          </Txt>
        </View>

        <Txt variant="small" style={{ marginTop: 3, color: c.hidden ? colors.textMuted : colors.text }}>
          {c.hidden ? 'This comment was removed.' : c.body}
        </Txt>

        {c.hidden ? null : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: 7 }}>
            <Pressable
              onPress={onLike}
              accessibilityRole="button"
              accessibilityLabel={c.liked ? 'Take back your like' : 'Like this comment'}
              hitSlop={8}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
            >
              <Ionicons
                name={c.liked ? 'heart' : 'heart-outline'}
                size={13}
                color={c.liked ? colors.crush : colors.textMuted}
              />
              <Txt variant="caption" color={c.liked ? 'crush' : 'textMuted'} style={{ fontWeight: '700' }}>
                {c.likeCount && c.likeCount > 0 ? String(c.likeCount) : 'Like'}
              </Txt>
            </Pressable>
            <Pressable onPress={onReply} accessibilityRole="button" accessibilityLabel="Reply" hitSlop={8}>
              <Txt variant="caption" color="textMuted" style={{ fontWeight: '700' }}>
                Reply
              </Txt>
            </Pressable>
            {c.canDelete ?? c.mine ? (
              <Pressable onPress={onDelete} accessibilityRole="button" accessibilityLabel="Delete comment" hitSlop={8}>
                <Txt variant="caption" color="textMuted" style={{ fontWeight: '700' }}>
                  Delete
                </Txt>
              </Pressable>
            ) : null}
          </View>
        )}
      </View>
    </View>
  );
}

