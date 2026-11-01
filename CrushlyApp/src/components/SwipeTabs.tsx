import React, { useRef } from 'react';
import { Animated, PanResponder, View, type ViewStyle } from 'react-native';

/**
 * Swiping between tabs.
 *
 * A tab is not a menu — each one is the same page seen from a different angle —
 * so the hand should be able to turn the page. Dragging sideways pulls the
 * content with the finger and, past about a fifth of the width, hands over to
 * the neighbouring tab: left goes to the tab on the right of the bar, because
 * that is the direction the content travels.
 *
 * The gesture only claims the touch when it is clearly horizontal, so a list
 * inside a tab still scrolls, and a photo carousel inside one still pages.
 */
export function useSwipeTabs<T extends string>({
  options,
  value,
  onChange,
  width,
}: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
  width: number;
}) {
  const offset = useRef(new Animated.Value(0)).current;
  const index = Math.max(0, options.indexOf(value));
  // Read inside the responder, which is created once.
  const live = useRef({ index, width, options, onChange });
  live.current = { index, width, options, onChange };

  const settle = () => {
    Animated.spring(offset, { toValue: 0, useNativeDriver: true, damping: 24, stiffness: 260, mass: 0.6 }).start();
  };

  const pan = useRef(
    PanResponder.create({
      // Never the first claim: taps and vertical scrolls belong to whatever is
      // inside the tab.
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6,
      onPanResponderMove: (_e, g) => {
        const { index: i, options: opts, width: w } = live.current;
        let dx = g.dx;
        // A tired edge: past the first or last tab the content barely moves.
        if ((i === 0 && dx > 0) || (i === opts.length - 1 && dx < 0)) dx *= 0.25;
        offset.setValue(dx);
        void w;
      },
      onPanResponderRelease: (_e, g) => {
        const { index: i, options: opts, onChange: change, width: w } = live.current;
        const travelled = g.dx;
        const fast = Math.abs(g.vx) > 0.45;
        const far = Math.abs(travelled) > Math.max(48, w * 0.18);
        const next = travelled < 0 ? i + 1 : i - 1;
        if ((far || fast) && next >= 0 && next < opts.length) {
          change(opts[next]);
        }
        settle();
      },
      onPanResponderTerminate: settle,
    }),
  ).current;

  return {
    panHandlers: pan.panHandlers,
    style: { transform: [{ translateX: offset }] } as Animated.WithAnimatedObject<ViewStyle>,
  };
}

/** The content area of a tab screen: drag it, and the tab changes. */
export function SwipeTabs<T extends string>({
  options,
  value,
  onChange,
  width,
  children,
  style,
}: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
  width: number;
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  const swipe = useSwipeTabs({ options, value, onChange, width });
  return (
    <View {...swipe.panHandlers} style={style}>
      <Animated.View style={swipe.style}>{children}</Animated.View>
    </View>
  );
}
