import React, { useRef } from 'react';
import { Animated, Pressable, type PressableProps, type StyleProp, type ViewStyle, Platform } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

type Props = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  /** How far the element sinks on press (0.96 = 4%). */
  pressedScale?: number;
  children?: React.ReactNode;
};

/**
 * The base of every tappable surface: a restrained press-in scale plus
 * opacity, falling back to opacity only when Reduce Motion is on.
 */
export function PressableScale({ style, pressedScale = 0.97, children, disabled, onPressIn, onPressOut, ...rest }: Props) {
  const { reduceMotion } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const native = Platform.OS !== 'web';

  const animate = (to: number) => {
    Animated.parallel([
      reduceMotion
        ? Animated.timing(scale, { toValue: 1, duration: 0, useNativeDriver: native })
        : Animated.spring(scale, { toValue: to, useNativeDriver: native, speed: 40, bounciness: 0 }),
      Animated.timing(opacity, { toValue: to === 1 ? 1 : 0.86, duration: 90, useNativeDriver: native }),
    ]).start();
  };

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPressIn={(e) => {
        animate(pressedScale);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        animate(1);
        onPressOut?.(e);
      }}
      {...rest}
    >
      <Animated.View style={[style, { transform: [{ scale }], opacity: disabled ? 0.45 : opacity }]}>{children}</Animated.View>
    </Pressable>
  );
}
