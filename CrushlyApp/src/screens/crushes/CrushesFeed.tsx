import React, { useCallback, useEffect } from 'react';
import { FlatList, Platform, RefreshControl, View } from 'react-native';
import { Image } from 'expo-image';
import { mediaUrl } from '../../api/client';
import { mediaSource } from '../../lib/mediaHost';
import { feedImagePaths } from '../../lib/feedPrefetch';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { EmptyState, ErrorState, Skeleton } from '../../components/States';
import { Button } from '../../components/Button';
import { PostCard } from '../../components/feed/PostCard';
import { CrushClipCard } from '../../components/feed/CrushClipCard';
import { MomentCircles } from '../../components/MomentCircle';
import { Measured, useFeedFocus } from '../../components/feed/FeedFocus';
import { useLayout } from '../../components/Layout';
import { useCrushesFeed } from '../../api/hooks';
import { shownPosts } from '../../lib/features';
import { space } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import type { RootStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** Height of Home's strip — this pane is drawn under it. */
const STRIP = 46;

/**
 * Crushes: the posts holUpp is publishing, as they are published.
 *
 * This is the discovery surface for posts, and it reads the same `posts` rows
 * every other surface reads — the same id, the same author, the same media and
 * the same counts. What it is *not* is a directory of people, a list of
 * profiles, or a page of suggestions: those answer "who", and this answers
 * "what did they post".
 *
 * It used to be the posts of the people you had added up with, which is why a
 * member could publish in their Space and never see their own feed move: the
 * page was a list of relationships wearing a feed's clothes. Now the only thing
 * that keeps a post out is the audience its author chose — `can_view_post` in
 * the database decides, so a connections-only post stays with connections and a
 * Circle post stays in its room.
 *
 * A clip is a post, so clips are here too. Flow still ranks them for the
 * surface built for them.
 *
 * The card is the same `PostCard` the Space, the Picks list and the search
 * results use, so Crush, Comment, Share and Pick are the same code with the
 * same rules — including that they write to the same tables. There is no
 * second interaction path to go stale.
 */
export function CrushesFeed({ embedded = true }: { embedded?: boolean }) {
  const navigation = useNavigation<Nav>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { contentWidth } = useLayout();
  const feed = useCrushesFeed();
  // Which card is in front of the reader — the only one whose clip plays.
  const focus = useFeedFocus();

  // Start a small number of next images together, with the same auth and cache
  // keys as Photo. Do not download video or private messages in the background.
  // The rendered feed remains authoritative; a failed prefetch is harmless.
  const prefetchKey = JSON.stringify(feedImagePaths(feed.posts));
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const paths = JSON.parse(prefetchKey) as string[];
    for (const path of paths) {
      const url = mediaUrl(path);
      if (!url) continue;
      const source = mediaSource(url);
      const uri = typeof source === 'string' ? source : source.uri;
      const headers = typeof source === 'string' ? undefined : source.headers;
      if (uri) void Image.prefetch(uri, { cachePolicy: 'memory-disk', headers }).catch(() => undefined);
    }
  }, [prefetchKey]);

  const onEndReached = useCallback(() => {
    feed.loadOlder();
  }, [feed]);

  // The strip is drawn over this pane at `insets.top + 4`, and it is 46 tall —
  // so the list starts below the status bar *and* below the strip. It used to
  // start at 46 from the top of the pane, which on a phone with a 24 dp status
  // bar put the first card under the last third of the strip.
  const top = embedded ? insets.top + STRIP + space.md : space.xs;

  if (feed.isLoading) {
    return (
      <View style={{ flex: 1, paddingTop: top, paddingHorizontal: space.lg, gap: space.md }}>
        <Skeleton style={{ height: 300, borderRadius: 20 }} />
        <Skeleton style={{ height: 300, borderRadius: 20 }} />
      </View>
    );
  }

  if (feed.isError) {
    return (
      <View style={{ flex: 1, paddingTop: top }}>
        <ErrorState
          message={(feed.error as Error)?.message ?? 'Crushes didn’t load.'}
          onRetry={() => void feed.refetch()}
        />
      </View>
    );
  }

  return (
    <FlatList
      data={shownPosts(feed.posts)}
      keyExtractor={(p) => String(p.id)}
      showsVerticalScrollIndicator={false}
      /* `listProps` carries the scroll offset and the viewport height to the
         focus line; without it every mounted clip plays at once. */
      {...focus.listProps}
      /* Fewer rows alive at a time. Each mounted clip owns a native player, so a
         default window of twenty-one cards meant twenty-one of them, paused or
         not — the single largest cost in this feed on a real phone. */
      windowSize={7}
      initialNumToRender={3}
      maxToRenderPerBatch={4}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.5}
      refreshControl={
        <RefreshControl refreshing={feed.isRefetching} onRefresh={() => void feed.refresh()} tintColor={colors.text} />
      }
      contentContainerStyle={{
        width: contentWidth,
        alignSelf: 'center',
        gap: space.md,
        paddingTop: top,
        /*
         * The cards are inset from the edges of the phone, and that inset is the
         * feed's default layout. It went missing when the Moments row arrived:
         * the row is full-bleed, so the padding was removed and the row was given
         * a negative margin to escape it — but that took the cards with it, and
         * posts ran edge to edge. The padding is back; the row's own negative
         * margin still cancels it, so the row stays full-bleed and the cards do
         * not. This is what "not back to the default" was.
         */
        paddingHorizontal: space.md,
        paddingBottom: space.xxxl,
        flexGrow: 1,
      }}
      /* The live Moments, one circle per person, are the first thing in the feed.
         They sit above the first card rather than inside it: a Moment is a face
         with a day to live, and a face belongs at the top of a feed. The row hides
         itself when nothing is live, so this costs an empty feed nothing. */
      ListHeaderComponent={
        <View style={{ marginHorizontal: -space.md }}>
          {/* Smaller than a profile row's 74 dp: this is a strip of faces above a
              column of posts, not the posts' equal. See MomentCircle. */}
          <MomentCircles size={58} />
        </View>
      }
      renderItem={({ item, index }) => (
        <Measured index={index} id={item.id} onReport={focus.report}>
          {/* A clip is the card; a photograph and a written post keep the card
              they were designed for. See CrushClipCard. */}
          {item.mediaKind === 'video' && item.mediaUrl ? (
            <CrushClipCard post={item} active={item.id === focus.activeId} />
          ) : (
            <PostCard post={item} active={item.id === focus.activeId} />
          )}
        </Measured>
      )}
      /* The next page is fetched as the end approaches, and the footer says so
         quietly — a feed that simply stops mid-scroll is what made people think
         their older posts had been removed. */
      ListFooterComponent={
        feed.isFetchingNextPage ? (
          <Skeleton style={{ height: 240, borderRadius: 20, marginTop: space.md }} />
        ) : null
      }
      ListEmptyComponent={
        <EmptyState
          icon="crush"
          title="Nothing published yet"
          message="Crushes is everything holUpp is posting. The first post lands here the moment somebody publishes one — yours included."
          action={{
            label: 'Say something',
            onPress: () => navigation.navigate('CreatePost'),
          }}
          secondary={{
            label: 'Find people',
            onPress: () => navigation.navigate('Main', { screen: 'Discover' }),
          }}
        />
      }
    />
  );
}
