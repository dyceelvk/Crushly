import React, { useCallback } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { EmptyState, ErrorState, Skeleton } from '../../components/States';
import { Button } from '../../components/Button';
import { PostCard } from '../../components/feed/PostCard';
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
 * Crushes: a post feed.
 *
 * It is the posts of the people you have a Crush with — you on them, them on
 * you, both — and it is the same anatomy as any other feed on the product,
 * because a post is a post. What it is *not* is a directory of people, a list
 * of profiles, or a page of suggestions: those answer "who", and this answers
 * "what did they post".
 *
 * Clips are not here. Flow is the clip surface; Crushes is pictures and words,
 * which is the division the strip already implies by keeping the two apart.
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
        paddingHorizontal: space.md,
        paddingBottom: space.xxxl,
        flexGrow: 1,
      }}
      renderItem={({ item }) => <PostCard post={item} />}
      ListEmptyComponent={
        <EmptyState
          icon="heart-outline"
          title="No posts here yet"
          message="Crushes shows what the people you’ve Crushed on are posting — pictures and words. Crush someone in Discover and their posts land here."
          action={{
            label: 'Find people',
            onPress: () => navigation.navigate('Main', { screen: 'Discover' }),
          }}
        />
      }
    />
  );
}
