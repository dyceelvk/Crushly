import React, { useEffect, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FeedTabs, type FeedTab } from '../../components/feed/FeedTabs';
import { PostCard } from '../../components/feed/PostCard';
import { NotificationsSheet } from '../../components/NotificationsSheet';
import { CrushesFeed } from '../crushes/CrushesFeed';
import { ConnectionsTop, type CircleFilter } from '../../components/feed/ConnectionsTop';
import { EmptyState, ErrorState, Skeleton } from '../../components/States';
import { Button } from '../../components/Button';
import { useBadges, useFlow, useMyCircles } from '../../api/hooks';
import { useLayout } from '../../components/Layout';
import { useTheme } from '../../theme/ThemeProvider';
import { shownPosts } from '../../lib/features';
import { space } from '../../theme/tokens';
import type { RootStackParamList, TabParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** Height of Home's strip — everything on this screen is drawn under it. */
const STRIP = 46;

/**
 * Home: what the people you can already see are posting.
 *
 * Two surfaces, both of which are lists of posts:
 *
 *   Crushes      the people you have a Crush with — you on them, them on you.
 *   Connections  the people and Circles you are connected to, newest first.
 *
 * Flow is not one of them any more. Flow was the clip surface — a full-screen
 * pager scored for you, with a sound row under every page — and Crushly does not
 * show clips in this build: a member can post a photo or a few words, and no
 * video is drawn anywhere. A tab whose whole reason for existing is video is a
 * tab that opens an empty room, so it is gone from the strip rather than left
 * standing with nothing behind it. The code behind it — the players, the
 * ranked feed, the sounds — is untouched and switched off in `lib/features.ts`,
 * so it comes back with the announcement rather than with a rebuild.
 *
 * What Flow's removal also removes is the machinery it needed: the per-screen
 * pager, the page height measured against a clipped pane, the dwell span that
 * scored how long you watched. Two lists of cards need none of it, and the
 * strip now sits on the page's own background instead of over a photograph.
 */
export function FeedScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<TabParamList, 'Flows'>>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { contentWidth } = useLayout();
  const { data: circles } = useMyCircles();
  const following = useFlow(20);
  // Clips never reach a screen in this build, whichever list they came out of.
  const posts = shownPosts(following.posts);
  const { data: badges } = useBadges(true);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const [tab, setTab] = useState<'crushes' | 'connections'>(
    route.params?.tab === 'connections' ? 'connections' : 'crushes',
  );
  // A notification about a Crush opens Crushes, a Circle opens Connections.
  useEffect(() => {
    if (route.params?.tab === 'connections' || route.params?.tab === 'crushes') setTab(route.params.tab);
  }, [route.params?.tab]);

  /**
   * Which room Connections is showing: All, or one of your Circles.
   *
   * A filter rather than a third list, because a room is a place inside the feed
   * you already have, not a different feed. Choosing one narrows the same posts.
   */
  const [circleFilter, setCircleFilter] = useState<CircleFilter>('all');
  const filtered = circleFilter === 'all' ? posts : posts.filter((p) => p.circleId === circleFilter);
  const filteredName = (circles?.items ?? []).find((c) => c.id === circleFilter)?.name;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {tab === 'crushes' ? (
        <CrushesFeed />
      ) : following.isLoading ? (
        <View style={{ flex: 1, paddingTop: insets.top + STRIP + space.md, paddingHorizontal: space.lg, gap: space.md }}>
          <Skeleton style={{ height: 300, borderRadius: 20 }} />
          <Skeleton style={{ height: 300, borderRadius: 20 }} />
        </View>
      ) : following.error ? (
        <View style={{ flex: 1, paddingTop: insets.top + STRIP + space.md }}>
          <ErrorState error={following.error} message="Home didn’t load." onRetry={following.refresh} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(p) => String(p.id)}
          renderItem={({ item }) => <PostCard post={item} />}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            width: contentWidth,
            alignSelf: 'center',
            gap: space.md,
            paddingTop: insets.top + STRIP + space.sm,
            paddingHorizontal: space.md,
            paddingBottom: space.xxxl,
            flexGrow: 1,
          }}
          ListHeaderComponent={
            <ConnectionsTop
              selected={circleFilter}
              onSelect={setCircleFilter}
              onCompose={() => navigation.navigate('CreatePost')}
              onOpenCircle={(circleId) => navigation.navigate('Circle', { circleId })}
            />
          }
          refreshControl={
            <RefreshControl refreshing={following.isRefetching} onRefresh={following.refresh} tintColor={colors.text} />
          }
          onEndReached={() => following.loadOlder()}
          onEndReachedThreshold={0.6}
          ListEmptyComponent={
            <EmptyState
              icon={circleFilter === 'all' ? 'people-outline' : 'people-circle-outline'}
              title={circleFilter === 'all' ? 'Nothing here yet' : `Nothing in ${filteredName ?? 'this Circle'} yet`}
              message={
                circleFilter !== 'all'
                  ? 'A post lands in a Circle the moment somebody writes one there. Show all to see everything you are connected to.'
                  : circles?.items.length
                    ? 'Post something and it will show up here, for you first.'
                    : 'Follow the people and Circles you want to hear from, and their Crushes land here.'
              }
              action={{ label: 'Say something', onPress: () => navigation.navigate('CreatePost') }}
              secondary={{
                label: circleFilter === 'all' ? 'Find people' : 'Show all',
                onPress: () => (circleFilter === 'all' ? navigation.navigate('Main', { screen: 'Discover' }) : setCircleFilter('all')),
              }}
            />
          }
        />
      )}

      {/* One row: the two parts of Home, the magnifier, the bell. A tab that
          opens nothing is a lie with a label on it, which is why the strip has
          two now and not three. */}
      <FeedTabs
        tabs={TABS}
        active={tab}
        onChange={(k) => setTab(k as typeof tab)}
        top={insets.top + 4}
        unread={badges?.notifications ?? 0}
        onSearch={() => navigation.navigate('Search')}
        onBell={() => setNotificationsOpen(true)}
      />

      <NotificationsSheet visible={notificationsOpen} onClose={() => setNotificationsOpen(false)} />
    </View>
  );
}

/**
 * The strip: the two ways of looking at one page.
 *
 * Declared once, outside the component, because a fresh array on every render
 * re-renders the row on every keystroke anywhere in the app.
 */
const TABS: FeedTab[] = [
  { key: 'crushes', label: 'Crushes' },
  { key: 'connections', label: 'Connections' },
];
