import React, { useEffect, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FeedTabs, type FeedTab } from '../../components/feed/FeedTabs';
import { useSwipeTabs } from '../../components/SwipeTabs';
import { PostCard } from '../../components/feed/PostCard';
import { Measured, useFeedFocus } from '../../components/feed/FeedFocus';
import { NotificationsSheet } from '../../components/NotificationsSheet';
import { CrushesFeed } from '../crushes/CrushesFeed';
import { ConnectionsTop, CircleHighlightsCard, type CircleFilter } from '../../components/feed/ConnectionsTop';
import { DiscoverCard } from '../../components/circles/DiscoverCard';
import { EmptyState, ErrorState, Skeleton } from '../../components/States';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import {
  useBadges,
  useFlow,
  useMyCircles,
  useCircleHighlights,
  useDiscoverCircles,
  useJoinCircle,
  useRespondCircleInvitation,
  useCircleInvitations,
} from '../../api/hooks';
import { useLayout } from '../../components/Layout';
import { useTheme } from '../../theme/ThemeProvider';
import { shownPosts } from '../../lib/features';
import { buildFeedRows } from '../../lib/feedSections';
import { space } from '../../theme/tokens';
import { useToast } from '../../components/Toast';
import type { Post } from '../../api/types';
import type { RootStackParamList, TabParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** Height of Home's strip — everything on this screen is drawn under it. */
const STRIP = 46;

/**
 * Home: what the people you can already see are posting.
 *
 * Two surfaces, both of which are lists of posts:
 *
 *   Crushes      you, and the people you've added up with.
 *   Connections  the people and Circles you are connected to, newest first.
 *
 * Flow is not one of them any more. Flow was the clip surface — a full-screen
 * pager scored for you, with a sound row under every page — and Holup does not
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
  const focus = useFeedFocus();
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const [tab, setTab] = useState<'crushes' | 'connections'>(
    route.params?.tab === 'connections' ? 'connections' : 'crushes',
  );
  const swipe = useSwipeTabs({ options: ['crushes', 'connections'] as const, value: tab, onChange: setTab, width: contentWidth });
  // A notification about an add up opens Crushes, a Circle opens Connections.
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

  /**
   * What is happening inside your own rooms, and rooms you could join.
   *
   * Both are sections of the feed rather than blocks above it. They are fetched
   * here so the page can lay them out — a section has to know whether it exists
   * before the list can place it — and each one draws itself from the same
   * cached query, so this is one request per surface, not two.
   */
  const highlights = useCircleHighlights(8);
  const discovery = useDiscoverCircles(6);
  const join = useJoinCircle();
  const invitations = useCircleInvitations();
  const respond = useRespondCircleInvitation();
  const toast = useToast();

  const hasHighlights = (highlights.data ?? []).some((h) => h.kind !== 'quiet');
  const discoverable = discovery.data ?? [];

  /**
   * One row per thing on the page.
   *
   * Posts first, because that is what the page is; the room sections go between
   * them — your rooms after the first post, rooms you could join after the
   * third, and a second helping of rooms further down if there are any left.
   */
  const rows = (() => {
    const sections: { after: number; key: string }[] = [];
    if (hasHighlights) sections.push({ after: 1, key: 'highlights' });
    if (discoverable.length) sections.push({ after: 3, key: 'discover-0' });
    if (discoverable.length > 3) sections.push({ after: 7, key: 'discover-1' });
    const built = buildFeedRows<Post>(filtered, sections, (p) => `post-${p.id}`);
    // A page with no posts still has to offer something to do.
    if (!built.length || (filtered.length === 0 && discoverable.length === 0)) {
      built.push({ kind: 'section', key: 'empty' });
    }
    return built;
  })();

  return (
    <View {...swipe.panHandlers} style={{ flex: 1, backgroundColor: colors.bg }}>
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
          data={rows}
          keyExtractor={(row) => row.key}
          {...focus.listProps}
          windowSize={7}
          initialNumToRender={3}
          maxToRenderPerBatch={4}
          renderItem={({ item: row, index }) => {
            if (row.kind === 'item') {
              return (
                <Measured index={index} id={row.item.id} onReport={focus.report}>
                  <PostCard post={row.item} active={row.item.id === focus.activeId} />
                </Measured>
              );
            }
            if (row.key === 'highlights') {
              return <CircleHighlightsCard onOpenCircle={(circleId) => navigation.navigate('Circle', { circleId })} />;
            }
            if (row.key === 'empty') {
              return (
                <EmptyState
                  icon={circleFilter === 'all' ? 'people-outline' : 'people-circle-outline'}
                  title={circleFilter === 'all' ? 'Nothing here yet' : `Nothing in ${filteredName ?? 'this Circle'} yet`}
                  message={
                    circleFilter !== 'all'
                      ? 'A post lands in a Circle the moment somebody writes one there. Show all to see everything you are connected to.'
                      : circles?.items.length
                        ? 'Post something and it will show up here, for you first.'
                        : 'Post something, follow the people you want to hear from, or join a Circle below.'
                  }
                  action={{ label: 'Say something', onPress: () => navigation.navigate('CreatePost') }}
                  secondary={{
                    label: circleFilter === 'all' ? 'Find people' : 'Show all',
                    onPress: () => (circleFilter === 'all' ? navigation.navigate('Main', { screen: 'Discover' }) : setCircleFilter('all')),
                  }}
                />
              );
            }
            // A page of rooms: three at a time, in the feed, between posts.
            const page = row.key === 'discover-1' ? 3 : 0;
            const slice = discoverable.slice(page, page + 3);
            if (!slice.length) return null;
            return (
              <View style={{ gap: space.sm }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="compass-outline" size={15} color={colors.primary} />
                  <Txt variant="bodyStrong" style={{ flex: 1 }}>
                    {page === 0 ? 'Circles you could join' : 'More Circles'}
                  </Txt>
                  <Txt variant="caption" color="textMuted">
                    {discoverable.length} found
                  </Txt>
                </View>
                {slice.map((c) => (
                  <DiscoverCard
                    key={c.id}
                    circle={c}
                    busy={join.isPending && join.variables === c.id}
                    onOpen={() => navigation.navigate('CirclePreview', { circleId: c.id })}
                    onJoin={(kind) => {
                      if (kind === 'accept') {
                        const invitation = (invitations.data ?? []).find((i) => i.circleId === c.id);
                        if (!invitation) {
                          navigation.navigate('CirclePreview', { circleId: c.id });
                          return;
                        }
                        respond.mutate(
                          { invitationId: invitation.id, accept: true, circleId: c.id },
                          {
                            onSuccess: () => {
                              toast({ kind: 'success', title: `You’re in ${c.name}` });
                              navigation.navigate('Circle', { circleId: c.id });
                            },
                            onError: (e) => toast({ kind: 'error', title: 'Couldn’t accept', message: (e as Error).message }),
                          },
                        );
                        return;
                      }
                      if (kind !== 'join' && kind !== 'request') {
                        navigation.navigate('CirclePreview', { circleId: c.id });
                        return;
                      }
                      join.mutate(c.id, {
                        onSuccess: (res) => {
                          if (res.state === 'member') {
                            toast({ kind: 'success', title: `You’re in ${c.name}`, message: 'It is in your Circles now.' });
                          } else {
                            toast({ kind: 'info', title: 'Asked to join', message: `${c.name} will appear once the owner says yes.` });
                          }
                        },
                        onError: (e) => toast({ kind: 'error', title: 'Couldn’t join', message: (e as Error).message }),
                      });
                    }}
                  />
                ))}
              </View>
            );
          }}
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
            />
          }
          refreshControl={
            <RefreshControl refreshing={following.isRefetching} onRefresh={following.refresh} tintColor={colors.text} />
          }
          onEndReached={() => following.loadOlder()}
          onEndReachedThreshold={0.6}
          ListEmptyComponent={null}
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
