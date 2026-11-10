import React, { useCallback, useRef } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import { Txt } from '../../components/Txt';
import { EmptyState, ErrorState, Skeleton } from '../../components/States';
import { MomentsRow } from './MomentsRow';
import { ClipRail } from '../../components/feed/ClipRail';
import { PostCard } from '../../components/feed/PostCard';
import { Measured, useFeedFocus } from '../../components/feed/FeedFocus';
import { useLayout } from '../../components/Layout';
import { useToast } from '../../components/Toast';
import { keys, useCrush, usePublicFlow } from '../../api/hooks';
import { shownPosts } from '../../lib/features';
import type { Profile } from '../../api/types';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';
import type { RootStackParamList } from '../../navigation/types';
import { celebrated } from '../crushes/MutualCrush';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function useCrushFlow() {
  const navigation = useNavigation<Nav>();
  const crush = useCrush();
  const toast = useToast();
  const run = useCallback(
    async (p: Pick<Profile, 'id' | 'name' | 'photos'>, opts: { deep?: boolean; note?: string } = {}) => {
      try {
        const res = await crush.mutateAsync({ id: p.id, ...opts });
        if (res.mutual && res.isNew) {
          celebrated.add(p.id);
          navigation.navigate('MutualCrush', { userId: p.id, name: p.name, photo: p.photos[0]?.url });
        } else {
          toast({
            kind: 'crush',
            title: opts.deep ? `Big Up sent to ${p.name}` : `You added up with ${p.name}`,
            message: opts.deep ? 'You’ll stand out at the top of their add ups.' : 'If they add back, you’ll be the first to know.',
            avatar: p.photos[0]?.url ?? null,
          });
        }
        return res;
      } catch (e) {
        toast({ kind: 'error', title: 'Add up not sent', message: (e as Error).message });
        return null;
      }
    },
    [crush, navigation, toast],
  );
  return { run, pendingId: crush.isPending ? crush.variables?.id : undefined };
}

/**
 * Discover — what people are sharing.
 *
 * holUpp is a social app, so this screen is about what people have said, not
 * rows of faces to sort through. There is no deck of profile photographs here
 * on purpose: you can still Crush somebody, but you do it from their Space,
 * because you want to, not because a grid put them in front of you.
 *
 * What is here is content — Moments, and the posts people chose to make
 * public — and everything in it has already been through the same audience,
 * block and Circle rules as the feed it came from.
 */
/**
 * Discover, as a pane of the Flow.
 *
 * Discover used to be a screen you pushed — reachable from an empty state or
 * from a menu — while the Flow was the page you landed on. That is backwards:
 * what people are sharing publicly is one of the three things the top strip
 * offers, next to your Flow and your Connections, so it is one of the three
 * panes of that surface, and every "Discover people" in the app arrives here.
 */
export function DiscoverPane() {
  const navigation = useNavigation<Nav>();
  const { contentWidth, gutter } = useLayout();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const feed = usePublicFlow();
  // One clip plays here too: the card the reader is on.
  const focus = useFeedFocus();

  // Clips are not part of this build, so a clip in the public list is not a
  // card with a hole in it — it is not a card.
  const posts = shownPosts(feed.data ?? []);
  // Second person only where the list really is yours-and-others. Here every
  // card is somebody's post in a shared list, so "You" would be wrong — and on a
  // public screen it read as though the app had merged you into the crowd.

  const refresh = () => {
    qc.invalidateQueries({ queryKey: keys.moments });
    qc.invalidateQueries({ queryKey: keys.publicFlow });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        {...focus.listProps}
        contentContainerStyle={{
          paddingTop: space.xs,
          paddingHorizontal: gutter,
          paddingBottom: space.xxxl,
          width: '100%',
          maxWidth: contentWidth,
          alignSelf: 'center',
        }}
        refreshControl={
          <RefreshControl refreshing={feed.isRefetching} onRefresh={refresh} tintColor={colors.gold} colors={[colors.gold]} />
        }
        showsVerticalScrollIndicator={false}
      >
        <MomentsRow />

        {/* Clips, this week, ranked. Directly under the Moments row because both
            answer the same question — what is worth watching right now — and
            above the public feed because a rail is a doorway, not a wall. */}
        <ClipRail />

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            marginTop: space.xl,
            marginBottom: space.sm,
          }}
        >
          <Txt variant="title" accessibilityRole="header">
            From everyone
          </Txt>
          <Txt variant="small" color="textMuted">
            Shared publicly
          </Txt>
        </View>

        {feed.isLoading ? (
          <View style={{ gap: space.md }}>
            <Skeleton style={{ height: 120, borderRadius: 14 }} />
            <Skeleton style={{ height: 120, borderRadius: 14 }} />
          </View>
        ) : feed.isError ? (
          <ErrorState error={feed.error} message="Posts didn’t load." onRetry={refresh} />
        ) : posts.length ? (
          <View style={{ gap: space.md }}>
            {posts.map((p, index) => (
              <Measured key={p.id} index={index} id={p.id} onReport={focus.report}>
                <PostCard post={p} secondPerson={false} active={p.id === focus.activeId} />
              </Measured>
            ))}
          </View>
        ) : (
          <EmptyState
            icon="chatbubbles-outline"
            title="Nothing public yet"
            message="When somebody shares a post with Everyone, it shows up here."
          />
        )}
      </ScrollView>
    </View>
  );
}
