import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme/ThemeProvider';

/** Soft champagne glow used behind hero moments (splash, Mutual Crush, welcome). */
export function Glow({ size = 420, color, opacity = 1, style }: { size?: number; color?: string; opacity?: number; style?: object }) {
  const { colors } = useTheme();
  const c = color || colors.gold;
  // Stacked translucent discs approximate a radial gradient on every platform.
  return (
    <View pointerEvents="none" style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center', opacity }, style]}>
      {[1, 0.78, 0.56, 0.36].map((s, i) => (
        <View
          key={s}
          style={{ position: 'absolute', width: size * s, height: size * s, borderRadius: (size * s) / 2, backgroundColor: c, opacity: 0.035 + i * 0.03 }}
        />
      ))}
    </View>
  );
}

/** A slow diagonal light sweep, for the splash/welcome. Static under Reduce Motion. */
export function LightSweep({ duration = 1400, loop = false }: { duration?: number; loop?: boolean }) {
  const { reduceMotion } = useTheme();
  const { width } = useWindowDimensions();
  const x = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    const anim = Animated.timing(x, { toValue: 1, duration, easing: Easing.inOut(Easing.cubic), useNativeDriver: Platform.OS !== 'web' });
    const run = loop ? Animated.loop(Animated.sequence([anim, Animated.delay(1800)])) : anim;
    run.start();
    return () => run.stop();
  }, [x, duration, loop, reduceMotion]);
  if (reduceMotion) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        { transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [-width * 1.2, width * 1.2] }) }, { rotate: '18deg' }] },
      ]}
    >
      <LinearGradient
        colors={['transparent', 'rgba(240,213,154,0.10)', 'rgba(255,255,255,0.06)', 'transparent']}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={{ position: 'absolute', top: '-50%', bottom: '-50%', left: '30%', width: 180 }}
      />
    </Animated.View>
  );
}

/** A handful of drifting gold/crimson motes — the Mutual Crush celebration, kept quiet. */
export function Particles({ count = 18 }: { count?: number }) {
  const { colors, reduceMotion } = useTheme();
  const { width, height } = useWindowDimensions();
  const seeds = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        x: Math.random() * width,
        y: height * (0.25 + Math.random() * 0.5),
        size: 3 + Math.random() * 4,
        delay: Math.random() * 900,
        drift: 60 + Math.random() * 120,
        color: i % 3 === 0 ? colors.crush : colors.goldBright,
      })),
    [count, width, height, colors],
  );
  const anims = useRef(seeds.map(() => new Animated.Value(0))).current;
  useEffect(() => {
    if (reduceMotion) return;
    const all = Animated.stagger(
      40,
      anims.map((a, i) =>
        Animated.loop(
          Animated.sequence([
            Animated.delay(seeds[i].delay),
            Animated.timing(a, { toValue: 1, duration: 2600, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
            Animated.timing(a, { toValue: 0, duration: 0, useNativeDriver: Platform.OS !== 'web' }),
          ]),
        ),
      ),
    );
    all.start();
    return () => all.stop();
  }, [anims, seeds, reduceMotion]);
  if (reduceMotion) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {seeds.map((s, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute', left: s.x, top: s.y, width: s.size, height: s.size, borderRadius: s.size / 2, backgroundColor: s.color,
            opacity: anims[i].interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: [0, 0.9, 0.5, 0] }),
            transform: [{ translateY: anims[i].interpolate({ inputRange: [0, 1], outputRange: [0, -s.drift] }) }],
          }}
        />
      ))}
    </View>
  );
}
