import React, { useRef } from 'react';
import { Animated, Pressable, type PressableProps, type StyleProp, type ViewStyle, Platform } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

type Props = Omit<PressableProps, 'style'> & {
  /**
   * Styling for the *inner* layer: the thing that scales. Backgrounds, borders,
   * padding and layout of this component's own children belong here.
   */
  style?: StyleProp<ViewStyle>;
  /**
   * Styling for the outer pressable — the element that is a sibling of whatever
   * wraps it. Anything about how this component sits *among its siblings* has to
   * go here: `flex`, `alignSelf`, margins used for rhythm.
   *
   * This exists because `style` lands on the inner layer, so `style={{ flex: 1 }}`
   * silently does nothing: the outer pressable still sizes to content. That is
   * how a three-column strip ends up with three min-content columns instead of
   * three thirds.
   */
  containerStyle?: StyleProp<ViewStyle>;
  /** How far the element sinks on press (0.96 = 4%). */
  pressedScale?: number;
  children?: React.ReactNode;
};

/**
 * The base of every tappable surface: a restrained press-in scale plus
 * opacity, falling back to opacity only when Reduce Motion is on.
 */
export function PressableScale({ style, containerStyle, pressedScale = 0.97, children, disabled, onPressIn, onPressOut, ...rest }: Props) {
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
      style={containerStyle}
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
      <Animated.View style={[style, containerStyle ? { flex: 1 } : null, { transform: [{ scale }], opacity: disabled ? 0.45 : opacity }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
