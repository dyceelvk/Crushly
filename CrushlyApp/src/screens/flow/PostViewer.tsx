import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  FlatList,
  useWindowDimensions,
  type ViewToken,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { ReactionButton } from '../../components/feed/Reactions';
import { CrushIcon } from '../../components/Logo';
import { LinkText } from '../../components/LinkText';
import { useProfileTap } from '../../lib/useProfileTap';
import { useTrackPostView } from '../../lib/useTrackPostView';
import { PostViews } from '../../components/ViewersSheet';
import { KeepsYouChip } from '../../components/KeepsYouChip';
import { Avatar, Photo } from '../../components/Photo';
import { VerifiedBadge } from '../../components/Badges';
import { IconButton } from '../../components/IconButton';
import { EmptyState } from '../../components/States';
import { ShareToWhisper } from '../../components/ShareToWhisper';
import { EditPostSheet } from '../../components/EditPostSheet';
import { useMemberActions } from '../../state/memberActions';
import { BottomSheet, ConfirmSheet } from '../../components/BottomSheet';
import { CommentsSheet } from '../../components/feed/CommentsSheet';
import { useLayout } from '../../components/Layout';
import { useToast } from '../../components/Toast';
import {
  useDeletePost,
  useRankedFlow,
  useMe,
  useOpenConversation,
  usePost,
  useReactToPost,
  useSavePost,
} from '../../api/hooks';
import type { Post, ReactionKind } from '../../api/types';
import { REACTION_KINDS } from '../../api/types';
import { EditedClip } from '../../components/EditedClip';
import { mediaUrl } from '../../api/client';
import { mediaSource } from '../../lib/mediaHost';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { timeAgo } from '../../lib/format';
import { formatCount, spokenCount } from '../../lib/counts';
import { isOffPage, pageAt, stepIndex } from '../../lib/pageMath';
import { scrollerFrom } from '../../lib/webSnap';
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
  laugh: '#FFC940',
  wow: '#A040FF',
  fire: '#FF8A3D',
  sad: '#4FA8FF',
  angry: '#FF5C67',
  tired: '#8FA0B8',
  clap: '#00C6FF',
};

/** The same five reactions, drawn in the app's icon set rather than as emoji. */
const REACTION_ICON: Record<ReactionKind, keyof typeof Ionicons.glyphMap> = {
  crush: 'heart',
  laugh: 'happy',
  wow: 'alert-circle',
  fire: 'flame',
  sad: 'sad',
  angry: 'flame-outline',
  tired: 'cloudy-outline',
  clap: 'hand-left',
};

const REACTION_GLYPH: Record<ReactionKind, string> = {
  // Unused for crush — the mark is drawn instead — but kept so the map is total.
  crush: '',
  laugh: '😂',
  wow: '😲',
  fire: '🔥',
  sad: '😢',
  angry: '😡',
  tired: '😓',
  clap: '👏',
};

const REACTION_NAME: Record<ReactionKind, string> = {
  crush: 'Crush',
  laugh: 'Laugh',
  wow: 'Wow',
  fire: 'Fire',
  sad: 'Sad',
  angry: 'Angry',
  tired: 'Tired',
  clap: 'Clap',
};

/** A real vertical pager: neighbouring pages can load while the active clip plays. */
export function PostViewerScreen({ route, navigation }: ScreenProps<'PostViewer'>) {
  const initialId = route.params.postId;
  const flow = useRankedFlow();
  const { height } = useWindowDimensions();
  const focused = useIsFocused();
  const [activeId, setActiveId] = useState(initialId);
  // Keep the selected post first even when the ranked feed arrives later.
  /*
   * A post with no picture is not a page in a full-screen pager.
   *
   * It used to be: a paragraph marooned on a black page, its comments behind a
   * sheet, with no field to answer in. Words have their own screen now —
   * `TextPost` — and this pager carries only what is meant to own a whole
   * screen: a clip, or a photograph.
   */
  const ids = useMemo(
    () =>
      [initialId, ...flow.posts.filter((p) => !!p.mediaUrl).map((p) => p.id).filter((id) => id !== initialId)],
    [initialId, flow.posts],
  );
  const byId = useMemo(() => new Map(flow.posts.map((p) => [p.id, p])), [flow.posts]);
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems.find((item) => item.isViewable && typeof item.item === 'number');
    if (first) setActiveId(first.item as number);
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 65 }).current;
  /*
   * One gesture, one clip — the thing Instagram does, done in three places.
   *
   * What makes a reels feed feel like reels rather than a list is that a gesture
   * is answered with exactly one clip and a small overshoot when you push on.
   * `pagingEnabled` alone does not do that: on iOS a hard flick carries its own
   * momentum and can travel three pages, which is the "one scroll scrolls up to
   * three videos" the owner reported. Three mechanisms, one per input:
   *
   *  · **Finger (native)** — `snapToInterval` at exactly the page height plus
   *    `disableIntervalMomentum`, so the list stops at the next interval whatever
   *    the finger did, and `decelerationRate="fast"` for a quick settle rather
   *    than a long glide.
   *  · **Finger and wheel (web)** — react-native-web implements neither
   *    `disableIntervalMomentum` nor snap, so the *browser's* snap does the work:
   *    `scroll-snap-type: y mandatory` with `scroll-snap-stop: always`, which is
   *    the same guarantee (never rest on a half-cut clip, never skip one) given
   *    by the engine that actually owns the scroll. A mouse wheel is then taken
   *    as a gesture rather than a distance, one page per gesture, because a
   *    notched wheel sends a stream of events that Chrome reads as one long
   *    scroll and lands two clips down.
   *  · **Keyboard** — arrows and page keys move one page while the Flow is the
   *    screen in front.
   *
   * The page maths lives in `lib/pageMath` and is tested; the wheel listener is
   * on this pager's own scroller, never on `document`, so opening the Flow does
   * not take the wheel away from the rest of the app (`lib/webSnap` finds the
   * element).
   */
  const listRef = useRef<FlatList<number>>(null);
  const indexRef = useRef(0);
  const lockRef = useRef(false);
  /** True while this screen is the one in front — the wheel and keys are only ours then. */
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  /** The offset the list is at, so a settle can be checked without re-reading. */
  const offsetRef = useRef(0);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setIndex = useCallback((next: number) => {
    indexRef.current = next;
    const id = ids[next];
    if (id != null) setActiveId(id);
  }, [ids]);

  /** One gesture forward or back, never past either end. */
  const step = useCallback((direction: number) => {
    const next = stepIndex(indexRef.current, direction, ids.length);
    if (next === indexRef.current) return;
    listRef.current?.scrollToOffset({ offset: next * height, animated: true });
  }, [height, ids.length]);

  /** Put the list on the nearest whole page. Used by both platforms. */
  const settleToNearest = useCallback(() => {
    if (lockRef.current) return;
    const nearest = pageAt(offsetRef.current, height, ids.length);
    if (isOffPage(offsetRef.current, height)) {
      listRef.current?.scrollToOffset({ offset: nearest * height, animated: true });
    }
    if (nearest !== indexRef.current) setIndex(nearest);
  }, [height, ids.length, setIndex, step]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    /*
     * The pager, on the web, driven by us.
     *
     * Three separate faults made this feel like a free-scrolling document, and
     * each one alone was enough:
     *
     * 1. **Nothing scrolled.** The list had no height of its own, so it grew
     *    with its pages and the *document* scrolled instead — measured: a 390×844
     *    window with five clips gave `document.scrollHeight` of 4220 and no
     *    inner scroller at all. Every rule aimed at "the scroller" was attached
     *    to a div that never scrolls, which is why nothing we did to it changed
     *    anything. The list now has an explicit height (see the `style` below), so
     *    it is the element that scrolls.
     *
     * 2. **The browser's snap silently ate our animation.** With
     *    `scroll-snap-type: y mandatory` set, a *programmatic* smooth scroll is
     *    dropped: `scrollTo({top: 844, behavior: 'smooth'})` on a snapped
     *    container leaves it at 0, in this Chromium, every time — while an
     *    instant `scrollTop = 844` sticks. So "advance one page" did nothing, at
     *    all, and the clip never changed. Native snap is therefore **off**, and
     *    the movement is animated here by writing `scrollTop` frame by frame.
     *
     * 3. **A wheel is a gesture, not a distance.** A notched wheel sends a
     *    stream of events; taken as a distance they add up to four clips. One
     *    gesture is answered with exactly one clip, and the next is refused until
     *    the wheel goes quiet — then the movement is ours, so it always lands on
     *    a page boundary.
     *
     * Everything is attached to this pager's own element, never to `document`:
     * opening the Flow must not take the wheel away from the rest of the app.
     */
    let scroller = scrollerFrom(listRef);
    if (!scroller) {
      // Nothing looked scrollable. That is not a reason to fall back to the
      // document — it is a reason to make this list the scroller it was meant to
      // be, which is one height and one overflow away.
      const node = (listRef.current as unknown as { getScrollableNode?: () => HTMLElement } | null)?.getScrollableNode?.() ?? null;
      if (!node) return;
      node.style.height = `${height}px`;
      node.style.overflowY = 'auto';
      scroller = node;
    }
    const pageHeight = Math.max(height, 1);

    scroller.style.scrollSnapType = 'none';
    scroller.style.overscrollBehaviorY = 'contain';
    // The gesture is read here, not by the browser: without this a finger drag
    // on a phone browser scrolls the page and our handlers see nothing.
    scroller.style.touchAction = 'none';

    let raf = 0;
    let animating = false;
    /** Move to a page boundary, animated, by writing the offset each frame. */
    const animateTo = (target: number) => {
      const last = Math.max((ids.length - 1) * pageHeight, 0);
      const end = Math.min(Math.max(target, 0), last);
      const start = scroller.scrollTop;
      const distance = end - start;
      cancelAnimationFrame(raf);
      if (Math.abs(distance) < 1) {
        scroller.scrollTop = end;
        animating = false;
        setIndex(pageAt(end, pageHeight, ids.length));
        return;
      }
      const began = performance.now();
      const DURATION = 340;
      animating = true;
      const frame = (now: number) => {
        const k = Math.min(1, (now - began) / DURATION);
        // Ease-out cubic: fast off the mark, gentle landing — the way a paged
        // feed feels, and short enough that a second gesture is never queued
        // behind a long glide.
        const eased = 1 - Math.pow(1 - k, 3);
        scroller.scrollTop = start + distance * eased;
        if (k < 1) {
          raf = requestAnimationFrame(frame);
        } else {
          scroller.scrollTop = end;
          animating = false;
          // The clip in front is decided here — at rest — and never mid-move,
          // so two clips can never both be "active" and play at once.
          setIndex(pageAt(end, pageHeight, ids.length));
        }
      };
      raf = requestAnimationFrame(frame);
    };

    /** One gesture, one clip. */
    const go = (direction: number) => {
      const from = pageAt(scroller.scrollTop, pageHeight, ids.length);
      const next = stepIndex(from, direction, ids.length);
      if (next === from) return;
      animateTo(next * pageHeight);
    };

    let armed = true;
    let idle: number | null = null;
    const endGestureLater = () => {
      if (idle) window.clearTimeout(idle);
      idle = window.setTimeout(() => { armed = true; }, 170);
    };
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      if (!armed) { endGestureLater(); return; }
      armed = false;
      endGestureLater();
      go(event.deltaY > 0 ? 1 : -1);
    };
    scroller.addEventListener('wheel', onWheel, { passive: false });

    /* A finger drag on a phone browser, treated as one gesture too. */
    let dragFrom = 0;
    let dragging = false;
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') return;
      dragging = true;
      dragFrom = event.clientY;
      cancelAnimationFrame(raf);
      animating = false;
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      const dy = event.clientY - dragFrom;
      if (Math.abs(dy) < 24) return;
      go(dy < 0 ? 1 : -1);
    };
    scroller.addEventListener('pointerdown', onPointerDown);
    scroller.addEventListener('pointerup', onPointerUp);
    scroller.addEventListener('pointercancel', onPointerUp);

    /*
     * Anything that still moves the scroller without us — a scrollbar drag, a
     * restored offset, a trackpad the browser handled before the listener was
     * attached — is brought back to a whole page when it comes to rest. This is
     * also the only place that notices a move made by something else, so the
     * active clip is corrected here rather than by guessing mid-move.
     */
    let settle: number | null = null;
    const onScroll = () => {
      if (settle) window.clearTimeout(settle);
      settle = window.setTimeout(() => {
        if (animating) return;
        if (isOffPage(scroller.scrollTop, pageHeight)) {
          animateTo(pageAt(scroller.scrollTop, pageHeight, ids.length) * pageHeight);
          return;
        }
        const nearest = pageAt(scroller.scrollTop, pageHeight, ids.length);
        if (nearest !== indexRef.current) setIndex(nearest);
      }, 140);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });

    const onKey = (event: KeyboardEvent) => {
      if (!focusedRef.current) return;
      if (!['ArrowDown', 'PageDown', 'ArrowUp', 'PageUp'].includes(event.key)) return;
      event.preventDefault();
      go(event.key === 'ArrowDown' || event.key === 'PageDown' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('keydown', onKey);
      scroller.removeEventListener('wheel', onWheel);
      scroller.removeEventListener('pointerdown', onPointerDown);
      scroller.removeEventListener('pointerup', onPointerUp);
      scroller.removeEventListener('pointercancel', onPointerUp);
      scroller.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
      if (settle) window.clearTimeout(settle);
      if (idle) window.clearTimeout(idle);
      scroller.style.touchAction = '';
      scroller.style.overscrollBehaviorY = '';
    };
  }, [height, ids.length, setIndex]);


  return <FlatList
    ref={listRef}
    data={ids}
    /*
     * Its own height, exactly one page.
     *
     * Without this the list grows to the height of every clip and the **page**
     * scrolls, so the list is not a scroller at all and nothing can be snapped or
     * paged on it. Measured on a 390×844 window: five clips, no inner scroller,
     * `document.scrollHeight` 4220. Native lists are already bounded by the
     * screen, so this is only needed on the web — but `flex: 1` alone is not
     * enough there, which is why it is a number.
     */
    style={{ height }}
    keyExtractor={(id) => String(id)}
    /* Native snapping. On the web these are inert, which is why the wheel
       handler above exists. */
    snapToInterval={height}
    snapToAlignment="start"
    /* Deliberately *not* `pagingEnabled`: on iOS it lets a hard flick carry its
       own momentum across two or three pages, which is the bug this replaces. */
    disableIntervalMomentum
    decelerationRate="fast"
    showsVerticalScrollIndicator={false}
    windowSize={3}
    initialNumToRender={2}
    maxToRenderPerBatch={2}
    getItemLayout={(_data, index) => ({ length: height, offset: height * index, index })}
    onScroll={(e) => {
      /*
       * Remember where the list is; do not decide from it.
       *
       * This used to set the active page on every scroll event, which meant that
       * halfway through a glide to the next clip the *next* page became the
       * active one: the clip in front of you was paused (it was no longer the
       * active page) while the incoming one started playing, so a clip could sit
       * still and still be heard. The active page is now decided where the
       * scroll comes to rest — `settleToNearest` on a phone, the settle below on
       * the web — and never mid-move.
       */
      offsetRef.current = e.nativeEvent.contentOffset.y;
    }}
    scrollEventThrottle={32}
    /* A phone's snap can still rest a few pixels off if the list was dragged
       slowly and let go. One page, exactly. */
    /*
     * The same magnet on a phone.
     *
     * `snapToInterval` does the work while the finger is moving, but a slow drag
     * released with no momentum can settle wherever it was let go — that is the
     * half-cut frame. Both endings (a drag that stopped, a flick that ran out)
     * go through one correction: if the offset is not a page boundary, it goes
     * to the nearest one.
     */
    onMomentumScrollBegin={() => { if (settleTimer.current) clearTimeout(settleTimer.current); }}
    onScrollEndDrag={() => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => settleToNearest(), 200);
    }}
    onMomentumScrollEnd={(e) => {
      settleToNearest();
      const raw = e.nativeEvent.contentOffset.y / Math.max(height, 1);
      const nearest = Math.min(Math.max(Math.round(raw), 0), ids.length - 1);
      if (nearest !== indexRef.current) setIndex(nearest);
    }}
    onEndReached={() => flow.loadOlder()}
    onEndReachedThreshold={0.6}
    onViewableItemsChanged={onViewableItemsChanged}
    viewabilityConfig={viewabilityConfig}
    renderItem={({ item }) => <View style={{ height }}><PostViewerPage postId={item} navigation={navigation} active={focused && activeId === item} fallback={byId.get(item)} /></View>}
  />;
}

function PostViewerPage({ postId, navigation, active, fallback }: { postId: number; navigation: ScreenProps<'PostViewer'>['navigation']; active: boolean; fallback?: Post }) {
  const openProfile = useProfileTap();
  const insets = useSafeAreaInsets();
  const { contentWidth, gutter } = useLayout();
  const { colors } = useTheme();
  const toast = useToast();

  const { data: me } = useMe();
  // A post view must not go empty just because the post scrolled out of the
  // current feed page, so it is fetched directly and falls back to the page.
  const postQuery = usePost(postId);
  const post = postQuery.isError ? null : (postQuery.data ?? fallback ?? null);

  useTrackPostView(post?.id ?? null, active && !!post, post?.mine ?? false);
  const react = useReactToPost();
  const keep = useSavePost();
  const remove = useDeletePost();
  const openWhisper = useOpenConversation();

  const [expanded, setExpanded] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  // Share is a choice now: a person here, or somewhere else entirely.
  const [shareOpen, setShareOpen] = useState(false);
  // The three dots: everything you can do to a post that isn't a reaction.
  const [moreOpen, setMoreOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const { openActions } = useMemberActions();
  const lastTap = useRef(0);

  const authorName = post?.mine ? 'You' : post?.author.name ?? '';
  const close = useCallback(() => navigation.goBack(), [navigation]);

  // mediaSource() is a plain string on web but { uri, headers } on native when
  // the file is behind the media Worker.
  /**
   * The whole source, header included.
   *
   * This used to unwrap `{ uri, headers }` and keep only the `uri`, so the full
   * screen player asked the media Worker for a private file with no token and
   * was told 401 — a black stage, and a play button that did nothing because
   * there was nothing loaded to play.
   */
  const resolveVideoUri = useCallback((mediaPath: string | null) => {
    if (!mediaPath) return '';
    return mediaSource(mediaUrl(mediaPath));
  }, []);

  const reactWith = useCallback(
    async (kind: ReactionKind | null) => {
      if (!post) return;
      try {
        // `null` is the control saying "take my reaction back": the row goes,
        // and the mark returns to outline. Two taps in a row is a Crush and an
        // undo, which is the only way a tap can mean both.
        await react.mutateAsync({
          postId: post.id,
          liked: kind !== null,
          kind: kind ?? post.myReaction ?? 'crush',
        });
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
      await Clipboard.setStringAsync(post.body || `${authorName} on holUpp`);
      toast({ kind: 'success', title: 'Copied', message: 'The words are on your clipboard.' });
    } catch (e) {
      toast({ kind: 'error', title: 'Couldn’t copy', message: (e as Error).message });
    }
  }, [post, authorName, toast]);


  if (!post) {
    const loading = postQuery.isLoading && postQuery.data === undefined;
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

  const covered = commentsOpen || shareOpen || moreOpen || editOpen || confirmDelete;
  const playing = active && !covered;
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
            /* The stage is the box here, so the clip fills it rather than shaping
               itself. What fills the leftover space is the decision the stage
               makes: the whole picture stays visible, with a softened copy
               behind it when the frame does not match the screen.
               `controls` gives it the tap-to-pause it never had, and double tap
               still reacts: both gestures are decided in one place so a double
               tap cannot also fire the pause. */
            <EditedClip
              key={post.id}
              uri={resolveVideoUri(post.mediaUrl)}
              live={post.edit ?? null}
              /* A sheet over the clip means the clip is not being watched: the
                 comments, the share sheet and the editor all covered a clip that
                 carried on playing its soundtrack underneath. `playing` is the
                 page being in front *and* nothing being over it. */
              autoPlay={playing}
              loop
              fill
              fit="fit"
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
        colors={['rgba(7,7,8,0)', 'rgba(7,7,8,0.12)', 'rgba(7,7,8,0.48)']}
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 240 }}
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
            {post.audience === 'everyone' ? 'Public' : post.audience === 'private' ? 'Only you' : post.audience === 'circle' ? 'Circle' : 'Your connections'}
          </Txt>
        </View>
        {/* The three dots are for every post, not only your own: keeping a post,
            sending it to somebody, reporting it and deleting it all live here.
            Delete used to be the only thing in this corner, which meant the one
            destructive action in the app was also the easiest one to hit. */}
        <IconButton icon="ellipsis-horizontal" label="More for this post" variant="glass" onPress={() => setMoreOpen(true)} />
      </View>

      {/* ----------------------------------------------------------- the rail */}
      <View
        style={{
          position: 'absolute',
          right: gutter,
          bottom: insets.bottom + 132,
          alignItems: 'center',
          gap: space.lg,
          maxWidth: Math.min(contentWidth, 420) / 2,
        }}
      >
        {/*
          The same control as the feed, the text post and a comment: holUpp's
          mark in outline before you touch it, filled once you have, and a hold
          that floats the seven faces beside the button. This rail used to open a
          bottom sheet — a panel sliding up over the video you were watching —
          which is the one place a reaction sheet should never be.
        */}
        <View style={{ alignItems: 'center', gap: 4 }}>
          <ReactionButton
            myReaction={(post.myReaction ?? (post.liked ? 'crush' : null)) as ReactionKind | null}
            onReact={(kind) => void reactWith(kind)}
            size={26}
            framed
          />
          <Txt variant="caption" color="#FFFFFF" style={{ fontWeight: '600' }}>
            {spokenCount(totalReactions, 'Crush', 'Crushes')}
          </Txt>
        </View>
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
          label={post.saved ? 'Remove this Pick' : 'Pick this post'}
          count={post.saved ? 'Picked' : 'Pick'}
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
          bottom: insets.bottom + 92,
        }}
      >
        <PostViews post={post} light />
        <Pressable
          onPress={() => openProfile(post.author.id)}
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
                {[post.author.username ? `@${post.author.username}` : null, post.location ? `📍 ${post.location}` : null, timeAgo(post.createdAt)]
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
            label={post.saved ? 'Remove this Pick' : 'Pick this post'}
            hint={post.saved ? 'It leaves your Picked' : 'Picked is yours alone — nobody else sees it'}
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
            label="Share outside holUpp"
            onPress={() => {
              setMoreOpen(false);
              setShareOpen(true);
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

      {/* One comment sheet in the app, not two. The feed's, which knows about
          reactions and threading, so a post opened from a grid and a post
          opened in the feed do not answer the same tap differently. */}
      <CommentsSheet
        post={post}
        visible={commentsOpen}
        onClose={() => setCommentsOpen(false)}
        onOpenAuthor={(id) => openProfile(id)}
      />
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



