import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Txt } from '../Txt';
import { CircleCover } from '../CircleCover';
import { Skeleton } from '../States';
import { useCircleHighlights } from '../../api/hooks';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import type { RootStackParamList } from '../../navigation/types';

/**
 * What is actually happening in your Circles.
 *
 * A rectangular card, one at a time, sliding slowly on its own — the same shape
 * a story rail uses without being one. This is not Stories and not Moments: each
 * card is a fact about a room you are already in, and the fact is engagement
 * that happened. The post with the most reactions in that Circle, or the room
 * that has been talking this week; both are counted in the database, and a room
 * with nothing in it produces no card rather than a placeholder.
 *
 * Three things it deliberately does not do:
 *
 *   * it does not slide for somebody who has asked the system not to animate
 *     things — `reduceMotion` stops the timer and the transition, and the rail
 *     becomes a horizontal scroller you drive yourself;
 *   * it does not loop forever under a thumb: pausing on touch is the rule every
 *     auto-advancing surface needs, and it resumes when the finger leaves;
 *   * it does not exist when there is nothing to show. An empty carousel is a
 *     worse empty state than no carousel.
 */
export function CircleHighlights({ top = 0 }: { top?: number }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors, reduceMotion } = useTheme();
  const { width } = useWindowDimensions();
  const highlights = useCircleHighlights(8);
  const items = highlights.data ?? [];

  const cardW = Math.min(width - space.lg * 2, 420);
  const scroll = useRef<ScrollView | null>(null);
  const [index, setIndex] = useState(0);
  const paused = useRef(false);
  const fade = useRef(new Animated.Value(1)).current;

  const goTo = useCallback(
    (next: number) => {
      if (!items.length) return;
      const i = ((next % items.length) + items.length) % items.length;
      setIndex(i);
      scroll.current?.scrollTo({ x: i * (cardW + space.sm), animated: !reduceMotion });
    },
    [items.length, cardW, reduceMotion],
  );

  /**
   * The slide. Slow on purpose — the brief asked for a slow slide and it is
   * right for a card you are meant to read: 6.5 seconds a card, which is about
   * the time it takes to read a sentence and decide whether to tap.
   */
  useEffect(() => {
    if (reduceMotion || items.length < 2) return;
    const id = setInterval(() => {
      if (paused.current) return;
      goTo(index + 1);
    }, 6500);
    return () => clearInterval(id);
  }, [index, items.length, reduceMotion, goTo]);

  // Arrive rather than appear, and never when motion is off.
  useEffect(() => {
    if (reduceMotion) {
      fade.setValue(1);
      return;
    }
    fade.setValue(0.4);
    Animated.timing(fade, { toValue: 1, duration: 260, useNativeDriver: true }).start();
  }, [index, reduceMotion, fade]);

  if (highlights.isLoading) {
    return (
      <View style={{ position: 'absolute', left: 0, right: 0, top, zIndex: 19 }} pointerEvents="none">
        <View style={{ paddingHorizontal: space.lg }}>
          <Skeleton style={{ height: 92, borderRadius: radius.lg }} />
        </View>
      </View>
    );
  }
  if (!items.length) return null;

  const open = (item: (typeof items)[number]) => {
    // A post opens inside the room it lives in — a Circle's post is not a public
    // post, so there is no viewer to open it in that would not be a second way
    // round the room's privacy.
    navigation.navigate('Circle', { circleId: item.circleId });
  };

  return (
    <Animated.View style={{ position: 'absolute', left: 0, right: 0, top, zIndex: 19, opacity: fade }} pointerEvents="box-none">
      <ScrollView
        ref={scroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={cardW + space.sm}
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.sm }}
        onTouchStart={() => {
          paused.current = true;
        }}
        onTouchEnd={() => {
          paused.current = false;
        }}
        onMomentumScrollEnd={(e) => {
          const next = Math.round(e.nativeEvent.contentOffset.x / (cardW + space.sm));
          if (next !== index) setIndex(Math.max(0, Math.min(items.length - 1, next)));
        }}
        accessibilityLabel="Circle highlights"
      >
        {items.map((item) => (
          <Pressable
            key={item.circleId}
            onPress={() => open(item)}
            accessibilityRole="button"
            accessibilityLabel={highlightLabel(item)}
            style={({ pressed }) => ({
              width: cardW,
              borderRadius: radius.lg,
              backgroundColor: 'rgba(18,18,18,0.92)',
              borderWidth: 1,
              borderColor: item.kind === 'post' ? colors.goldLine : 'rgba(255,255,255,0.14)',
              padding: space.sm,
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.sm,
              opacity: pressed ? 0.88 : 1,
            })}
          >
            <CircleCover circle={{ name: item.circleName, coverUrl: item.coverUrl, theme: item.theme }} size={56} radius={radius.md} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Txt variant="caption" color="gold" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {item.circleName}
                </Txt>
                <Txt variant="caption" color="textMuted">
                  {item.memberCount}/12
                </Txt>
              </View>
              <Txt variant="bodyStrong" color="#FFFFFF" numberOfLines={2} style={{ marginTop: 2 }}>
                {item.kind === 'post' && item.body
                  ? item.body
                  : item.kind === 'post'
                    ? 'A post people reacted to'
                    : `${item.messages} ${item.messages === 1 ? 'message' : 'messages'} this week`}
              </Txt>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}>
                {item.likes ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                    <Ionicons name="heart" size={11} color={colors.crush} />
                    <Txt variant="caption" color="textMuted">
                      {item.likes}
                    </Txt>
                  </View>
                ) : null}
                {item.comments ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                    <Ionicons name="chatbubble-outline" size={11} color={colors.textMuted} />
                    <Txt variant="caption" color="textMuted">
                      {item.comments}
                    </Txt>
                  </View>
                ) : null}
                {item.messages ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                    <Ionicons name="flame-outline" size={11} color={colors.gold} />
                    <Txt variant="caption" color="textMuted">
                      {item.messages}
                    </Txt>
                  </View>
                ) : null}
                <Txt variant="caption" color="textMuted" style={{ marginLeft: 'auto' }}>
                  Open
                </Txt>
              </View>
            </View>
          </Pressable>
        ))}
      </ScrollView>
      {items.length > 1 ? (
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 4, marginTop: 6 }} pointerEvents="none">
          {items.map((item, i) => (
            <View
              key={item.circleId}
              style={{
                width: i === index ? 14 : 5,
                height: 3,
                borderRadius: 2,
                backgroundColor: i === index ? colors.gold : 'rgba(255,255,255,0.28)',
              }}
            />
          ))}
        </View>
      ) : null}
    </Animated.View>
  );
}

/** What a screen reader hears: the room, then the reason the card is here. */
function highlightLabel(item: {
  circleName: string;
  kind: 'post' | 'conversation' | 'quiet';
  likes: number;
  comments: number;
  messages: number;
  body: string | null;
}): string {
  if (item.kind === 'post') {
    const bit = [item.likes ? `${item.likes} reactions` : null, item.comments ? `${item.comments} comments` : null].filter(Boolean).join(', ');
    return `${item.circleName}: ${item.body || 'a post'}${bit ? `, ${bit}` : ''}`;
  }
  return `${item.circleName}: ${item.messages} messages this week`;
}

/** Exported so the wording above can be asserted without rendering the rail. */
export { highlightLabel };
