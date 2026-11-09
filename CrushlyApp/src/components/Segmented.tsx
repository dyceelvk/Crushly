import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, View } from 'react-native';
import { Txt } from './Txt';
import { useTheme } from '../theme/ThemeProvider';
import { haptic } from '../lib/haptics';
import { useSwipeTabs } from './SwipeTabs';

type Option<T extends string> = { value: T; label: string; count?: number };

/**
 * The tab bar, with a thumb that travels.
 *
 * It used to redraw as a different pill under whichever word you pressed —
 * which is correct and feels like a page reload. The thumb now slides, so the
 * movement itself says what happened: this is where you were, this is where you
 * are. The words do not move; only the light behind them does.
 *
 * A press still changes the tab immediately. The slide is what you see while the
 * new tab is already loading underneath it.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  swipeable = false,
}: {
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
  swipeable?: boolean;
}) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const inner = Math.max(0, width - 8); // the 4 px of padding on each side
  const itemWidth = options.length ? inner / options.length : 0;
  const x = useRef(new Animated.Value(0)).current;
  const swipe = useSwipeTabs({ options: options.map(o => o.value), value, onChange, width });

  useEffect(() => {
    Animated.spring(x, {
      toValue: index * itemWidth,
      useNativeDriver: true,
      damping: 22,
      stiffness: 240,
      mass: 0.6,
    }).start();
  }, [index, itemWidth, x]);

  return (
    <View
      {...(swipeable ? swipe.panHandlers : {})}
      accessibilityRole="tablist"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ flexDirection: 'row', backgroundColor: colors.card, borderRadius: 999, padding: 4, borderWidth: 1, borderColor: colors.border }}
    >
      {/* The travelling thumb sits under the words. */}
      {itemWidth > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 4,
            left: 4,
            width: itemWidth,
            height: 40,
            borderRadius: 999,
            backgroundColor: colors.elevated,
            borderWidth: 1,
            borderColor: colors.primaryLine,
            transform: [{ translateX: x }],
          }}
        />
      ) : null}
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${o.label}${o.count != null ? `, ${o.count}` : ''}`}
            onPress={() => {
              haptic.tap();
              onChange(o.value);
            }}
            style={{
              flexGrow: 1, flexShrink: 1, flexBasis: 'auto', minHeight: 40, borderRadius: 999, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6,
              paddingHorizontal: 10, backgroundColor: 'transparent',
            }}
          >
            <Txt variant="smallStrong" color={active ? 'text' : 'textSecondary'} numberOfLines={1} maxFontSizeMultiplier={1.25} style={{ flexShrink: 1 }}>
              {o.label}
            </Txt>
            {o.count ? (
              <Txt variant="caption" color={active ? 'primary' : 'textMuted'} maxFontSizeMultiplier={1.2}>
                {o.count}
              </Txt>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
