import React, { useCallback } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { Txt } from '../../components/Txt';
import { IconButton } from '../../components/IconButton';
import { EmptyState, ErrorState, Skeleton } from '../../components/States';
import { VibesRow } from './VibesRow';
import { MomentsRow } from './MomentsRow';
import { PostCard } from '../flow/Flow';
import { useLayout } from '../../components/Layout';
import { useToast } from '../../components/Toast';
import { keys, useBadges, useCrush, usePublicFlow } from '../../api/hooks';
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
            title: opts.deep ? `Big Crush sent to ${p.name}` : `You crushed on ${p.name}`,
            message: opts.deep ? 'You’ll stand out at the top of their Crushes.' : 'If it’s mutual, you’ll be the first to know.',
            avatar: p.photos[0]?.url ?? null,
          });
        }
        return res;
      } catch (e) {
        toast({ kind: 'error', title: 'Crush not sent', message: (e as Error).message });
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
 * Crushly is a social app, so this screen is about what people have said, not
 * rows of faces to sort through. There is no deck of profile photographs here
 * on purpose: you can still Crush somebody, but you do it from their Space,
 * because you want to, not because a grid put them in front of you.
 *
 * What is here is content — Vibes, Moments, and the posts people chose to make
 * public — and everything in it has already been through the same audience,
 * block and Circle rules as the feed it came from.
 */
export function DiscoverScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { contentWidth, gutter } = useLayout();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const { data: badges } = useBadges(true);
  const feed = usePublicFlow();

  const posts = feed.data ?? [];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: keys.vibes });
    qc.invalidateQueries({ queryKey: keys.moments });
    qc.invalidateQueries({ queryKey: keys.publicFlow });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingHorizontal: gutter,
          paddingBottom: space.xxxl,
          width: '100%',
          maxWidth: contentWidth,
          alignSelf: 'center',
        }}
        refreshControl={
          <RefreshControl refreshing={feed.isRefetching} onRefresh={refresh} tintColor={colors.gold} colors={[colors.gold]} progressViewOffset={insets.top} />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', paddingTop: space.sm }}>
          <View style={{ flex: 1 }}>
            <Txt variant="display" accessibilityRole="header">
              Discover
            </Txt>
            <Txt variant="body" color="textSecondary" style={{ marginTop: 2 }}>
              What people are sharing.
            </Txt>
          </View>
          <IconButton
            icon="notifications-outline"
            label={`Crush Alerts${badges?.notifications ? `, ${badges.notifications} unread` : ''}`}
            badge={!!badges?.notifications}
            onPress={() => navigation.navigate('Notifications')}
          />
        </View>

        <VibesRow />
        <MomentsRow />

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
          <ErrorState message={feed.error instanceof Error ? feed.error.message : 'Posts didn’t load.'} onRetry={refresh} />
        ) : posts.length ? (
          <View style={{ gap: space.md }}>
            {posts.map((p) => (
              <PostCard key={p.id} post={p} />
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
