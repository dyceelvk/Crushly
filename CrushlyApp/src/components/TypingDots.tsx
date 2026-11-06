import React, { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

/**
 * Three dots, moving only when somebody is actually typing.
 *
 * This component is never mounted "for decoration" — the caller mounts it from a
 * typing signal that expires on its own, so a paused conversation has no dots on
 * screen. With reduced motion, the dots are drawn still: the information is the
 * presence of the indicator, not the animation.
 */
export function TypingDots({ color, size = 4 }: { color?: string; size?: number }) {
  const { colors, reduceMotion } = useTheme();
  const dots = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];

  useEffect(() => {
    if (reduceMotion) return;
    const loops = dots.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 140),
          Animated.timing(v, { toValue: 1, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: 320, easing: Easing.in(Easing.quad), useNativeDriver: true }),
          Animated.delay((2 - i) * 140),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [dots, reduceMotion]);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }} accessibilityLabel="typing">
      {dots.map((v, i) => (
        <Animated.View
          key={i}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: color ?? colors.textSecondary,
            opacity: reduceMotion ? 0.7 : v.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
            transform: reduceMotion ? undefined : [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -2] }) }],
          }}
        />
      ))}
    </View>
  );
}
