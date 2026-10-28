import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Linking, Platform, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { Logo } from '../../components/Logo';
import { useLayout } from '../../components/Layout';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';
import type { ScreenProps } from '../../navigation/types';

export function WelcomeScreen({ navigation }: ScreenProps<'Welcome'>) {
  const { colors, reduceMotion } = useTheme();
  const insets = useSafeAreaInsets();
  const { compact } = useLayout();
  const enter = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) return;
    Animated.timing(enter, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }).start();
  }, [enter, reduceMotion]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top, overflow: 'hidden' }}>
      <View style={{ alignItems: 'center', paddingTop: space.lg }}>
        <Logo size={30} />
      </View>

      <LinearGradient colors={['transparent', colors.bg]} style={{ height: 40, marginTop: -40 }} pointerEvents="none" />

      <View style={{ flex: 1, justifyContent: 'flex-end', paddingHorizontal: space.xl, paddingBottom: Math.max(insets.bottom, space.lg), maxWidth: 520, width: '100%', alignSelf: 'center' }}>
        <Animated.View style={{ opacity: enter }}>
          <Txt variant="hero" align="center" accessibilityRole="header" style={compact ? { fontSize: 32, lineHeight: 38 } : undefined}>
            Welcome to Crushly
          </Txt>
          <Txt variant="accent" color="textSecondary" align="center" style={{ marginTop: space.sm }}>
            Meet people. Make connections.{'\n'}Follow the feeling.
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
