import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View, useWindowDimensions, type ViewToken } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { FeedPost } from '../../components/feed/FeedPost';
import { FeedTabs, type FeedTab } from '../../components/feed/FeedTabs';
import { ShareToWhisper } from '../../components/ShareToWhisper';
import { CommentsSheet } from '../../components/feed/CommentsSheet';
import { NotificationsSheet } from '../../components/NotificationsSheet';
import { CrushesFeed } from '../crushes/CrushesFeed';
import { CirclesStrip } from '../../components/circles/CirclesStrip';
import { CircleHighlights } from '../../components/circles/CircleHighlights';
import { EmptyState, ErrorState, Skeleton } from '../../components/States';
import { useBadges, useFlow, usePostDwell, useRankedFlow, useReactToPost, useSavePost, useMyCircles } from '../../api/hooks';
import { NoirScope } from '../../theme/ThemeProvider';
import { palettes, space } from '../../theme/tokens';
import { openSpan, settleDwell, type ActiveSpan } from '../../lib/dwell';
import type { Post } from '../../api/types';
import type { RootStackParamList, TabParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * The feed: one post per screen, snapping, with the tab bar over it.
 *
 * Two tabs, both of which serve something real:
 *
 *   Flow         `flow_ranked_feed` — scored from dwell, engagement, affinity
 *                and an exploration slice, with the reason attached to every
 *                item. This is the page the product is named for, so it is
 *                called Flow and not "For You": Crushly does not borrow the
 *                reference's words for its own surfaces.
 *   Connections  `flow_feed` — the plain reverse-chronological list of the
 *                people and Circles you can already see.
 *
 * The reference has four tabs, but two of its four are TikTok's own surfaces
 * (STEM, Series). Crushly does not have them, and a tab that opens nothing is a
 * lie with a label on it, so the surface ships with the two it can honour and
 * the row is built to take a third when Circles gets its own ranked feed.
 */
export function FeedScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<TabParamList, 'Flows'>>();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  // The feed is always noir, so it reads the noir palette directly instead of the
  // appearance the rest of the app is using (see NoirScope).
  const colors = palettes.dark;
  const { data: circles } = useMyCircles();
  const reportDwell = usePostDwell();

  const [tab, setTab] = useState<'flow' | 'crushes' | 'connections'>(route.params?.tab ?? 'flow');
  // A notification about a Crush opens Crushes, which is a part of this surface
  // rather than a tab of its own.
  useEffect(() => {
    if (route.params?.tab) setTab(route.params.tab);
  }, [route.params?.tab]);
  // Flow is the clip surface. Asking for more than a screenful is deliberate:
  // the page is filtered to clips, and a page of eight mixed posts can filter
  // down to one.
  const ranked = useRankedFlow(30);
  const following = useFlow(20);
  const feed = tab === 'flow' ? ranked : following;
  // Flow carries clips and only clips — the FYP. Pictures and words are Crushes'
  // and Connections' (and a Space's); putting everything on every surface was
  // how three feeds ended up being one feed with three names.
  const posts: Post[] = tab === 'flow'
    ? feed.posts.filter((p) => p.mediaKind === 'video')
    : feed.posts;

  const like = useReactToPost();
  const pick = useSavePost();
  const [shareFor, setShareFor] = useState<Post | null>(null);
  const [commentsFor, setCommentsFor] = useState<Post | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const { data: badges } = useBadges(true);

  /**
   * The page is as tall as the pane the feed is given, not as tall as the window.
   *
   * This is the bug behind three complaints at once. The tab bar is a custom bar
   * inside the navigator, so it takes real layout space: the pane is 775 dp on a
   * 844 dp phone. The old code sized each page to the window (844), so every
   * page was 69 dp taller than the pane that clipped it — the caption stack hung
   * below the fold, the sound row landed underneath the search bar, and the snap
   * interval was 69 dp off, which is why a swipe settled in the wrong place.
   *
   * Measured, not assumed: `onLayout` on the pane.
   */
  const [paneHeight, setPaneHeight] = useState(0);
  // The pages are as tall as the area the list actually got. On Connections a
  // header band — the Circle highlights, then the rooms — takes real space above
  // it, so measuring the pane instead of the list would leave every page taller
  // than the thing that clips it and the snap would settle in the wrong place.
  const [listHeight, setListHeight] = useState(0);
  const pageHeight = listHeight || paneHeight || height;
  // The bar is outside this pane, so the only space to leave is breathing room.
  const tabBarSpace = 8;
  // The search bar is the last thing on the page: name, words, hashtags and the
  // sound row all have to end above it.
  const SEARCH_BAR = 52;
  const captionBottom = tabBarSpace + SEARCH_BAR + 10;

  const span = useRef<ActiveSpan | null>(null);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems.find((v) => v.isViewable && typeof v.index === 'number');
    if (!first || typeof first.index !== 'number') return;
    setActiveIndex(first.index);
    const post = first.item as Post;
    const settled = settleDwell(span.current, post.id, Date.now());
    if (settled) reportDwell(settled.postId, settled.ms, settled.completed, settled.position);
    if (span.current?.postId !== post.id) span.current = openSpan(post.id, Date.now(), first.index);

    // Runway: ask for the next page while the reader is still two posts away
    // from the end, which is what makes the swipe feel like it had no seam.
    if (first.index >= posts.length - 2) feed.loadOlder();
  }).current;

  // Leaving the screen closes the span, so the last post is measured too.
  useEffect(() => () => {
    const settled = settleDwell(span.current, null, Date.now());
    if (settled) reportDwell(settled.postId, settled.ms, settled.completed, settled.position);
  }, [reportDwell]);

  const circleName = useCallback(
    (post: Post) => (post.circleId ? circles?.items.find((c) => c.id === post.circleId)?.name ?? null : null),
    [circles],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: Post; index: number }) => (
      <FeedPost
        post={item}
        height={pageHeight}
        active={index === activeIndex}
        bottomInset={captionBottom}
        circleName={circleName(item)}
        following={!item.mine}
        onAuthor={() =>
          item.mine
            ? navigation.navigate('Main', { screen: 'Profile' })
            : navigation.navigate('UserProfile', { id: item.author.id })
        }
        onCircle={item.circleId ? () => navigation.navigate('Circle', { circleId: item.circleId as number }) : undefined}
        onLike={() => like.mutate({ postId: item.id, liked: !item.liked })}
        onComment={() => setCommentsFor(item)}
        onShare={() => setShareFor(item)}
        onPick={() => pick.mutate({ postId: item.id, saved: !item.saved })}
        onSound={item.sound ? () => navigation.navigate('Sound', { soundId: item.sound!.id }) : undefined}
      />
    ),
    [activeIndex, captionBottom, circleName, like, navigation, pageHeight, pick],
  );

  /**
   * The strip: the three ways of looking at one feed. Flow is everything scored
   * for you, Crushes is the posts from people you have crushed on (and who have
   * crushed on you), Connections is the people you already know. Discover is not
   * one of them — it is a destination in the bar, and it is where search lives.
   */
  const tabs: FeedTab[] = [
    { key: 'flow', label: 'Flow' },
    { key: 'crushes', label: 'Crushes' },
    { key: 'connections', label: 'Connections' },
  ];

  return (
    <NoirScope>
    <View
      style={{ flex: 1, backgroundColor: colors.bg }}
      onLayout={(e) => {
        const next = Math.round(e.nativeEvent.layout.height);
        if (next > 0 && next !== paneHeight) setPaneHeight(next);
      }}
    >
      {/* Circles on the feed, one presentation of three.
          A band, in the page's own flow, under the strip: the highlights first
          (what happened in your rooms), then the rooms themselves. It used to
          float over the video with a scrim behind it, which read as an
          advertisement dropped on top of the feed rather than as the top of the
          page — so it is part of the page now, and the pages below it are
          measured against the space that is left. */}
      {tab === 'connections' ? (
        <View style={{ paddingTop: insets.top + 46 + 4 }}>
          <CircleHighlights />
          <CirclesStrip />
          <View style={{ height: 1, backgroundColor: colors.border, marginTop: space.sm }} />
        </View>
      ) : null}

      <View style={{ flex: 1 }} onLayout={(e) => {
        const next = Math.round(e.nativeEvent.layout.height);
        if (next > 0 && next !== listHeight) setListHeight(next);
      }}>
      {tab === 'crushes' ? (
        <CrushesFeed />
      ) : feed.isLoading ? (
        <View style={{ flex: 1, padding: space.lg, gap: space.md, justifyContent: 'center' }}>
          <Skeleton style={{ height: 380, borderRadius: 24 }} />
          <Skeleton style={{ height: 18, width: '60%' }} />
        </View>
      ) : feed.error ? (
        <ErrorState error={feed.error} message="The feed didn’t load." onRetry={feed.refresh} />
      ) : posts.length === 0 ? (
        <EmptyState
          title={tab === 'flow' ? 'No clips yet' : 'Nothing here yet'}
          message={
            tab === 'flow'
              ? 'Flow is where clips play, scored for you. Pictures and words live on Crushes and Connections.'
              : 'Post something and it will show up here, for you first.'
          }
          action={{ label: 'Share a post', onPress: () => navigation.navigate('CreatePost') }}
        />
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(p) => String(p.id)}
          renderItem={renderItem}
          pagingEnabled
          snapToInterval={pageHeight}
          snapToAlignment="start"
          decelerationRate="fast"
          disableIntervalMomentum
          showsVerticalScrollIndicator={false}
          getItemLayout={(_, index) => ({ length: pageHeight, offset: pageHeight * index, index })}
          initialNumToRender={2}
          maxToRenderPerBatch={3}
          windowSize={3}
          removeClippedSubviews
          viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
          onViewableItemsChanged={onViewableItemsChanged}
          refreshControl={
            <RefreshControl
              refreshing={feed.isRefetching}
              onRefresh={feed.refresh}
              tintColor={colors.gold}
              colors={[colors.gold]}
              progressViewOffset={insets.top + 46}
            />
          }
          onEndReached={() => feed.loadOlder()}
          onEndReachedThreshold={0.6}
        />
      )}

      </View>

      {/* One row: the three parts of the feed, the magnifier, the bell. The
          hamburger that used to open a drawer is gone, and nothing took its
          corner: Circles, Moments, Picked and Settings all live on the Space,
          and notifications are the bell beside search. */}
      <FeedTabs
        tabs={tabs}
        active={tab}
        onChange={(k) => setTab(k as typeof tab)}
        top={insets.top + 4}
        unread={badges?.notifications ?? 0}
        onSearch={() => navigation.navigate('Search')}
        onBell={() => setNotificationsOpen(true)}
      />

      {/* The corner used to hold the member's own face and a second magnifier.
          The face is the Space tab and the magnifier is the end of the strip, so
          both were the same two destinations drawn twice in a corner where the
          thumb does not go. */}

      {/* The hook belongs to a clip, so it has no business on Discover, which is
          a list of cards rather than one thing on a screen. */}
      {tab !== 'flow' ? null : (
      <>
      {/* The search hook. It is part of the feed in the reference, and it earns
          its 52 dp: it turns scrolling into a query without making anyone open a
          search screen first.

          It used to open a blank search. That is the one thing a suggestion
          cannot do — it names the words, so it runs them: the query arrives in
          the search box already answered, and you can edit it from there. */}
      <Pressable
        onPress={() => navigation.navigate('Search', { q: suggestedQuery(posts[activeIndex]) })}
        accessibilityRole="button"
        accessibilityLabel={`Search for “${suggestedQuery(posts[activeIndex])}”`}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: tabBarSpace,
          height: SEARCH_BAR,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingHorizontal: 16,
          backgroundColor: 'rgba(0,0,0,0.86)',
          borderTopWidth: 1,
          borderTopColor: 'rgba(255,255,255,0.08)',
          zIndex: 21,
        }}
      >
        <Ionicons name="search" size={19} color="#FFFFFF" />
        <Txt numberOfLines={1} style={{ flex: 1, fontSize: 13.5, color: '#FFFFFF' }}>
          Search · {suggestedQuery(posts[activeIndex])}
        </Txt>
        <Txt style={{ fontSize: 13, fontFamily: 'Manrope_700Bold', color: '#FFFFFF' }}>See more ›</Txt>
      </Pressable>
      </>
      )}

      <NotificationsSheet visible={notificationsOpen} onClose={() => setNotificationsOpen(false)} />
      {shareFor ? <ShareToWhisper visible post={shareFor} onClose={() => setShareFor(null)} /> : null}
      <CommentsSheet
        post={commentsFor}
        visible={!!commentsFor}
        onClose={() => setCommentsFor(null)}
        onOpenAuthor={(id) => {
          setCommentsFor(null);
          navigation.navigate('UserProfile', { id });
        }}
      />
    </View>
    </NoirScope>
  );
}

/**
 * What the search hook asks about. A hashtag if the post has one, else the first
 * four words of the caption, else the author — always something the query can
 * actually answer, so tapping it is never a dead end.
 */
function suggestedQuery(post: Post | undefined): string {
  if (!post) return 'people, Circles, Moments';
  const tag = post.body.match(/#[\p{L}\p{N}_]+/u);
  if (tag) return tag[0];
  const words = post.body.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length) return words.slice(0, 4).join(' ');
  return post.author.name;
}
