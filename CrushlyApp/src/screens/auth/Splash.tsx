import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import { CrushlyMark } from '../../components/Logo';
import { Glow, LightSweep } from '../../components/Ambient';
import { useTheme } from '../../theme/ThemeProvider';
import { palettes, fonts } from '../../theme/tokens';

/**
 * Cinematic but brief: the mark fades up through a champagne glow while a
 * single light sweep passes. Shown only while the session restores.
 */
export function SplashScreen({ fontsReady }: { fontsReady: boolean }) {
  const { reduceMotion } = useTheme();
  const c = palettes.dark; // the splash is always noir, matching the native splash
  const fade = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const lift = useRef(new Animated.Value(reduceMotion ? 0 : 10)).current;
  const tagline = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) return;
    const native = Platform.OS !== 'web';
    Animated.sequence([
      Animated.parallel([
        Animated.timing(fade, { toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: native }),
        Animated.timing(lift, { toValue: 0, duration: 620, easing: Easing.out(Easing.cubic), useNativeDriver: native }),
      ]),
      Animated.timing(tagline, { toValue: 1, duration: 360, useNativeDriver: native }),
    ]).start();
  }, [fade, lift, tagline, reduceMotion]);

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }]} accessibilityLabel="Crushly. Find your connection.">
      <Glow size={460} color={c.gold} opacity={0.9} style={{ position: 'absolute' }} />
      <LightSweep duration={1300} />
      <Animated.View style={{ alignItems: 'center', opacity: fade, transform: [{ translateY: lift }] }}>
        <CrushlyMark size={92} />
        {fontsReady ? (
          <Animated.Text style={{ fontFamily: fonts.display, fontSize: 40, color: c.text, marginTop: 18, letterSpacing: -0.4 }}>Crushly</Animated.Text>
        ) : (
          <View style={{ height: 66 }} />
        )}
        <Animated.Text
          style={{
            fontFamily: fontsReady ? fonts.medium : undefined, fontSize: 15, color: c.textSecondary, marginTop: 8, letterSpacing: 0.4,
            opacity: tagline,
          }}
        >
          Find your connection.
        </Animated.Text>
      </Animated.View>
    </View>
  );
}
