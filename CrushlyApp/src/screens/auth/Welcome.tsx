import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Linking, Platform, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { Logo } from '../../components/Logo';
import { Glow, LightSweep } from '../../components/Ambient';
import { useLayout } from '../../components/Layout';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';
import type { ScreenProps } from '../../navigation/types';

const PHOTOS = [require('../../../assets/welcome/ade.jpg'), require('../../../assets/welcome/marcus.jpg'), require('../../../assets/welcome/ryan.jpg')];

export function WelcomeScreen({ navigation }: ScreenProps<'Welcome'>) {
  const { colors, reduceMotion } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height, compact } = useLayout();
  const enter = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) return;
    Animated.timing(enter, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }).start();
  }, [enter, reduceMotion]);

  const cardW = Math.min(width * 0.42, 190);
  const stageH = Math.min(height * (compact ? 0.36 : 0.44), cardW * 1.9);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top, overflow: 'hidden' }}>
      <View style={{ alignItems: 'center', paddingTop: space.lg }}>
        <Logo size={30} />
      </View>

      {/* A fanned trio of portraits — editorial, not a swipe deck. */}
      <View style={{ height: stageH, alignItems: 'center', justifyContent: 'center', marginTop: space.md }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Glow size={stageH * 1.3} opacity={0.8} style={{ position: 'absolute' }} />
        {PHOTOS.map((src, i) => {
          const offset = (i - 1) * cardW * 0.62;
          const rotate = (i - 1) * 8;
          return (
            <Animated.View
              key={i}
              style={{
                position: 'absolute', width: cardW, height: cardW * 1.28, borderRadius: 24, overflow: 'hidden',
                borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', zIndex: i === 1 ? 2 : 1,
                shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: i === 1 ? 10 : 6,
                opacity: enter,
                transform: [
                  { translateX: enter.interpolate({ inputRange: [0, 1], outputRange: [0, offset] }) },
                  { translateY: i === 1 ? -10 : 14 },
                  { rotate: enter.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${rotate}deg`] }) },
                  { scale: i === 1 ? 1.06 : 0.94 },
                ],
              }}
            >
              <Image source={src} style={{ width: '100%', height: '100%' }} contentFit="cover" />
              {i !== 1 ? <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(7,7,8,0.35)' } as object} /> : null}
            </Animated.View>
          );
        })}
        <LightSweep duration={1600} loop />
      </View>

      <LinearGradient colors={['transparent', colors.bg]} style={{ height: 40, marginTop: -40 }} pointerEvents="none" />

      <View style={{ flex: 1, justifyContent: 'flex-end', paddingHorizontal: space.xl, paddingBottom: Math.max(insets.bottom, space.lg), maxWidth: 520, width: '100%', alignSelf: 'center' }}>
        <Animated.View style={{ opacity: enter }}>
          <Txt variant="hero" align="center" accessibilityRole="header" style={compact ? { fontSize: 32, lineHeight: 38 } : undefined}>
            Welcome to Crushly
          </Txt>
          <Txt variant="accent" color="textSecondary" align="center" style={{ marginTop: space.sm }}>
            Meet men. Make connections.{'\n'}Follow the feeling.
          </Txt>
        </Animated.View>
        <View style={{ gap: space.xs, marginTop: compact ? space.lg : space.xxl }}>
          <Button title="Get Started" onPress={() => navigation.navigate('SignUp')} />
          {Platform.OS === 'web' ? <Button title="Get the Android app" variant="ghost" icon="download-outline" onPress={() => Linking.openURL('/download/')} /> : null}
          <Button title="I already have an account" variant="ghost" onPress={() => navigation.navigate('SignIn')} />
        </View>
        <Txt variant="small" color="textMuted" align="center" style={{ marginTop: space.xs }}>
          For adults 18+. Private by design.
        </Txt>
      </View>
    </View>
  );
}
