import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Easing, Platform, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { PressableScale } from './PressableScale';
import { CrushIcon } from './Logo';
import { Txt } from './Txt';
import { useTheme } from '../theme/ThemeProvider';
import { haptic } from '../lib/haptics';

type Props = {
  onPress: () => void;
  crushed?: boolean;
  loading?: boolean;
  /** 'pill' shows the word "Crush"; 'round' is icon-only (tiles). */
  shape?: 'pill' | 'round';
  size?: number;
  label?: string;
  name?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * Crushly's primary action. On press: a soft scale pop and a single expanding
 * ring — felt more than seen. Reduce Motion keeps only the color change.
 */
export function CrushButton({ onPress, crushed, loading, shape = 'pill', size = 60, label, name, disabled, style }: Props) {
  const { colors, reduceMotion } = useTheme();
  const pop = useRef(new Animated.Value(1)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const prev = useRef(crushed);
  const native = Platform.OS !== 'web';

  useEffect(() => {
    if (crushed && !prev.current && !reduceMotion) {
      ring.setValue(0);
      Animated.parallel([
        Animated.sequence([
          Animated.timing(pop, { toValue: 1.12, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: native }),
          Animated.spring(pop, { toValue: 1, useNativeDriver: native, speed: 14, bounciness: 10 }),
        ]),
        Animated.timing(ring, { toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: native }),
      ]).start();
    }
    prev.current = crushed;
  }, [crushed, pop, ring, reduceMotion, native]);

  const text = label ?? (crushed ? 'Crushed' : 'Crush');
  const who = name || 'this member';
  const a11y = label && label !== 'Crush' && label !== 'Crushed' ? `${label}, ${who}` : crushed ? `You crushed on ${who}` : `Crush on ${who}`;
  const height = shape === 'pill' ? size : size;
  const width = shape === 'pill' ? undefined : size;

  return (
    <PressableScale
      onPress={() => {
        haptic.crush();
        onPress();
      }}
      disabled={disabled || loading}
      accessibilityLabel={a11y}
      accessibilityState={{ selected: !!crushed, busy: !!loading }}
      pressedScale={0.94}
      style={style}
    >
      <View style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute', width: shape === 'pill' ? '100%' : size, height, borderRadius: height / 2,
            borderWidth: 2, borderColor: colors.crush,
            opacity: ring.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.8, 0] }),
            transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 1.45] }) }],
          }}
        />
        <Animated.View style={{ transform: [{ scale: pop }], alignSelf: 'stretch' }}>
          {crushed ? (
            <View
              style={{
                height, width, borderRadius: height / 2, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
                backgroundColor: colors.crushSoft, borderWidth: 1, borderColor: colors.crush, paddingHorizontal: shape === 'pill' ? 26 : 0,
              }}
            >
              <CrushIcon size={shape === 'pill' ? 20 : size * 0.42} color={colors.crush} filled />
              {shape === 'pill' ? (
                <Txt variant="button" color="crush">
                  {text}
                </Txt>
              ) : null}
            </View>
          ) : (
            <LinearGradient
              colors={[colors.crush, colors.crushDeep]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                height, width, borderRadius: height / 2, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
                paddingHorizontal: shape === 'pill' ? 26 : 0,
                shadowColor: colors.crush, shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 6 },
              }}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <CrushIcon size={shape === 'pill' ? 20 : size * 0.42} color="#fff" />
                  {shape === 'pill' ? (
                    <Txt variant="button" color="onCrush">
                      {text}
                    </Txt>
                  ) : null}
                </>
              )}
            </LinearGradient>
          )}
        </Animated.View>
      </View>
    </PressableScale>
  );
}
