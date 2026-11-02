import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  PanResponder,
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
import { KeepsYouChip } from '../../components/KeepsYouChip';
import { Suggestions } from '../../components/Suggestions';
import { useMentionInput } from '../../components/useMentionInput';
import { Avatar, Photo } from '../../components/Photo';
import { VerifiedBadge } from '../../components/Badges';
import { IconButton } from '../../components/IconButton';
import { EmptyState } from '../../components/States';
import { ShareToWhisper } from '../../components/ShareToWhisper';
import { EditPostSheet } from '../../components/EditPostSheet';
import { useMemberActions } from '../../state/memberActions';
import { BottomSheet, ConfirmSheet } from '../../components/BottomSheet';
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
import type { StageFit } from '../../lib/videoFrame';
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
  // A comment is words too: `@` names somebody, `#` reaches a tag.
  const commentInput = useMentionInput(draft, setDraft);
  const [replyTo, setReplyTo] = useState<PostComment | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [reactionsOpen, setReactionsOpen] = useState(false);
  // Share is a choice now: a person here, or somewhere else entirely.
  const [shareOpen, setShareOpen] = useState(false);
  // The three dots: everything you can do to a post that isn't a reaction.
  const [moreOpen, setMoreOpen] = useState(false);
  // How a clip sits on the full-screen stage. `fit` shows the whole frame and
  // fills the space around it with a soft copy of itself; `fill` crops to the
  // screen and leaves no space at all. See `stageFit` in lib/videoFrame.
  const [stageFitMode, setStageFitMode] = useState<StageFit>('fit');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const { openActions } = useMemberActions();
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

  const memberForActions = {
    id: post?.author.id ?? 0,
    name: post?.author.name ?? 'Member',
    age: undefined,
    connected: !!post?.author.crush?.mutual,
    context: `post:${post?.id ?? 0}`,
    onGone: () => close(),
  };

  const whisper = useCallback(async () => {
    if (!post) return;
    try {
      const conv = await openWhisper.mutateAsync(post.author.id);
      navigation.navigate('Chat', { conversationId: conv.id });
    } catch (e) {
      toast({ kind: 'error', title: 'Couldn’t open your Whisper', message: (e as Error).message });
    }
  }, [post, openWhisper, navigation, toast]);

  /** The words, on the clipboard — the commonest reason to want a menu here. */
  const copyWords = useCallback(async () => {
    if (!post) return;
    try {
      const Clipboard = await import('expo-clipboard');
      await Clipboard.setStringAsync(post.body || `${authorName} on Crushly`);
      toast({ kind: 'success', title: 'Copied', message: 'The words are on your clipboard.' });
    } catch (e) {
      toast({ kind: 'error', title: 'Couldn’t copy', message: (e as Error).message });
    }
  }, [post, authorName, toast]);

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

  /**
   * The reel.
   *
   * Watching one post at a time was the right shape; being trapped in the one
   * you tapped was not. The order is the feed's own order, so swiping up is
   * simply "the next thing down the list" — no new list, no new fetch, no
   * second definition of what comes next.
   */
  const reel = flow.data?.items ?? [];
  const at = post ? reel.findIndex((x) => x.id === post.id) : -1;
  const nextPost = at >= 0 && at < reel.length - 1 ? reel[at + 1] : null;
  const prevPost = at > 0 ? reel[at - 1] : null;

  const step = useCallback(
    (dir: 1 | -1) => {
      // The ends are glued, not announced. A toast saying "that's the most
      // recent" turns a swipe into a lecture; the reel simply stops, the way a
      // physical reel does when it reaches the end.
      const target = dir === 1 ? nextPost : prevPost;
      if (!target) return;
      // The same screen, showing the next post: the route is the only state, so
      // Back still leaves the viewer rather than walking the reel.
      navigation.setParams({ postId: target.id });
    },
    [nextPost, prevPost, navigation, toast],
  );
  const stepRef = useRef(step);
  stepRef.current = step;

  // A sheet on top owns the gesture: nothing should page the reel out from
  // under a comment somebody is halfway through writing.
  const sheetOpen = commentsOpen || shareOpen || moreOpen || reactionsOpen || editOpen || confirmDelete;
  const sheetRef = useRef(sheetOpen);
  sheetRef.current = sheetOpen;

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        !sheetRef.current && Math.abs(g.dy) > 26 && Math.abs(g.dy) > Math.abs(g.dx) * 1.6,
      onPanResponderRelease: (_e, g) => {
        if (g.dy < -60) stepRef.current(1);
        else if (g.dy > 60) stepRef.current(-1);
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

  const kinds = post.reactionKinds ?? {};
  const totalReactions = (Object.values(kinds) as number[]).reduce((a, b) => a + b, 0) || post.likeCount;
  const topKinds = REACTION_KINDS.filter((k) => (kinds[k] ?? 0) > 0).slice(0, 3);
  const body = post.body ?? '';
  const needsReadMore = body.length > 140;

  return (
    <View style={{ flex: 1, backgroundColor: '#05060f' }} {...pan.panHandlers}>
      {/* ---------------------------------------------------------- the stage */}
      <Pressable
        onPress={onMediaTap}
        accessibilityLabel={post.mediaKind === 'video' ? 'Video post, double tap to react' : 'Post'}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      >
        {post.mediaUrl ? (
          post.mediaKind === 'video' ? (
            /* The stage is the box here, so the clip fills it rather than shaping
               itself. What fills the leftover space is the decision the stage
               makes: a landscape clip used to be letterboxed in black, which
               read as a fault rather than a frame. Now the whole picture sits on
               a blurred copy of itself, and the button in the top bar swaps that
               for a crop that leaves no space at all.
               `controls` gives it the tap-to-pause it never had, and double tap
               still reacts: both gestures are decided in one place so a double
               tap cannot also fire the pause. */
            <EditedClip
              uri={resolveVideoUri(post.mediaUrl)}
              live={post.edit ?? null}
              autoPlay
              loop
              fill
              fit={stageFitMode}
              controls
              holdToPause
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
          /* A post with no photograph is not a broken photograph.
             It used to render an empty gradient behind a question mark of
             nothing, which read as a failed image — and then somebody tapping a
             text post from a Circle got a black screen with the words stranded
             at the bottom of it. Words-only posts get their words, big, in the
             middle of the stage, where a viewer expects to find something. */
          <>
            <LinearGradient
              colors={['#101a3d', '#2a1747', '#0A0E27']}
              start={{ x: 0.1, y: 0 }}
              end={{ x: 0.9, y: 1 }}
              style={{ width: '100%', height: '100%' }}
            />
            <View style={{ position: 'absolute', left: gutter, right: gutter, top: '18%', alignItems: 'center' }}>
              <Txt variant="title" align="center" color="#FFFFFF" numberOfLines={12} style={{ maxWidth: 520 }}>
                {post.body || 'No words.'}
              </Txt>
            </View>
          </>
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
        {/* The three dots are for every post, not only your own: keeping a post,
            sending it to somebody, reporting it and deleting it all live here.
            Delete used to be the only thing in this corner, which meant the one
            destructive action in the app was also the easiest one to hit. */}
        {post.mediaKind === 'video' ? (
          <IconButton
            icon={stageFitMode === 'fit' ? 'expand-outline' : 'contract-outline'}
            label={stageFitMode === 'fit' ? 'Fill the screen' : 'See the whole frame'}
            variant="glass"
            onPress={() => setStageFitMode(stageFitMode === 'fit' ? 'fill' : 'fit')}
          />
        ) : null}
        <IconButton icon="ellipsis-horizontal" label="More for this post" variant="glass" onPress={() => setMoreOpen(true)} />
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
        <RailAction icon="arrow-redo-outline" label="Share this post" count="Share" onPress={() => setShareOpen(true)} />
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
              <VerifiedBadge size={13} tier={post.author.badgeTier ?? (post.author.verified ? 'verified' : 'none')} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Txt variant="caption" color="textMuted" numberOfLines={1}>
                {[post.author.username ? `@${post.author.username}` : null, timeAgo(post.createdAt)]
                  .filter(Boolean)
                  .join(' · ')}
              </Txt>
              {post.author.keepsYou ? <KeepsYouChip /> : null}
            </View>
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
      <ShareToWhisper visible={shareOpen} post={post} onClose={() => setShareOpen(false)} />

      <EditPostSheet post={post} visible={editOpen} onClose={() => setEditOpen(false)} />

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


      {/* ------------------------------------------------------- the dots menu */}
      <BottomSheet
        visible={moreOpen}
        onClose={() => setMoreOpen(false)}
        title="This post"
        subtitle={post.mine ? 'You wrote this one.' : `By ${authorName}`}
      >
        <View style={{ paddingHorizontal: space.md, paddingBottom: space.lg }}>
          <SheetRow
            icon="paper-plane-outline"
            label="Send to a Whisper"
            hint="Pick the person it’s for"
            onPress={() => {
              setMoreOpen(false);
              setShareOpen(true);
            }}
          />
          <SheetRow
            icon={post.saved ? 'bookmark' : 'bookmark-outline'}
            label={post.saved ? 'Let it go' : 'Keep for later'}
            hint={post.saved ? 'It leaves your kept posts' : 'Only you can see what you keep'}
            onPress={() => {
              setMoreOpen(false);
              void toggleKeep();
            }}
          />
          {post.body ? (
            <SheetRow icon="copy-outline" label="Copy the words" onPress={() => { setMoreOpen(false); void copyWords(); }} />
          ) : null}
          <SheetRow
            icon="share-social-outline"
            label="Share outside Crushly"
            onPress={() => {
              setMoreOpen(false);
              void share();
            }}
          />
          {post.mine ? (
            <SheetRow
              icon="create-outline"
              label="Edit the words"
              hint="Reword it, or change who can see it"
              onPress={() => {
                setMoreOpen(false);
                setEditOpen(true);
              }}
            />
          ) : null}
          {post.mine ? (
            <SheetRow
              icon="trash-outline"
              label="Delete this post"
              hint="It goes for everyone, right away"
              destructive
              onPress={() => {
                setMoreOpen(false);
                setConfirmDelete(true);
              }}
            />
          ) : (
            <SheetRow
              icon="flag-outline"
              label={`Report or block ${authorName}`}
              onPress={() => {
                setMoreOpen(false);
                openActions(memberForActions);
              }}
            />
          )}
        </View>
      </BottomSheet>

      {/* Delete asks once, from the dots menu, rather than firing on a tap. */}
      <ConfirmSheet
        visible={confirmDelete}
        title="Delete this post?"
        message="It disappears for everyone, right away. This can’t be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          setConfirmDelete(false);
          void deletePost();
        }}
        onCancel={() => setConfirmDelete(false)}
      />

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
          <>
            {/* The list opens above the box it belongs to, not over it. */}
            <Suggestions token={commentInput.token} onPick={commentInput.pick} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: commentInput.token ? 8 : 0 }}>
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
                onChangeText={commentInput.onChangeText}
                onSelectionChange={commentInput.onSelectionChange}
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
          </>
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

/**
 * One line in the dots menu.
 *
 * A row, not a button: an icon, a name, and at most one line about what happens
 * next. Every action here is undoable or asks first, so nothing needs to shout.
 */
function SheetRow({
  icon,
  label,
  hint,
  destructive,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint?: string;
  destructive?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const tint = destructive ? colors.danger : colors.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={hint ? `${label}. ${hint}` : label}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingVertical: 14,
        paddingHorizontal: 4,
        borderRadius: radius.md,
        backgroundColor: pressed ? colors.elevated : 'transparent',
      })}
    >
      <Ionicons name={icon} size={20} color={destructive ? colors.danger : colors.textSecondary} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="bodyStrong" color={destructive ? 'danger' : 'text'} numberOfLines={1}>
          {label}
        </Txt>
        {hint ? (
          <Txt variant="caption" color="textMuted" numberOfLines={1}>
            {hint}
          </Txt>
        ) : null}
      </View>
    </Pressable>
  );
}

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

        {/* A comment can name somebody and reach a tag, so it is read the same
            way a post is: handles and hashtags are tappable. */}
        {c.hidden ? (
          <Txt variant="small" color="textMuted" style={{ marginTop: 3 }}>
            This comment was removed.
          </Txt>
        ) : (
          <View style={{ marginTop: 3 }}>
            <LinkText text={c.body} variant="small" />
          </View>
        )}

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

