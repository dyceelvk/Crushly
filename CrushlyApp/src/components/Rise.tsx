import React, { useEffect, useRef } from 'react';
import { Animated, Platform } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { DUR, EASE_OUT, TRAVEL, duration } from '../lib/motion';

/**
 * Content arrives rather than appearing.
 *
 * A screen that pops into place reads as a flicker; the same screen rising a few
 * points while it fades reads as the app having gone and got it. The movement is
 * deliberately small — ten points and a quarter of a second, both taken from
 * `lib/motion` where they were measured rather than chosen — because this runs
 * on every card in a feed, and a transition you notice forty times is a
 * transition in the way.
 *
 * `delay` is for staggering a list: no more than a few items deep, or the last
 * card on the screen would still be arriving while you were reading it. With
 * reduce-motion on, it is simply visible — the point was never the animation.
 */
export function Rise({
  children,
  delay = 0,
  distance = TRAVEL.card,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  distance?: number;
  style?: any;
}) {
  const { reduceMotion } = useTheme();
  const anim = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      anim.setValue(1);
      return;
    }
    const a = Animated.timing(anim, {
      toValue: 1,
      duration: duration(DUR.enter, reduceMotion),
      delay,
      easing: EASE_OUT,
      // Opacity and transform only: this is a wrapper around everything, so it
      // must be able to run off the JS thread.
      useNativeDriver: Platform.OS !== 'web',
    });
    a.start();
    return () => a.stop();
  }, [anim, delay, reduceMotion]);

  return (
    <Animated.View
      style={[
        {
          opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
        },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}
