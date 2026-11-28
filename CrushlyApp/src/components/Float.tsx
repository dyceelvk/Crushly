import React, { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

/**
 * The slow drift.
 *
 * Some things on holUpp breathe: a repost thought hovering over its label, the
 * reaction faces under a name. They float — a few pixels, one long lazy arc,
 * no bounce, no speed. It is a presence, not an animation competing for the
 * eye; the loop runs at walking pace and stops when the screen is gone.
 */
export function Float({
  children,
  distance = 3.5,
  duration = 3400,
  delay = 0,
}: {
  children: React.ReactNode;
  /** How far the drift travels, in dp, each way. */
  distance?: number;
  duration?: number;
  delay?: number;
}) {
  const y = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(y, { toValue: -distance, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(y, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    const t = setTimeout(() => loop.start(), delay);
    return () => {
      clearTimeout(t);
      loop.stop();
    };
  }, [y, distance, duration, delay]);

  return <Animated.View style={{ transform: [{ translateY: y }] }}>{children}</Animated.View>;
}
