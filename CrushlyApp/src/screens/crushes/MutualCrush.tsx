import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { Avatar } from '../../components/Photo';
import { CrushlyMark } from '../../components/Logo';
import { Glow, Particles } from '../../components/Ambient';
import { useToast } from '../../components/Toast';
import { useMe, useOpenConversation } from '../../api/hooks';
import { useTheme } from '../../theme/ThemeProvider';
import { palettes, space } from '../../theme/tokens';
import { haptic } from '../../lib/haptics';
import type { ScreenProps } from '../../navigation/types';

/** Members whose Mutual Crush was celebrated on-screen this session (so we don't also toast it). */
export const celebrated = new Set<number>();

/** "It's a Crush." — a quiet celebration: soft glow, a few motes, two portraits leaning in. */
export function MutualCrushScreen({ navigation, route }: ScreenProps<'MutualCrush'>) {
  const { userId, name, photo } = route.params;
  const { reduceMotion } = useTheme();
  const c = palettes.dark;
  const insets = useSafeAreaInsets();
  const { data: me } = useMe();
  const open = useOpenConversation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const t = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const text = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    celebrated.add(userId);
    haptic.success();
    if (reduceMotion) return;
    const native = Platform.OS !== 'web';
    Animated.sequence([
      Animated.timing(t, { toValue: 1, duration: 650, easing: Easing.out(Easing.back(1.2)), useNativeDriver: native }),
      Animated.timing(text, { toValue: 1, duration: 380, useNativeDriver: native }),
    ]).start();
  }, [t, text, reduceMotion, userId]);

  const sayHello = async () => {
    setBusy(true);
    try {
      const conv = await open.mutateAsync(userId);
      navigation.replace('Chat', { conversationId: conv.id });
    } catch (e) {
      setBusy(false);
      toast({ kind: 'error', title: 'Couldn’t open your Whisper', message: (e as Error).message });
    }
  };

  const size = 132;
  return (
    <View
      style={{ flex: 1, backgroundColor: 'rgba(7,7,8,0.97)', alignItems: 'center', justifyContent: 'center', paddingTop: insets.top, paddingBottom: insets.bottom, overflow: 'hidden' }}
      accessibilityViewIsModal
    >
      <Glow size={560} color={c.crush} opacity={0.55} style={{ position: 'absolute' }} />
      <Glow size={380} color={c.gold} opacity={0.6} style={{ position: 'absolute' }} />
      <Particles />

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: size + 20 }} accessibilityElementsHidden>
        <Animated.View
          style={{
            transform: [
              { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [-60, 16] }) },
              { rotate: t.interpolate({ inputRange: [0, 1], outputRange: ['-14deg', '-6deg'] }) },
            ],
            opacity: t,
          }}
        >
          <Avatar uri={me?.profile.photos[0]?.url} name={me?.profile.name} size={size} ring="gold" />
        </Animated.View>
        <Animated.View
          style={{
            transform: [
              { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [60, -16] }) },
              { rotate: t.interpolate({ inputRange: [0, 1], outputRange: ['14deg', '6deg'] }) },
            ],
            opacity: t,
          }}
        >
          <Avatar uri={photo} name={name} size={size} ring="crush" />
        </Animated.View>
        <Animated.View
          style={{
            position: 'absolute', bottom: -8, width: 52, height: 52, borderRadius: 26, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center',
            borderWidth: 1, borderColor: c.goldLine, transform: [{ scale: t }],
          }}
        >
          <CrushlyMark size={30} />
        </Animated.View>
      </View>

      <Animated.View style={{ alignItems: 'center', marginTop: space.xxl, paddingHorizontal: space.xl, opacity: text, transform: [{ translateY: text.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}>
        <Txt variant="hero" color={c.text} align="center" accessibilityRole="header" accessibilityLabel={`It's a Mutual Crush with ${name}`}>
          It’s a Crush.
        </Txt>
        <Txt variant="accent" color={c.textSecondary} align="center" style={{ marginTop: space.xs }}>
          You and {name} both felt something.
        </Txt>
      </Animated.View>

      <View style={{ width: '100%', maxWidth: 420, paddingHorizontal: space.xl, marginTop: space.xxxl, gap: space.xs }}>
        <Button title="Say hello" variant="crush" onPress={sayHello} loading={busy} />
        <Button title="Keep discovering" variant="ghost" onPress={() => navigation.goBack()} />
      </View>
    </View>
  );
}
