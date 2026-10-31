import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme/ThemeProvider';

/**
 * Soft glow used behind hero moments (splash, Mutual Crush, welcome).
 *
 * React Native has no radial gradient, so this fakes one with concentric discs.
 * It used to be four of them at increasing opacity, which at large sizes and
 * low alphas banded into four visible rings — the edges read as hard circles
 * rather than a falloff.
 *
 * Now the ring count scales and each ring's alpha is solved from the target
 * centre density, so the steps between rings are below what an 8-bit channel
 * can show. Sixteen rings at ~0.7% each accumulate to the same centre brightness
 * as the old four at 3-12%, but without the contours. `density` is the
 * accumulated opacity at the middle of the glow.
 */
export function Glow({
  size = 420,
  color,
  opacity = 1,
  density = 0.14,
  style,
}: {
  size?: number;
  color?: string;
  opacity?: number;
  /** Accumulated alpha at the centre of the glow. Lower is softer. */
  density?: number;
  style?: object;
}) {
  const { colors } = useTheme();
  const c = color || colors.gold;

  // Enough rings that the hue step between neighbours is invisible, capped so
  // a huge glow does not become hundreds of views.
  const rings = Math.min(28, Math.max(10, Math.round(size / 34)));
  // alpha each ring needs so that `rings` stacked layers reach `density`.
  const step = 1 - Math.pow(1 - Math.min(Math.max(density, 0.01), 0.9), 1 / rings);

  return (
    <View pointerEvents="none" style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center', opacity }, style]}>
      {Array.from({ length: rings }, (_, i) => {
        // i = 0 is the largest (outermost, faintest edge of the falloff)
        const scale = 1 - i / rings;
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              width: size * scale,
              height: size * scale,
              borderRadius: (size * scale) / 2,
              backgroundColor: c,
              opacity: step,
            }}
          />
        );
      })}
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
