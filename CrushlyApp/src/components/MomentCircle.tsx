import React, { useMemo } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Txt } from './Txt';
import { Avatar, Photo } from './Photo';
import { ClipThumb } from './ClipThumb';
import { mediaUrl } from '../api/client';
import { useMomentCircles } from '../api/hooks';
import { useTheme } from '../theme/ThemeProvider';
import { space } from '../theme/tokens';
import { momentRingState } from '../lib/momentRings';
import type { Moment, MomentAuthor } from '../api/types';
import type { RootStackParamList } from '../navigation/types';
import { MomentPreview } from '../screens/moments/Moments';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export type MomentBubble = {
  author: MomentAuthor;
  /** The one Moment shown in the circle: the newest this person has live. */
  moment: Moment | null;
  /** How many they have live — the pill in the corner says the rest are there. */
  count: number;
  mine: boolean;
  unread: boolean;
};

/**
 * What is inside the circle.
 *
 * The circle is a picture of the Moment, not a label for it, so each kind draws
 * its own content at the size it has:
 *
 *  · a clip paints its own first frame, paused — `ClipThumb` mounts the player
 *    muted and stops it on frame one, because a `Photo` cannot decode an mp4 and
 *    an unmounted player paints nothing at all. That empty disc was the bug:
 *    a clip's Moment read as a hole in the row.
 *  · a photograph is the photograph.
 *  · a written Moment is its words, as many as fit at 8px.
 *
 * Anything that cannot draw its content falls back to the face, so a circle is
 * never a blank disc.
 */
function CirclePreview({ moment, size, fallback }: { moment: Moment; size: number; fallback: MomentAuthor }) {
  if (moment.kind === 'video' && moment.mediaUrl) {
    return <ClipThumb uri={mediaUrl(moment.mediaUrl) ?? ''} style={{ width: size, height: size }} />;
  }
  if (moment.kind === 'photo' && moment.mediaUrl) {
    return <Photo uri={moment.mediaUrl} style={{ width: size, height: size }} fit="cover" />;
  }
  if (moment.kind === 'text') {
    return <MomentPreview moment={moment} style={{ width: size, height: size }} textSize={8} lines={3} caption={false} tappable={false} />;
  }
  return <Avatar uri={fallback.photo} name={fallback.name} size={size} />;
}

/**
 * One person's Moment, as a round picture.
 *
 * A Moment is a person's day, not a piece of content with a title, so it is drawn
 * the way a person is drawn everywhere else in holUpp: in a circle, with a ring
 * that says there is something behind it right now. The ring colour belongs to
 * the member (see `lib/momentRings`), so the same face wears the same ring on
 * their Space, in this row, and in the feed.
 *
 * A row of these is the only place in the app where a Moment is a *face* rather
 * than a card. Discover keeps the card, because there you are browsing; the
 * Crushes feed opens on people, so it opens on this.
 */
export function MomentCircle({
  bubble,
  size = 74,
  showName = true,
}: {
  bubble: MomentBubble;
  size?: number;
  showName?: boolean;
}) {
  const navigation = useNavigation<Nav>();
  const { colors } = useTheme();
  const { author, moment, count, mine, unread } = bubble;
  const ring = moment ? momentRingState(author.id, true, !unread) : null;
  const ringWidth = moment ? 2.5 : 0;
  const inner = size - (ringWidth + 3) * 2;

  const open = () => {
    if (moment) navigation.navigate('MomentViewer', { userId: author.id, mine, momentId: moment.id });
    else navigation.navigate('MomentComposer');
  };

  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={
        moment
          ? `${mine ? 'Your Moment' : `${author.name}’s Moment`}${count > 1 ? `, ${count} active` : ''}. View`
          : 'Share your Moment'
      }
      style={({ pressed }) => ({ width: size + 16, alignItems: 'center', opacity: pressed ? 0.85 : 1 })}
    >
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: ringWidth,
          borderColor: ring ?? 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {moment ? (
          <View style={{ width: inner, height: inner, borderRadius: inner / 2, overflow: 'hidden', backgroundColor: colors.elevated }}>
            <CirclePreview moment={moment} size={inner} fallback={author} />
          </View>
        ) : (
          <Avatar uri={author.photo} name={author.name} size={inner} />
        )}
        {count > 1 ? (
          <View
            style={{
              position: 'absolute',
              right: -2,
              bottom: -2,
              minWidth: 20,
              height: 20,
              paddingHorizontal: 5,
              borderRadius: 10,
              backgroundColor: colors.gold,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Txt variant="caption" color="onGold">{`+${count - 1}`}</Txt>
          </View>
        ) : null}
        {!moment && mine ? (
          <View
            style={{
              position: 'absolute', right: -2, bottom: -2, width: 22, height: 22, borderRadius: 11,
              backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Txt variant="bodyStrong" color="onGold">+</Txt>
          </View>
        ) : null}
      </View>
      {showName ? (
        <Txt variant="caption" color={moment ? 'text' : 'textSecondary'} numberOfLines={1} style={{ marginTop: 6, maxWidth: size + 12 }}>
          {mine ? 'You' : author.name.split(' ')[0]}
        </Txt>
      ) : null}
    </Pressable>
  );
}

/**
 * The people you have come across, one circle each, when they have a Moment live.
 *
 * One circle per person, not one per Moment: five clips from the same member is
 * still one face in this row, and the count in the corner says the rest are
 * waiting behind it. Your own circle is always first, so the row doubles as the
 * way to see what you have live.
 *
 * "Come across" is a real test, and it lives in the database: added up, clicked
 * with, kept close, whispered with, or a Space you opened. Not a post you liked,
 * and not somebody whose public Moment merely happened to be visible. Discover
 * is where strangers' Moments are browsed, as cards; this row is for faces.
 */
export function MomentCircles({ size = 74, padding = space.md }: { size?: number; padding?: number }) {
  // The narrower set: people this member has met here, not everybody with a
  // public Moment. See `moment_circles()`.
  const { data } = useMomentCircles();
  const bubbles = useMemo<MomentBubble[]>(() => {
    if (!data) return [];
    const newest = (moments: Moment[]) =>
      moments.length ? moments.reduce((a, b) => (b.createdAt > a.createdAt ? b : a)) : null;

    const mine: MomentBubble[] = [{
      author: data.mine.user,
      moment: newest(data.mine.moments),
      count: data.mine.moments.length,
      mine: true,
      unread: false,
    }];

    const others = data.others
      .map<MomentBubble>((group) => ({
        author: group.user,
        moment: newest(group.moments),
        count: group.moments.length,
        mine: false,
        unread: group.hasUnseen,
      }))
      .sort((a, b) => (b.moment?.createdAt ?? 0) - (a.moment?.createdAt ?? 0));

    return [...mine, ...others];
  }, [data]);

  if (bubbles.length <= 1 && !bubbles[0]?.moment) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: space.xs, paddingHorizontal: padding, paddingVertical: space.sm }}
    >
      {bubbles.map((b) => (
        <MomentCircle key={`${b.mine ? 'me' : b.author.id}`} bubble={b} size={size} />
      ))}
    </ScrollView>
  );
}
