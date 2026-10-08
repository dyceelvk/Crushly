import React, { useEffect, useRef } from 'react';
import { Animated, Platform, Pressable } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { haptic } from '../lib/haptics';

type Props = { value: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean };

/** Accessible switch with a gold track; announces on/off to screen readers. */
export function Toggle({ value, onChange, label, disabled }: Props) {
  const { colors, reduceMotion } = useTheme();
  const x = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(x, { toValue: value ? 1 : 0, duration: reduceMotion ? 0 : 160, useNativeDriver: false }).start();
  }, [value, reduceMotion, x]);
  const track = x.interpolate({ inputRange: [0, 1], outputRange: [colors.elevated, colors.gold] });
  const left = x.interpolate({ inputRange: [0, 1], outputRange: [3, 23] });
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      hitSlop={10}
      onPress={() => {
        haptic.tap();
        onChange(!value);
      }}
      style={{ opacity: disabled ? 0.45 : 1 }}
    >
      <Animated.View
        style={{
          width: 50, height: 30, borderRadius: 15, backgroundColor: track, justifyContent: 'center',
          borderWidth: 1, borderColor: value ? 'transparent' : colors.borderStrong,
        }}
      >
        <Animated.View
          style={{
            position: 'absolute', left, width: 22, height: 22, borderRadius: 11,
            backgroundColor: value ? colors.onGold : colors.textSecondary,
            ...(Platform.OS === 'web' ? {} : { shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } }),
          }}
        />
      </Animated.View>
    </Pressable>
  );
}
