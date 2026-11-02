import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View, useWindowDimensions, type ViewToken } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { Avatar } from '../../components/Photo';
import { FeedPost } from '../../components/feed/FeedPost';
import { FeedTabs, type FeedTab } from '../../components/feed/FeedTabs';
import { ShareToWhisper } from '../../components/ShareToWhisper';
import { EmptyState, ErrorState, Skeleton } from '../../components/States';
import { useFlow, usePostDwell, useRankedFlow, useReactToPost, useSavePost, useMe, useMyCircles } from '../../api/hooks';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';
import { openSpan, settleDwell, type ActiveSpan } from '../../lib/dwell';
import type { Post } from '../../api/types';
import type { RootStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * The feed: one post per screen, snapping, with the tab bar over it.
 *
 * Two tabs, both of which serve something real:
 *
 *   For You    `flow_ranked_feed` — scored from dwell, engagement, affinity and
 *              an exploration slice, with the reason attached to every item.
 *   Following  `flow_feed` — the plain reverse-chronological list of the people
 *              and Circles you can already see.
 *
 * The reference has four tabs, but two of its four are TikTok's own surfaces
 * (STEM, Series). Crushly does not have them, and a tab that opens nothing is a
 * lie with a label on it, so the surface ships with the two it can honour and
 * the row is built to take a third when Circles gets its own ranked feed.
 */
export function FeedScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { colors } = useTheme();
  const { data: me } = useMe();
  const { data: circles } = useMyCircles();
  const reportDwell = usePostDwell();

  const [tab, setTab] = useState<'for-you' | 'following'>('for-you');
  const ranked = useRankedFlow(8);
  const following = useFlow(20);
  const feed = tab === 'for-you' ? ranked : following;
  const posts: Post[] = feed.posts;

  const like = useReactToPost();
  const save = useSavePost();
  const [shareFor, setShareFor] = useState<Post | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  /**
   * The screen height is the page height. The tab bar floats over the feed, so
   * the caption stack is lifted by its height instead of the frame being shrunk —
   * shrinking it would letterbox every clip twice.
   */
  const pageHeight = height;
  const tabBarSpace = insets.bottom + 56;
  const captionBottom = tabBarSpace + 56;

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
        onComment={() => navigation.navigate('PostViewer', { postId: item.id })}
        onSave={() => save.mutate({ postId: item.id, saved: !item.saved })}
        onShare={() => setShareFor(item)}
      />
    ),
    [activeIndex, captionBottom, circleName, like, navigation, pageHeight, save],
  );

  const tabs: FeedTab[] = [
    { key: 'for-you', label: 'For You' },
    { key: 'following', label: 'Following' },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {feed.isLoading ? (
        <View style={{ flex: 1, padding: space.lg, gap: space.md, justifyContent: 'center' }}>
          <Skeleton style={{ height: 380, borderRadius: 24 }} />
          <Skeleton style={{ height: 18, width: '60%' }} />
        </View>
      ) : feed.error ? (
        <ErrorState error={feed.error} message="The feed didn’t load." onRetry={feed.refresh} />
      ) : posts.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          message="Post something and it will show up here, for you first."
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

      <FeedTabs tabs={tabs} active={tab} onChange={(k) => setTab(k as typeof tab)} top={insets.top + 4} />

      {/* Top-left: the surfaces the tabs do not cover. Top-right: search, which
          is where the reference puts it. */}
      <Pressable
        onPress={() => navigation.navigate('FlowList')}
        accessibilityRole="button"
        accessibilityLabel="Open the rest of the Flow: all posts, Circles and the everyone switch"
        hitSlop={10}
        style={{ position: 'absolute', left: 14, top: insets.top + 14, zIndex: 22 }}
      >
        <Ionicons name="menu" size={25} color="#FFFFFF" />
      </Pressable>

      <Pressable
        onPress={() => navigation.navigate('Search')}
        accessibilityRole="button"
        accessibilityLabel="Search Crushly"
        hitSlop={10}
        style={{ position: 'absolute', right: 14, top: insets.top + 14, zIndex: 22, flexDirection: 'row', alignItems: 'center', gap: 10 }}
      >
        {me ? <Avatar uri={me.profile.photos?.[0]?.url ?? null} name={me.profile.name} size={26} /> : null}
        <Ionicons name="search" size={23} color="#FFFFFF" />
      </Pressable>

      {/* The search hook. It is part of the feed in the reference, and it earns
          its 52 dp: it turns scrolling into a query without making anyone open a
          search screen first. */}
      <Pressable
        onPress={() => navigation.navigate('Search')}
        accessibilityRole="button"
        accessibilityLabel="Search what you are seeing"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: tabBarSpace,
          height: 52,
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

      {shareFor ? <ShareToWhisper visible post={shareFor} onClose={() => setShareFor(null)} /> : null}
    </View>
  );
}

/**
 * What the search hook asks about. A hashtag if the post has one, else the first
 * four words of the caption, else the author — always something the query can
 * actually answer, so tapping it is never a dead end.
 */
function suggestedQuery(post: Post | undefined): string {
  if (!post) return 'people, Circles, Vibes';
  const tag = post.body.match(/#[\p{L}\p{N}_]+/u);
  if (tag) return tag[0];
  const words = post.body.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length) return words.slice(0, 4).join(' ');
  return post.author.name;
}
