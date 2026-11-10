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
import { momentRingState } from '../../lib/momentRings';
import type { Moment, MomentAuthor } from '../../api/types';
import type { RootStackParamList } from '../../navigation/types';
import { MomentPreview } from '../moments/Moments';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Card = { key: string; author: MomentAuthor; moment: Moment; mine: boolean; count: number; unread: boolean };

const CARD_W = 128;
const CIRCLE = 84;

/**
 * Moments, as one row of Discover.
 *
 * A Moment lasts a day, so the row is about right now rather than about whatever
 * somebody once said. Everything here is already filtered by the database — a
 * Moment you may not see never reaches this screen.
 *
 * **One card per person.** The row used to be one tile per Moment, which read as
 * a grid of content: somebody who posted four times in an afternoon pushed three
 * other people off the row. Now a person appears once, wearing their newest
 * Moment, with a count saying the rest are behind it — and the picture inside the
 * card is round, because the thing you are opening is a person, not an article.
 */
export function MomentsRow() {
  const navigation = useNavigation<Nav>();
  const moments = useMoments();

  const cards = useMemo<Card[]>(() => {
    const feed = moments.data;
    if (!feed) return [];
    const newest = (list: Moment[]) => (list.length ? list.reduce((a, b) => (b.createdAt > a.createdAt ? b : a)) : null);
    const out: Card[] = [];

    for (const group of feed.others) {
      const moment = newest(group.moments);
      if (!moment) continue;
      out.push({
        key: `u${group.user.id}`,
        author: group.user,
        moment,
        mine: false,
        count: group.moments.length,
        unread: group.hasUnseen,
      });
    }
    const mine = newest(feed.mine.moments);
    if (mine) {
      out.push({
        key: `me${feed.mine.user.id}`,
        author: feed.mine.user,
        moment: mine,
        mine: true,
        count: feed.mine.moments.length,
        unread: false,
      });
    }
    return out.sort((a, b) => b.moment.createdAt - a.moment.createdAt).slice(0, 12);
  }, [moments.data]);

  if (!cards.length) return null;

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
        {cards.map((c) => (
          <MomentCard
            key={c.key}
            card={c}
            onPress={() => navigation.navigate('MomentViewer', { userId: c.author.id, mine: c.mine })}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function MomentCard({ card, onPress }: { card: Card; onPress: () => void }) {
  const { colors } = useTheme();
  const { author, moment, count, mine, unread } = card;
  const ring = momentRingState(author.id, true, !unread);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${mine ? 'Your Moment' : `${author.name}’s Moment`}, ${timeAgo(moment.createdAt)}${
        count > 1 ? `, ${count} active` : ''
      }`}
      style={({ pressed }) => ({
        width: CARD_W,
        borderRadius: radius.lg,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: unread ? colors.goldLine : colors.border,
        padding: 10,
        gap: 8,
        opacity: pressed ? 0.88 : 1,
      })}
    >
      <View style={{ alignItems: 'center' }}>
        <View
          style={{
            width: CIRCLE,
            height: CIRCLE,
            borderRadius: CIRCLE / 2,
            borderWidth: 2.5,
            borderColor: ring ?? colors.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View style={{ width: CIRCLE - 11, height: CIRCLE - 11, borderRadius: (CIRCLE - 11) / 2, overflow: 'hidden', backgroundColor: colors.elevated }}>
            <MomentPreview
              moment={moment}
              style={{ width: CIRCLE - 11, height: CIRCLE - 11 }}
              textSize={10}
              lines={3}
              caption={false}
            />
          </View>
        </View>
        {count > 1 ? (
          <View
            style={{
              position: 'absolute', right: 8, top: 62, minWidth: 22, height: 22, paddingHorizontal: 6,
              borderRadius: 11, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Txt variant="caption" color="onGold">{`+${count - 1}`}</Txt>
          </View>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Avatar uri={author.photo} name={author.name} size={18} ring={author.mutual ? 'crush' : undefined} />
        <Txt variant="caption" color="textSecondary" numberOfLines={1} style={{ flexShrink: 1 }}>
          {mine ? 'You' : author.name}
        </Txt>
      </View>
    </Pressable>
  );
}
