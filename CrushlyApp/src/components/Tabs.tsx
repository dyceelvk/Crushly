/**
 * The tab row.
 *
 * Modelled on the one in the feed app everyone has used, because it is right:
 * the active tab is *only* brighter. No underline, no pill, no box, no arrow.
 * Measured on that app: active text sits at full near-white, inactive at 60%,
 * both at the same size and weight — so the state is one value moving, and the
 * row never reflows when you switch tabs.
 *
 * The count travels with the label instead of beside it, in a smaller size at
 * the same colour, so "People 4" reads as one thing.
 *
 * Measured twice, a fortnight apart, on the live page: 15 px, weight 500 for
 * every tab; active `rgb(246,246,246)`, inactive `rgba(255,255,255,0.6)`; the
 * parent's border-bottom computes to `0px none` and its background to
 * transparent, and no tab carries `role="tab"` or `aria-selected`. So the
 * weight does not change — the active tab is not bolder, only brighter, which
 * is what stops the row shifting sideways every time you touch it.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { useSwipeTabs } from './SwipeTabs';
import { fonts } from '../theme/tokens';
import { DUR, EASE_OUT, duration as dur } from '../lib/motion';

export type TabItem<T extends string> = {
  id: T;
  label: string;
  count?: number;
};

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  accessibilityLabel,
}: {
  tabs: TabItem<T>[];
  active: T;
  onChange: (id: T) => void;
  accessibilityLabel?: string;
}) {
  const { colors, reduceMotion } = useTheme();
  const { width } = useWindowDimensions();
  const swipe = useSwipeTabs({ options: tabs.map(t => t.id), value: active, onChange, width });
  return (
    /* A row, not a scroll area.
       This was a horizontal ScrollView, and that one word was a trap: when the
       labels and their counts added up to more than the width of the phone — a
       notch wider, a bigger system font — the row silently became something you
       scroll, so the last tabs sat off the right edge with nothing to say so.
       Inside a page that scrolls up and down, a sideways drag is the gesture the
       page usually wins, so the tab you could not see was also the tab you could
       not reach. Now the row fits: tabs shrink, labels stay on one line, and
       every tab in the list is on the screen and tappable at any size. */
    <View {...swipe.panHandlers} style={{ flexDirection: 'row', gap: 20 }} accessibilityLabel={accessibilityLabel}>
      {tabs.map((t) => (
        <Tab
          key={t.id}
          label={t.label}
          count={t.count}
          active={t.id === active}
          onPress={() => onChange(t.id)}
          color={colors.text}
          muted={colors.textSecondary}
          ms={dur(DUR.label, reduceMotion)}
        />
      ))}
    </View>
  );
}

function Tab({
  label,
  count,
  active,
  onPress,
  color,
  muted,
  ms,
}: {
  label: string;
  count?: number;
  active: boolean;
  onPress: () => void;
  color: string;
  muted: string;
  ms: number;
}) {
  // One value per tab, animated rather than swapped, because a colour that
  // jumps reads as a different control; a colour that fades reads as the same
  // control in a different state.
  const lit = useRef(new Animated.Value(active ? 1 : 0)).current;

  useEffect(() => {
    const a = Animated.timing(lit, {
      toValue: active ? 1 : 0,
      duration: ms,
      easing: EASE_OUT,
      useNativeDriver: Platform.OS !== 'web',
    });
    a.start();
    return () => a.stop();
  }, [active, lit, ms]);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={count === undefined ? label : `${label}, ${count}`}
      hitSlop={8}
      style={{ paddingVertical: 6, flexShrink: 1, minWidth: 0 }}
    >
      <Animated.View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5, opacity: lit.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }}>
        <Text
          style={{
            fontFamily: fonts.medium,
            fontSize: 15,
            color,
          }}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
          maxFontSizeMultiplier={1.3}
        >
          {label}
        </Text>
        {count !== undefined && count > 0 ? (
          <View style={{ minWidth: 14 }}>
            <Text style={{ fontSize: 11, color: muted }} maxFontSizeMultiplier={1.2}>
              {count > 99 ? '99+' : count}
            </Text>
          </View>
        ) : null}
      </Animated.View>
    </Pressable>
  );
}
