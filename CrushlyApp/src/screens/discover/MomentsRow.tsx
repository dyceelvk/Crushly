import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
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

/*
 * The size of a Moment in the Moments tab, not a poster.
 *
 * This row was 132 × 266 — twice as tall as it was wide, taller than two rows of
 * anything else on Discover — so one Moment filled the screen and the section
 * read as a billboard rather than a row you glance along. It is the same shape
 * the Moments tab uses (three to a phone screen, four by five-ish), which is the
 * size the owner pointed at: `width` by `width × 1.35`, the pebbles below the
 * fold on that screen.
 */
const CARD_W = 104;
const CARD_H = Math.round(CARD_W * 1.35); // 140 — the Moments tab's own ratio

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
            onPress={() => navigation.navigate('MomentViewer', { userId: c.author.id, mine: c.mine, momentId: c.moment.id })}
          />
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * One person's Moment, as a block of the thing itself.
 *
 * This card has now been three things. It was a grid of tiles, one per Moment,
 * which pushed people off the row. Then it was a card with a round picture
 * inside a coloured ring — content wrapped in chrome, which is the shape the
 * owner keeps rejecting: the ring was decoration around a face, and the card
 * around that was a second layer of decoration.
 *
 * It is neither now. The card *is* the Moment: the words in its own typeface on
 * its own colour, edge to edge, with the person's name along the bottom the way
 * it reads in the Moment itself. A photograph Moment is the photograph. The only
 * things drawn on top are the name and, where somebody posted more than once
 * today, how many more there are.
 */
function MomentCard({ card, onPress }: { card: Card; onPress: () => void }) {
  const { colors } = useTheme();
  const { author, moment, count, mine, unread } = card;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${mine ? 'Your Moment' : `${author.name}’s Moment`}, ${timeAgo(moment.createdAt)}${
        count > 1 ? `, ${count} active` : ''
      }`}
      style={({ pressed }) => ({
        width: CARD_W,
        height: CARD_H,
        borderRadius: radius.lg,
        overflow: 'hidden',
        backgroundColor: colors.card,
        // No border, except the one thing worth marking: something here you have
        // not watched yet.
        borderWidth: unread ? 1 : 0,
        borderColor: unread ? colors.goldLine : 'transparent',
        transform: [{ scale: pressed ? 0.985 : 1 }],
      })}
    >
      <MomentPreview
        moment={moment}
        style={
          moment.kind === 'post'
            // Left, right and top only: the handle lives in the bottom strip.
            ? { position: 'absolute', left: 0, right: 0, top: 0, bottom: 30, alignItems: 'center', justifyContent: 'center' }
            : StyleSheet.absoluteFill
        }
        textSize={11}
        lines={4}
        caption={false}
        /* The card is the tap: open this Moment, not the post behind it. */
        tappable={false}
      />
      {/* The name sits on the content, on a shade deep enough to read on any
          photograph and invisible on a dark one. */}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']}
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 48 }}
      />
      {/*
        A shared post draws its own handle under its own preview, because the
        name that matters there is the author of the post, not whoever shared it.
        Two names stacked in the same corner is one name too many.
      */}
      <View
        style={{
          position: 'absolute',
          left: 7,
          right: 7,
          bottom: 6,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          opacity: moment.kind === 'post' ? 0 : 1,
        }}
        pointerEvents={moment.kind === 'post' ? 'none' : 'auto'}
      >
        <Avatar uri={author.photo} name={author.name} size={18} ring={author.mutual ? 'crush' : undefined} />
        <Txt variant="caption" color="#FFFFFF" numberOfLines={1} style={{ flexShrink: 1, fontWeight: '600' }}>
          {mine ? 'You' : author.name}
        </Txt>
        {count > 1 ? (
          <View style={{ marginLeft: 'auto', paddingHorizontal: 5, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.45)' }}>
            <Txt variant="caption" color="#FFFFFF">{`+${count - 1}`}</Txt>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
