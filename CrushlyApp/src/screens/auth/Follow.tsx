import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Glow, LightSweep } from '../../components/Ambient';
import { Txt } from '../../components/Txt';
import { useTheme } from '../../theme/ThemeProvider';
import { fonts, palettes, space } from '../../theme/tokens';
import type { ScreenProps } from '../../navigation/types';

/**
 * The first thing anyone sees: a sentence, and a screen to touch.
 *
 * This replaces the logo splash as the opening surface. A splash with a mark on
 * it is a loading screen pretending to be a welcome — it asks you to look at the
 * brand before it has told you anything. So the app opens on the one line the
 * product is actually about, and the welcome screen (with the mark, the sign-in
 * and the sign-up) is one deliberate tap later. The mark has not been removed
 * from the product; it has been moved to where it means something.
 *
 * The whole screen is the target, not a button in the corner: at this point
 * there is nothing else to do, so there is nothing to get wrong.
 */
export function FollowScreen({ navigation }: ScreenProps<'Follow'>) {
  const insets = useSafeAreaInsets();
  const { reduceMotion } = useTheme();
  const noir = palettes.dark; // always noir — this screen is the brand, not a preference
  const native = Platform.OS !== 'web';

  const words = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const cue = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const breathe = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) return;
    Animated.sequence([
      Animated.timing(words, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: native }),
      Animated.timing(cue, { toValue: 1, duration: 480, easing: Easing.out(Easing.cubic), useNativeDriver: native }),
    ]).start();

    // The cue does not blink at you. It breathes, the way a held breath does.
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: native }),
        Animated.timing(breathe, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: native }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [words, cue, breathe, reduceMotion, native]);

  const open = () => navigation.replace('Welcome');

  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel="Follow the feelings. Tap to begin."
      style={[StyleSheet.absoluteFill, { backgroundColor: noir.bg, overflow: 'hidden' }]}
    >
      <Glow size={620} color={noir.primary} opacity={0.5} style={{ position: 'absolute', top: -300, left: -240 }} />
      <Glow size={640} color={noir.crush} opacity={0.34} style={{ position: 'absolute', bottom: -320, right: -260 }} />
      <LightSweep duration={2400} />

      <View
        style={{
          flex: 1,
          paddingTop: insets.top + space.xxxl,
          paddingBottom: Math.max(insets.bottom, space.lg) + space.xl,
          paddingHorizontal: space.xl,
          justifyContent: 'space-between',
        }}
      >
        <Animated.Text
          style={{
            fontFamily: fonts.bold,
            fontSize: 11,
            letterSpacing: 3.2,
            color: noir.textMuted ?? noir.textSecondary,
            textTransform: 'uppercase',
            opacity: words,
          }}
        >
          Crushly
        </Animated.Text>

        <Animated.View
          style={{
            opacity: words,
            transform: [{ translateY: words.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }],
          }}
        >
          <Animated.Text
            accessibilityRole="header"
            style={{
              fontFamily: fonts.display,
              fontSize: 54,
              lineHeight: 60,
              letterSpacing: -1.4,
              color: noir.text,
            }}
          >
            Follow{'\n'}the{'\n'}
            <Animated.Text style={{ fontFamily: fonts.displayItalic ?? fonts.display, color: noir.primary }}>feelings.</Animated.Text>
          </Animated.Text>

          {/* No animated value in here. `Txt` renders a plain Text, and an
              Animated.Value in a non-animated style is a hard crash on Android
              release builds — it took the app down on cold start. The paragraph
              fades with the block above it instead, which is the same picture. */}
          <Txt
            variant="body"
            style={{
              marginTop: space.lg,
              maxWidth: 300,
              fontFamily: fonts.regular,
              fontSize: 15,
              lineHeight: 22,
              color: noir.textSecondary,
            }}
          >
            Not the follower count. Not the algorithm&rsquo;s opinion. What the room is actually feeling, one post at a time.
          </Txt>
        </Animated.View>

        <Animated.View
          style={{
            opacity: Animated.multiply(cue, breathe.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] })),
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <View
            style={{
              width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
              backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
            }}
          >
            <Ionicons name="arrow-forward" size={19} color={noir.text} />
          </View>
          <Txt style={{ fontFamily: fonts.medium, fontSize: 13, letterSpacing: 0.3, color: noir.textSecondary }}>
            Tap anywhere to begin
          </Txt>
        </Animated.View>
      </View>
    </Pressable>
  );
}
