import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Txt } from './Txt';
import { useTheme } from '../theme/ThemeProvider';
import { motion } from '../theme/tokens';

/**
 * The play/pause affordance.
 *
 * Before this there was nothing: `nativeControls` is off (deliberately — the
 * system controls are grey, they cover the caption, and they cannot be styled),
 * and no tap handler replaced them, so a video in the feed could not be paused at
 * all. A clip that is playing and a clip that has silently stopped looked
 * identical, which is the worst of both — the member cannot tell whether the app
 * is broken or the video simply ended.
 *
 * So: one control, two jobs.
 *
 * * Tap toggles playback.
 * * The state is *shown*: the disc flashes the new state and fades away while
 *   playing; while paused it stays, because a frozen frame with no explanation
 *   reads as a crash.
 *
 * The animation is a scale-and-fade rather than a sprite, so it costs one
 * animated value and works the same in the browser and on a phone.
 */

export function PlayPauseFlash({
  playing,
  onPress,
  reduced,
  compact = false,
  inline = false,
  label,
}: {
  playing: boolean;
  onPress: () => void;
  /** Reduce Motion: keep the state change, drop the movement. */
  reduced?: boolean;
  /** A tile or a small player: smaller disc, no word. */
  compact?: boolean;
  /**
   * A disc in the corner instead of a surface over the whole picture.
   *
   * The full-surface version is right in a player that owns the screen. It is
   * wrong in a feed card, where that surface is already the "open this post"
   * affordance: covering it meant a tap on a video toggled playback and the
   * poster could not be opened at all. Here the disc is the control and the rest
   * of the picture still belongs to whatever it sits inside.
   */
  inline?: boolean;
  label?: string;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(playing ? 0 : 1)).current;
  const first = useRef(true);

  useEffect(() => {
    // No flash on mount: a video that starts playing should not announce itself
    // with a pause icon before the first frame has even arrived.
    if (first.current) {
      first.current = false;
      opacity.setValue(playing ? 0 : 1);
      return;
    }

    const useNative = Platform.OS !== 'web';
    if (reduced) {
      opacity.setValue(playing ? 0 : 1);
      scale.setValue(1);
      return;
    }

    // Show, then settle. The disc reads as a press echo, not as a badge.
    scale.setValue(0.72);
    opacity.setValue(1);
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, speed: 22, bounciness: 6, useNativeDriver: useNative }),
      Animated.timing(opacity, {
        toValue: playing ? 0 : 1,
        duration: playing ? motion.slow : motion.fast,
        // A paused clip keeps the disc; a playing clip lets it go.
        delay: playing ? motion.base : 0,
        easing: Easing.out(Easing.quad),
        useNativeDriver: useNative,
      }),
    ]).start();
  }, [playing, reduced, opacity, scale]);

  const size = compact ? 44 : 68;

  /** A tap on the disc must not also reach the card underneath it. */
  const press = (e?: { stopPropagation?: () => void }) => {
    e?.stopPropagation?.();
    onPress();
  };

  if (inline) {
    const d = compact ? 38 : 44;
    return (
      <Pressable
        onPress={press}
        accessibilityRole="button"
        accessibilityLabel={label ?? (playing ? 'Pause video' : 'Play video')}
        accessibilityState={{ selected: playing }}
        hitSlop={10}
        style={({ pressed }) => ({
          position: 'absolute',
          right: 10,
          bottom: 10,
          width: d,
          height: d,
          borderRadius: d / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(10,10,12,0.55)',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.22)',
          opacity: pressed ? 0.75 : 1,
        })}
      >
        <Ionicons name={playing ? 'pause' : 'play'} size={compact ? 16 : 18} color="#FFFFFF" style={playing ? undefined : { marginLeft: 2 }} />
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label ?? (playing ? 'Pause video' : 'Play video')}
      accessibilityState={{ selected: playing }}
      // The whole surface is the target: people tap the picture, not a 44pt dot.
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
    >
      <View pointerEvents="none" style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View
          style={{
            opacity,
            transform: [{ scale }],
            width: size,
            height: size,
            borderRadius: size / 2,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(10,10,12,0.5)',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.22)',
          }}
        >
          <Ionicons
            name={playing ? 'pause' : 'play'}
            size={compact ? 20 : 30}
            color="#FFFFFF"
            // The play triangle is optically off-centre inside its glyph box;
            // nudging it right is the difference between "centred" and "looks
            // centred".
            style={playing ? undefined : { marginLeft: 3 }}
          />
        </Animated.View>

        {!compact && !playing ? (
          <Txt variant="caption" style={{ color: '#FFFFFF', marginTop: 10, opacity: 0.85 }}>
            Paused
          </Txt>
        ) : null}
      </View>
    </Pressable>
  );
}
