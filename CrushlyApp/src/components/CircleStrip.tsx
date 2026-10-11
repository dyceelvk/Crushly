import React, { useMemo } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Txt } from './Txt';
import { Photo } from './Photo';
import { Skeleton } from './States';
import { useMyCircles } from '../api/hooks';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import type { CircleSummary } from '../api/types';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const CARD_W = 148;
const CARD_H = 92;

/**
 * Your Circles, across the top of Home.
 *
 * A Circle is the one thing here that is genuinely a place rather than a feed:
 * about twelve people, their own posts, their own chat, and nobody else
 * watching. So it sits at the front — the first thing you see when Crushly
 * opens is not a list of strangers but the rooms you already belong to, with
 * anything new in them marked.
 *
 * Rooms with something unread come first, then whichever was spoken in most
 * recently. A Circle you are not in never appears here at all.
 */
export function CircleStrip() {
  const navigation = useNavigation<Nav>();
  const { colors } = useTheme();
  const circles = useMyCircles();

  const items = useMemo<CircleSummary[]>(() => {
    const list = circles.data?.items ?? [];
    return [...list].sort(
      (a, b) =>
        Number(b.unreadCount > 0) - Number(a.unreadCount > 0) ||
        (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0),
    );
  }, [circles.data]);

  if (circles.isLoading && !items.length) {
    return (
      <View>
        <SectionHead />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Skeleton style={{ width: CARD_W, height: CARD_H, borderRadius: radius.md }} />
          <Skeleton style={{ width: CARD_W, height: CARD_H, borderRadius: radius.md }} />
        </View>
      </View>
    );
  }

  return (
    <View>
      <SectionHead
        count={items.length}
        onSeeAll={() => navigation.navigate('Circles')}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
        {items.map((c) => (
          <CircleCard key={c.id} circle={c} onPress={() => navigation.navigate('Circle', { circleId: c.id })} />
        ))}
        <NewCard onPress={() => navigation.navigate('Circles')} hasCircles={items.length > 0} />
      </ScrollView>
    </View>
  );
}

function SectionHead({ count, onSeeAll }: { count?: number; onSeeAll?: () => void }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        marginBottom: space.sm,
      }}
    >
      <Txt variant="title" accessibilityRole="header">
        Your Circles
      </Txt>
      {count && onSeeAll ? (
        <Pressable onPress={onSeeAll} accessibilityRole="link" accessibilityLabel="See all Circles" hitSlop={8}>
          <Txt variant="smallStrong" color="gold">
            See all ›
          </Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

function CircleCard({ circle, onPress }: { circle: CircleSummary; onPress: () => void }) {
  const { colors } = useTheme();
  const unread = circle.unreadCount > 0;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        unread
          ? `${circle.name}, ${circle.unreadCount} unread`
          : `${circle.name}, ${circle.memberCount} members`
      }
      style={{
        width: CARD_W,
        height: CARD_H,
        borderRadius: radius.md,
        overflow: 'hidden',
        backgroundColor: colors.card,
        borderWidth: unread ? 1.5 : 0,
        borderColor: colors.gold,
      }}
    >
      {circle.coverUrl ? (
        <Photo uri={circle.coverUrl} style={{ width: '100%', height: '100%' }} />
      ) : (
        <View style={{ flex: 1, backgroundColor: colors.elevated, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="people-outline" size={22} color={colors.textMuted} />
        </View>
      )}
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          paddingHorizontal: 9,
          paddingVertical: 7,
          backgroundColor: 'rgba(0,0,0,0.55)',
        }}
      >
        <Txt variant="smallStrong" style={{ color: '#fff' }} numberOfLines={1}>
          {circle.name}
        </Txt>
        <Txt variant="caption" style={{ color: 'rgba(255,255,255,0.75)' }} numberOfLines={1}>
          {circle.memberCount} {circle.memberCount === 1 ? 'member' : 'members'}
        </Txt>
      </View>
      {unread ? (
        <View
          style={{
            position: 'absolute',
            top: 7,
            right: 7,
            minWidth: 20,
            height: 20,
            borderRadius: 10,
            backgroundColor: colors.gold,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 5,
          }}
        >
          <Txt variant="caption" style={{ color: '#000', fontWeight: '700' }}>
            {circle.unreadCount > 99 ? '99+' : circle.unreadCount}
          </Txt>
        </View>
      ) : null}
    </Pressable>
  );
}

function NewCard({ onPress, hasCircles }: { onPress: () => void; hasCircles: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={hasCircles ? 'Find or start a Circle' : 'Start a Circle'}
      style={{
        width: CARD_W,
        height: CARD_H,
        borderRadius: radius.md,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: colors.border,
        backgroundColor: colors.card,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        paddingHorizontal: 10,
      }}
    >
      <Ionicons name="add" size={20} color={colors.gold} />
      <Txt variant="caption" color="textSecondary" numberOfLines={2} style={{ textAlign: 'center' }}>
        {hasCircles ? 'Find or start a Circle' : 'Start a Circle — a room for about twelve'}
      </Txt>
    </Pressable>
  );
}
