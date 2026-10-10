import React, { useMemo } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { Avatar } from '../../components/Photo';
import { VerifiedBadge } from '../../components/Badges';
import { EmptyState, ErrorState, Skeleton } from '../../components/States';
import { useLayout } from '../../components/Layout';
import { useMoments } from '../../api/hooks';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { timeAgo } from '../../lib/format';
import type { Moment, MomentAuthor } from '../../api/types';
import type { RootStackParamList } from '../../navigation/types';
import { MomentPreview } from '../moments/Moments';

type Tile = { key: string; author: MomentAuthor; moment: Moment };

/**
 * Moments, laid out to be browsed.
 *
 * The Moments tab used to be a single stack you walked through one person at a
 * time. Here they are a grid: everything you are allowed to see, newest first,
 * each one opening the stack it belongs to. Same expiry, same audience rules —
 * only the shape of the door changed. Anything you cannot see is not merely
 * hidden here, it never arrives from the database.
 */
export function MomentsGrid({ header }: { header?: React.ReactNode }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { contentWidth, gutter } = useLayout();
  const { colors } = useTheme();
  const moments = useMoments();

  const tiles = useMemo<Tile[]>(() => {
    const out: Tile[] = [];
    const feed = moments.data;
    if (!feed) return out;
    for (const m of feed.mine.moments) out.push({ key: `mine-${m.id}`, author: feed.mine.user, moment: m });
    for (const group of feed.others) {
      for (const m of group.moments) out.push({ key: `${group.user.id}-${m.id}`, author: group.user, moment: m });
    }
    return out.sort((a, b) => b.moment.createdAt - a.moment.createdAt);
  }, [moments.data]);

  const gap = 10;
  const tileW = (contentWidth - gutter * 2 - gap) / 2;

  return (
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
        <RefreshControl refreshing={moments.isRefetching} onRefresh={moments.refetch} tintColor={colors.gold} colors={[colors.gold]} progressViewOffset={insets.top} />
      }
      showsVerticalScrollIndicator={false}
    >
      {header}

      {moments.isLoading ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap, marginTop: space.lg }}>
          <Skeleton style={{ width: tileW, height: tileW * 1.3, borderRadius: radius.md }} />
          <Skeleton style={{ width: tileW, height: tileW * 1.3, borderRadius: radius.md }} />
          <Skeleton style={{ width: tileW, height: tileW * 1.3, borderRadius: radius.md }} />
          <Skeleton style={{ width: tileW, height: tileW * 1.3, borderRadius: radius.md }} />
        </View>
      ) : moments.isError ? (
        <ErrorState message={moments.error instanceof Error ? moments.error.message : 'Moments didn’t load.'} onRetry={moments.refetch} />
      ) : tiles.length ? (
        <>
          <Txt variant="small" color="textSecondary" style={{ marginTop: space.lg, marginBottom: space.sm }}>
            {tiles.length} {tiles.length === 1 ? 'Moment' : 'Moments'} · gone after 24 hours
          </Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
            {tiles.map((tile) => (
              <MomentTile
                key={tile.key}
                tile={tile}
                width={tileW}
                mine={tile.key.startsWith('mine-')}
                onPress={() => navigation.navigate('MomentViewer', { userId: tile.author.id, mine: tile.key.startsWith('mine-') })}
              />
            ))}
          </View>
        </>
      ) : (
        <EmptyState
          icon="sparkles-outline"
          title="No Moments right now"
          message="Moments from people you’ve Clicked with show up here, and yours do too. They’re gone in 24 hours."
          action={{ label: 'Share a Moment', onPress: () => navigation.navigate('MomentComposer') }}
        />
      )}
    </ScrollView>
  );
}

function MomentTile({ tile, width, mine, onPress }: { tile: Tile; width: number; mine: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const { author, moment } = tile;
  const unread = !mine && !moment.seen;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${author.name}’s Moment, ${timeAgo(moment.createdAt)}`}
      style={{
        width,
        borderRadius: radius.md,
        overflow: 'hidden',
        borderWidth: unread ? 1 : 0,
        borderColor: colors.goldLine,
        backgroundColor: colors.card,
      }}
    >
      <MomentPreview moment={moment} style={{ width: '100%', height: width * 1.3 }} textSize={13} lines={4} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 8 }}>
        <Avatar uri={author.photo} name={author.name} size={22} ring={author.mutual ? 'crush' : undefined} />
        <Txt variant="caption" color="textSecondary" numberOfLines={1} style={{ flexShrink: 1 }}>
          {author.name}
        </Txt>
        {author.verified ? <VerifiedBadge size={11} /> : null}
        <Txt variant="caption" color="textMuted" style={{ marginLeft: 'auto' }}>
          {timeAgo(moment.createdAt)}
        </Txt>
      </View>
    </Pressable>
  );
}
