import React, { useMemo, useRef } from 'react';
import { Animated, PanResponder, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { haptic } from '../lib/haptics';

/**
 * Drag a message toward the middle of the screen to answer it — the gesture
 * everyone already knows from the other chat apps, so it needs no explaining.
 *
 * Vertical drags are deliberately left alone: this sits inside a scrolling
 * list, and claiming those would break scrolling. Only a clearly sideways
 * movement is captured.
 */
const TRIGGER = 56; // px toward the middle before it counts
const MAX_DRAG = 64;

export function SwipeToReply({
  mine,
  onReply,
  children,
}: {
  mine: boolean;
  onReply: () => void;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  const drag = useRef(new Animated.Value(0)).current;
  const fired = useRef(false);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) =>
          Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.4,
        onPanResponderGrant: () => {
          fired.current = false;
        },
        onPanResponderMove: (_e, g) => {
          const toward = mine ? -g.dx : g.dx;
          drag.setValue(Math.max(0, Math.min(toward, MAX_DRAG)));
          if (!fired.current && toward >= TRIGGER) {
            fired.current = true;
            haptic.tap();
          }
        },
        onPanResponderRelease: (_e, g) => {
          const toward = mine ? -g.dx : g.dx;
          if (toward >= TRIGGER) onReply();
          Animated.spring(drag, { toValue: 0, useNativeDriver: true, friction: 8, tension: 90 }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(drag, { toValue: 0, useNativeDriver: true, friction: 8, tension: 90 }).start();
        },
      }),
    [drag, mine, onReply],
  );

  const offset = mine ? Animated.multiply(drag, new Animated.Value(-1)) : drag;
  const iconOpacity = drag.interpolate({ inputRange: [6, TRIGGER], outputRange: [0, 1], extrapolate: 'clamp' });
  const iconScale = drag.interpolate({ inputRange: [6, TRIGGER], outputRange: [0.6, 1], extrapolate: 'clamp' });

  return (
    <View style={{ position: 'relative' }}>
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          [mine ? 'right' : 'left']: 4,
          justifyContent: 'center',
          opacity: iconOpacity,
          transform: [{ scale: iconScale }],
        }}
        pointerEvents="none"
      >
        <Ionicons name="arrow-undo-outline" size={20} color={colors.gold} />
      </Animated.View>
      <Animated.View {...pan.panHandlers} style={{ transform: [{ translateX: offset }] }}>
        {children}
      </Animated.View>
    </View>
  );
}
