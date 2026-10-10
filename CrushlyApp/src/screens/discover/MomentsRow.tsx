import React, { useMemo } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Txt } from '../../components/Txt';
import { Avatar } from '../../components/Photo';
import { useMoments } from '../../api/hooks';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { timeAgo } from '../../lib/format';
import type { Moment, MomentAuthor } from '../../api/types';
import type { RootStackParamList } from '../../navigation/types';
import { MomentPreview } from '../moments/Moments';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Tile = { key: string; author: MomentAuthor; moment: Moment; mine: boolean };

const TILE_W = 104;
const TILE_H = 138;

/**
 * Moments, as one row of Discover.
 *
 * Moments last a day and Vibes last a fortnight, so they sit as different
 * sections rather than one another's tabs: same people, different promises
 * about how long the thing stays. Everything here is already filtered by the
 * database — a Moment you may not see never reaches this screen.
 */
export function MomentsRow() {
  const navigation = useNavigation<Nav>();
  const moments = useMoments();

  const tiles = useMemo<Tile[]>(() => {
    const feed = moments.data;
    if (!feed) return [];
    const out: Tile[] = [];
    for (const m of feed.mine.moments) out.push({ key: `mine-${m.id}`, author: feed.mine.user, moment: m, mine: true });
    for (const g of feed.others) {
      for (const m of g.moments) out.push({ key: `${g.user.id}-${m.id}`, author: g.user, moment: m, mine: false });
    }
    return out.sort((a, b) => b.moment.createdAt - a.moment.createdAt).slice(0, 12);
  }, [moments.data]);

  if (!tiles.length) return null;

  return (
    <View>
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
          Moments
        </Txt>
        <Pressable
          onPress={() => navigation.navigate('Moments')}
          accessibilityRole="link"
          accessibilityLabel="See all Moments"
          hitSlop={8}
        >
          <Txt variant="smallStrong" color="gold">
            See all ›
          </Txt>
        </Pressable>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 10, paddingRight: space.md }}
      >
        {tiles.map((t) => (
          <MomentTile
            key={t.key}
            tile={t}
            onPress={() => navigation.navigate('MomentViewer', { userId: t.author.id, mine: t.mine })}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function MomentTile({ tile, onPress }: { tile: Tile; onPress: () => void }) {
  const { colors } = useTheme();
  const { author, moment } = tile;
  const unread = !tile.mine && !moment.seen;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${author.name}’s Moment, ${timeAgo(moment.createdAt)}`}
      style={{
        width: TILE_W,
        borderRadius: radius.md,
        overflow: 'hidden',
        borderWidth: unread ? 1.5 : 0,
        borderColor: colors.gold,
        backgroundColor: colors.card,
      }}
    >
      <MomentPreview moment={moment} style={{ width: '100%', height: TILE_H - 34 }} textSize={11} lines={3} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 7, paddingVertical: 6 }}>
        <Avatar uri={author.photo} name={author.name} size={18} ring={author.mutual ? 'crush' : undefined} />
        <Txt variant="caption" color="textSecondary" numberOfLines={1} style={{ flexShrink: 1 }}>
          {tile.mine ? 'You' : author.name}
        </Txt>
      </View>
    </Pressable>
  );
}
