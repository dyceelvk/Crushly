import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import { Logo } from '../../components/Logo';
import { Glow, LightSweep } from '../../components/Ambient';
import { useTheme } from '../../theme/ThemeProvider';
import { palettes, fonts } from '../../theme/tokens';

/**
 * Cinematic but brief: the mark fades up through the brand's own light while a
 * single sweep passes. Shown only while the session restores.
 *
 * It uses the same two-colour glow and the same line as the Welcome screen, so
 * the first frame and the second frame are the same product — the splash used
 * to sit on a single cyan disc and say a different sentence from the screen it
 * handed off to.
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
    <View style={[StyleSheet.absoluteFill, { backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }]} accessibilityLabel="Holup. Follow the feelings.">
      <Glow size={460} color={c.primary} opacity={0.8} style={{ position: 'absolute' }} />
      <Glow size={380} color={c.crush} opacity={0.5} style={{ position: 'absolute', top: -140, right: -120 }} />
      <LightSweep duration={1300} />
      <Animated.View style={{ alignItems: 'center', opacity: fade, transform: [{ translateY: lift }] }}>
        <Logo size={78} color={c.text} />
        <Animated.Text
          style={{
            fontFamily: fontsReady ? fonts.medium : undefined, fontSize: 15, color: c.textSecondary, marginTop: 8, letterSpacing: 0.4,
            opacity: tagline,
          }}
        >
          Follow the feelings.
        </Animated.Text>
      </Animated.View>
    </View>
  );
}

/**
 * The canvas behind a session restore, kept from the feed work: a launch must not
 * begin with a screen you have to wait out, so this is the same light and the same
 * mark as the splash, held still and dim, for only as long as the stored session
 * takes to come back. No tagline, no sweep, no timing of its own.
 */
export function BootCanvas() {
  const c = palettes.dark;
  return (
    <View
      style={[StyleSheet.absoluteFill, { backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }]}
      accessibilityLabel="Holup"
    >
      <Glow size={520} color={c.primary} opacity={0.4} style={{ position: 'absolute' }} />
      <Glow size={520} color={c.crush} opacity={0.25} style={{ position: 'absolute', bottom: -280, right: -220 }} />
      <Logo size={72} color={c.text} />
    </View>
  );
}
