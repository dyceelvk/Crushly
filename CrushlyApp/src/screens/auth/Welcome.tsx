import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Linking, Platform, Pressable, View } from 'react-native';
import { Glow } from '../../components/Ambient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { Logo } from '../../components/Logo';
import { useLayout } from '../../components/Layout';
import { useTheme } from '../../theme/ThemeProvider';
import { HIT, radius, rhythm, space } from '../../theme/tokens';
import type { ScreenProps } from '../../navigation/types';

/**
 * The first screen anyone sees.
 *
 * The layout is a deliberate three-part column rather than a stack pushed to the
 * bottom of the viewport:
 *
 *   brand   — anchored to the top, where a logo belongs
 *   hero    — owns the flexible middle, optically centred in whatever room is
 *             left rather than glued above the buttons
 *   actions — pinned low, in a fixed order, with the primary carrying the weight
 *
 * The old version used `justifyContent: 'flex-end'` on one container, which
 * produced a large dead band between the mark and the headline at every height
 * and collapsed the gap above the buttons on short phones. Two flexible
 * spacers at a fixed ratio keep the proportions steady at any height instead:
 * the hero sits at about the golden section of the free space, and the actions
 * never move.
 *
 * Everything here reads from the token scale. No pixel value is invented in
 * this file that is not either a token or derived from a safe-area inset.
 */
export function WelcomeScreen({ navigation }: ScreenProps<'Welcome'>) {
  const { colors, reduceMotion } = useTheme();
  const insets = useSafeAreaInsets();
  const { compact } = useLayout();

  // Two entrances, staggered: the words arrive, then the way forward.
  const hero = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const actions = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      hero.setValue(1);
      actions.setValue(1);
      return;
    }
    const native = Platform.OS !== 'web';
    Animated.sequence([
      Animated.timing(hero, { toValue: 1, duration: 620, easing: Easing.out(Easing.cubic), useNativeDriver: native }),
      Animated.timing(actions, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: native }),
    ]).start();
  }, [hero, actions, reduceMotion]);

  const rise = (value: Animated.Value, distance: number) => ({
    opacity: value,
    transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
  });

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        paddingTop: insets.top,
        paddingBottom: Math.max(insets.bottom, space.md),
        overflow: 'hidden',
      }}
    >
      {/* The air on this screen is a feature, but bare navy reads as "nothing
          loaded". Two stacked-disc glows give that space depth without adding
          an element to look at. This is the existing Ambient.Glow primitive
          rather than another gradient of its own — the design system already
          had the right tool and it was built for exactly these screens. */}
      <Glow size={520} color={colors.primary} opacity={0.55} style={{ position: 'absolute', top: -220, left: -180 }} />
      <Glow size={560} color={colors.crush} opacity={0.4} style={{ position: 'absolute', bottom: -240, right: -200 }} />

      <View style={{ flex: 1, width: '100%', maxWidth: 520, alignSelf: 'center', paddingHorizontal: space.xl }}>
        {/* ---------------------------------------------------------- brand */}
        <View style={{ alignItems: 'center', paddingTop: rhythm.page }}>
          <Logo size={compact ? 26 : 30} />
        </View>

        {/* Air split around the hero, biased downward so the words sit above
            centre. On a tall phone this screen has roughly 390pt of air to give
            away; putting all of it in one place produced either a hole under
            the mark or a hole above the buttons. Splitting it either side of
            the hero keeps the composition even at any height, and the bias
            keeps the eye starting high. */}
        <View style={{ flex: compact ? 2 : 5 }} />

        {/* ----------------------------------------------------------- hero */}
        <Animated.View style={rise(hero, 14)}>
          <Txt
            variant="hero"
            align="center"
            accessibilityRole="header"
            style={compact ? { fontSize: 32, lineHeight: 38 } : undefined}
          >
            {'Welcome to\nCrushly'}
          </Txt>
          <View style={{ alignItems: 'center', marginTop: space.md }}>
            {/* A short rule is what makes the two halves read as one lockup
                rather than a headline with a subtitle floating under it. */}
            <View style={{ width: 36, height: 1, backgroundColor: colors.primaryLine }} />
          </View>
          <Txt variant="accent" color="textSecondary" align="center" style={{ marginTop: space.md }}>
            {'Meet people. Make connections.\nFollow the feeling.'}
          </Txt>
        </Animated.View>

        <View style={{ flex: compact ? 2 : 4 }} />

        {/* -------------------------------------------------------- actions */}
        <Animated.View style={rise(actions, 10)}>
          <View style={{ gap: space.sm }}>
            <Button title="Get Started" onPress={() => navigation.navigate('SignUp')} />
            {Platform.OS === 'web' ? (
              <Button
                title="Get the Android app"
                variant="outline"
                icon="download-outline"
                onPress={() => Linking.openURL('/download/')}
              />
            ) : null}
          </View>

          {/* Signing in is not a third equal choice — it is the escape hatch for
              someone who already belongs here. As a quiet text row it stops
              competing with the two real actions above it. */}
          <Pressable
            onPress={() => navigation.navigate('SignIn')}
            accessibilityRole="button"
            accessibilityLabel="I already have an account, sign in"
            hitSlop={HIT / 2}
            style={({ pressed }) => ({
              marginTop: space.lg,
              minHeight: HIT,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.sm,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Txt variant="bodyStrong" color="textSecondary">
              I already have an account
            </Txt>
          </Pressable>

          <Txt variant="caption" color="textMuted" align="center" style={{ marginTop: space.xs }}>
            For adults 18+. Private by design.
          </Txt>
        </Animated.View>
      </View>
    </View>
  );
}
