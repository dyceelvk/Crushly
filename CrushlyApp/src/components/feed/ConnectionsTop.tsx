import React, { useCallback, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Avatar } from '../Photo';
import { CircleCover } from '../CircleCover';
import { Txt } from '../Txt';
import { useCircleHighlights, useMe, useMyCircles } from '../../api/hooks';
import { useLayout } from '../Layout';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { describeHighlight } from '../../lib/highlights';
import type { CircleHighlight } from '../../api/types';

/**
 * The top of Connections.
 *
 * Three things sit above the feed, in the order a person actually uses them:
 *
 *   1. which room you are looking at — All, or one of your Circles;
 *   2. the thing you came to do — say something;
 *   3. what is happening in the rooms themselves, as a card you can read at a
 *      glance instead of a list you have to work through.
 *
 * Everything here scrolls with the list rather than floating over it. A strip
 * pinned under the tabs would eat the feed's first screen on a small phone, and
 * the feed is the page.
 */

export type CircleFilter = number | 'all';

export function ConnectionsTop({
  selected,
  onSelect,
  onCompose,
}: {
  selected: CircleFilter;
  onSelect: (value: CircleFilter) => void;
  onCompose: () => void;
}) {
  const circles = useMyCircles();
  const items = circles.data?.items ?? [];

  return (
    <View style={{ gap: space.sm }}>
      {items.length ? <CircleFilterChips circles={items} selected={selected} onSelect={onSelect} /> : null}
      <ComposerRow onCompose={onCompose} />
    </View>
  );
}

/**
 * All, or one room.
 *
 * The count is on the chip because "Sunday go sharp" means nothing until you
 * know whether it is four people or twelve — and the count is a fact the rooms
 * screen already shows.
 */
function CircleFilterChips({
  circles,
  selected,
  onSelect,
}: {
  circles: { id: number; name: string; memberCount?: number }[];
  selected: CircleFilter;
  onSelect: (value: CircleFilter) => void;
}) {
  const { colors } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: space.xs, paddingVertical: 2 }}
      accessibilityLabel="Filter by Circle"
    >
      <Chip
        label="All"
        icon="people-outline"
        active={selected === 'all'}
        onPress={() => onSelect('all')}
        colors={colors}
      />
      {circles.map((c) => (
        <Chip
          key={c.id}
          label={c.name}
          icon="people-outline"
          active={selected === c.id}
          onPress={() => onSelect(selected === c.id ? 'all' : c.id)}
          colors={colors}
        />
      ))}
    </ScrollView>
  );
}

function Chip({
  label,
  icon,
  active,
  onPress,
  colors,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  active: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={active ? `Showing ${label}` : `Show ${label}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        maxWidth: 200,
        paddingHorizontal: space.sm,
        height: 36,
        borderRadius: radius.pill,
        backgroundColor: active ? colors.primarySoft : colors.card,
        borderWidth: 1,
        borderColor: active ? colors.primaryLine : colors.border,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Ionicons name={icon} size={14} color={active ? colors.primary : colors.textSecondary} />
      <Txt variant="caption" color={active ? 'primary' : 'textSecondary'} numberOfLines={1} style={{ flexShrink: 1 }}>
        {label}
      </Txt>
    </Pressable>
  );
}

/** Say something — the composer, one tap away, without a screen change. */
function ComposerRow({ onCompose }: { onCompose: () => void }) {
  const { colors } = useTheme();
  const me = useMe();
  const photo = me.data?.profile.photos[0]?.url ?? null;
  const name = me.data?.profile.name || 'You';

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
      <Avatar uri={photo} name={name} size={36} />
      <Pressable
        onPress={onCompose}
        accessibilityRole="button"
        accessibilityLabel="Write a post"
        style={({ pressed }) => ({
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.xs,
          height: 44,
          paddingLeft: space.md,
          paddingRight: 6,
          borderRadius: radius.pill,
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.border,
          opacity: pressed ? 0.9 : 1,
        })}
      >
        <Txt variant="body" color="textMuted" style={{ flex: 1 }}>
          Say something…
        </Txt>
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: radius.pill,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.elevated,
          }}
        >
          <Ionicons name="image-outline" size={17} color={colors.textSecondary} />
        </View>
      </Pressable>
    </View>
  );
}

/** Four tiles a page, and the page you are on is the dot that is lit. */
const PER_PAGE = 4;

/**
 * Circles Preview — what your rooms have actually done.
 *
 * Every tile is a counted fact from the database: the post with the most
 * reactions in that Circle, or the room that has been talking this week. A room
 * with nothing in it produces no tile, so the card is never a row of empty
 * placeholders pretending to be activity.
 *
 * The captions follow this product's words, not another app's: a post is a
 * Crush, so the post people reacted to most is the Most Crushed Post.
 */
export function CircleHighlightsCard({ onOpenCircle }: { onOpenCircle: (circleId: number) => void }) {
  const { colors, reduceMotion } = useTheme();
  const { contentWidth } = useLayout();
  const highlights = useCircleHighlights(8);
  const scroller = useRef<ScrollView | null>(null);
  const [page, setPage] = useState(0);

  // Anything with nothing happening in it is not a highlight, whatever the score.
  const tiles = (highlights.data ?? []).filter((h) => h.kind !== 'quiet');
  if (!tiles.length) return null;

  const pages = Math.ceil(tiles.length / PER_PAGE);
  const gap = space.sm;
  const cardW = Math.min(contentWidth - space.md * 2, 560);
  const inner = cardW - space.md * 2;
  const tileW = (inner - gap * (PER_PAGE - 1)) / PER_PAGE;

  const goTo = (next: number) => {
    const i = ((next % pages) + pages) % pages;
    scroller.current?.scrollTo({ x: i * (inner + gap), animated: !reduceMotion });
    setPage(i);
  };

  return (
    <View style={{ borderRadius: radius.lg, overflow: 'hidden' }}>
      <LinearGradient
        colors={[colors.primarySoft, 'rgba(160,64,255,0.10)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <View
        style={{
          borderWidth: 1,
          borderColor: colors.primaryLine,
          borderRadius: radius.lg,
          padding: space.md,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
          <View
            style={{
              width: 26,
              height: 26,
              borderRadius: radius.pill,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.primary,
            }}
          >
            <Ionicons name="people" size={14} color={colors.onPrimary} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt variant="bodyStrong" numberOfLines={1}>
              Circles Preview
            </Txt>
          </View>
          {pages > 1 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }} accessibilityElementsHidden>
              {Array.from({ length: pages }).map((_, i) => (
                <View
                  key={i}
                  style={{
                    width: i === page ? 7 : 5,
                    height: i === page ? 7 : 5,
                    borderRadius: 4,
                    backgroundColor: i === page ? colors.primary : colors.borderStrong,
                  }}
                />
              ))}
            </View>
          ) : null}
          {pages > 1 ? (
            <Pressable
              onPress={() => goTo(page + 1)}
              accessibilityRole="button"
              accessibilityLabel="More Circles"
              hitSlop={10}
              style={{
                width: 30,
                height: 30,
                borderRadius: radius.pill,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.primary,
              }}
            >
              <Ionicons name="chevron-forward" size={16} color={colors.onPrimary} />
            </Pressable>
          ) : null}
        </View>

        <Txt variant="small" color="textSecondary" style={{ marginTop: 2 }}>
          Tap to explore more from your circles
        </Txt>

        <ScrollView
          ref={scroller}
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={inner + gap}
          decelerationRate="fast"
          contentContainerStyle={{ gap }}
          onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / (inner + gap)))}
          style={{ marginTop: space.sm }}
          accessibilityLabel="Circles highlights"
        >
          {Array.from({ length: pages }).map((_, p) => (
            <View key={p} style={{ width: inner, flexDirection: 'row', gap }}>
              {tiles.slice(p * PER_PAGE, p * PER_PAGE + PER_PAGE).map((t) => (
                <PreviewTile
                  key={t.circleId}
                  highlight={t}
                  width={tileW}
                  onPress={() => onOpenCircle(t.circleId)}
                  colors={colors}
                />
              ))}
            </View>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

function PreviewTile({
  highlight,
  width,
  onPress,
  colors,
}: {
  highlight: CircleHighlight;
  width: number;
  onPress: () => void;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const { caption, icon } = describeHighlight(highlight);
  const size = Math.max(52, Math.min(width, 76));

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${highlight.circleName}: ${caption}`}
      style={({ pressed }) => ({ width, alignItems: 'center', opacity: pressed ? 0.85 : 1 })}
    >
      <View style={{ width: size, height: size }}>
        <View
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            padding: 2,
            borderWidth: 2,
            borderColor: colors.primaryLine,
          }}
        >
          <View style={{ flex: 1, borderRadius: size / 2, overflow: 'hidden' }}>
            <CircleCover circle={{ name: highlight.circleName, coverUrl: highlight.coverUrl, theme: highlight.theme }} size={size - 8} radius={radius.pill} />
          </View>
        </View>
        <View
          style={{
            position: 'absolute',
            right: -2,
            bottom: -2,
            width: 22,
            height: 22,
            borderRadius: 11,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.primary,
            borderWidth: 2,
            borderColor: colors.bg,
          }}
        >
          <Ionicons name={icon} size={11} color={colors.onPrimary} />
        </View>
      </View>
      <Txt variant="caption" color="text" numberOfLines={2} style={{ marginTop: 6, textAlign: 'center' }}>
        {caption}
      </Txt>
    </Pressable>
  );
}
