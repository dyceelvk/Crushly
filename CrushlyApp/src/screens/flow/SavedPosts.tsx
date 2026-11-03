import React, { useCallback } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Header, Screen, useLayout } from '../../components/Layout';
import { EmptyState, ErrorState, Skeleton } from '../../components/States';
import { PostCard } from '../../components/feed/PostCard';
import { useSavedPosts } from '../../api/hooks';
import { space } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import type { RootStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * The saved drawer.
 *
 * Saving has written a real row since 1.0.11 — `post_saves`, three RPCs and a
 * private policy — but the row was being written by a build whose list to read
 * it back from was missing. The bookmark filled, the toast said "Kept", and
 * there was nowhere to go and see what you had kept. This is that place.
 *
 * It is private in the strongest sense the schema allows: the table has no
 * select policy for anyone but its owner, nothing counts saves, and the post's
 * author is never told. So this screen is the only place a save is ever shown,
 * and it can only show yours.
 *
 * It reuses `PostCard` rather than a thinner row, because a saved post should
 * behave exactly like a post: like it, comment on it, open it, let it go. And
 * because `saved_posts` applies `can_view_post` before returning a row, a post
 * you can no longer see — blocked, disconnected, deleted — drops out on its own
 * instead of sitting here as a dead tap.
 */
export function SavedPostsScreen() {
  const navigation = useNavigation<Nav>();
  const { colors } = useTheme();
  const { contentWidth } = useLayout();
  const saved = useSavedPosts();

  const onEndReached = useCallback(() => {
    saved.loadOlder();
  }, [saved]);

  return (
    <Screen scroll={false}>
      <Header title="Kept" subtitle="Only you can see this." back />
      {saved.isLoading ? (
        <View style={{ gap: space.md, width: contentWidth, alignSelf: 'center' }}>
          <Skeleton style={{ height: 220 }} />
          <Skeleton style={{ height: 220 }} />
        </View>
      ) : saved.isError ? (
        <ErrorState
          message={(saved.error as Error)?.message ?? 'Your kept posts didn’t load.'}
          onRetry={() => void saved.refetch()}
        />
      ) : (
        <FlatList
          data={saved.posts}
          keyExtractor={(p) => String(p.id)}
          showsVerticalScrollIndicator={false}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl refreshing={saved.isRefetching} onRefresh={() => void saved.refresh()} tintColor={colors.text} />
          }
          contentContainerStyle={{
            width: contentWidth,
            alignSelf: 'center',
            gap: space.md,
            paddingTop: space.xs,
            paddingBottom: space.xl,
            flexGrow: 1,
          }}
          renderItem={({ item }) => <PostCard post={item} />}
          ListEmptyComponent={
            <EmptyState
              icon="bookmark-outline"
              title="Nothing kept yet"
              message="Tap the bookmark on a post to keep it here. Only you can see what you keep."
              action={{
                label: 'Back to the Flow',
                variant: 'secondary',
                onPress: () => navigation.navigate('Main', { screen: 'Flows' }),
              }}
            />
          }
        />
      )}
    </Screen>
  );
}
