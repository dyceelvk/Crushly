import React, { useState } from 'react';
import { View, type StyleProp, type ImageStyle, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { mediaUrl } from '../api/client';
import { mediaSource } from '../lib/mediaHost';
import { useTheme } from '../theme/ThemeProvider';
import { Txt } from './Txt';

type PhotoProps = {
  uri?: string | null;
  style?: StyleProp<ImageStyle>;
  /** Decorative photos are hidden from screen readers. */
  alt?: string;
  priority?: 'low' | 'normal' | 'high';
  contentPosition?: 'top' | 'center';
  fit?: 'cover' | 'contain';
  /**
   * Width ÷ height to reserve *before* the file has loaded, so the page does not
   * jump when it arrives. Omit it wherever the caller already sets an explicit
   * width and height (avatars, tiles).
   */
  aspectRatio?: number;
  /** Ceiling for the height, so one tall photo cannot own the whole screen. */
  maxHeight?: number;
  /**
   * The file's real shape, once known. A feed should not crop someone's photo to
   * a ratio we invented, so callers hold the measured value and pass it back as
   * `aspectRatio` on the next render.
   */
  onAspect?: (ratio: number) => void;
};

/**
 * Cached, fading image. expo-image handles memory + disk caching and
 * downsampling, which keeps grids smooth on low-end Android devices.
 */
export function Photo({
  uri, style, alt, priority = 'normal', contentPosition = 'top', fit = 'cover', aspectRatio, maxHeight, onAspect,
}: PhotoProps) {
  const { colors } = useTheme();
  const src = mediaUrl(uri);
  const [measured, setMeasured] = useState(aspectRatio ?? null);
  const [width, setWidth] = useState(0);

  if (!src) {
    return (
      <View style={[{ backgroundColor: colors.elevated, alignItems: 'center', justifyContent: 'center' }, style as StyleProp<ViewStyle>]}>
        <Ionicons name="person" size={28} color={colors.textMuted} />
      </View>
    );
  }

  /**
   * An image with a width but no height collapses to nothing on the web, and that
   * is exactly what was happening to every photo in the feed: <img> was in the
   * DOM with the right width, the right natural size and a computed height of
   * zero, so posts rendered as text with a hole under them.
   *
   * With `aspectRatio` in play the caller has also promised two things: the
   * space is reserved before the file arrives (no layout jump), and the height
   * is derived from the real width once it is measured, capped by `maxHeight`.
   * When the file reports its own shape we switch to that, so a portrait photo
   * stays portrait and nothing gets cropped to a ratio we invented.
   */
  const sized: ViewStyle | null = measured
    ? { height: Math.min(width / measured, maxHeight ?? Infinity) }
    : aspectRatio
      ? { aspectRatio }
      : null;

  return (
    <Image
      source={mediaSource(src)}
      style={[{ backgroundColor: colors.skeleton }, sized as StyleProp<ImageStyle>, style]}
      contentFit={fit}
      contentPosition={contentPosition}
      transition={220}
      cachePolicy="memory-disk"
      priority={priority}
      recyclingKey={src}
      accessible={!!alt}
      accessibilityLabel={alt}
      accessibilityIgnoresInvertColors
      onLayout={aspectRatio ? (e) => setWidth(e.nativeEvent.layout.width) : undefined}
      onLoad={
        aspectRatio && onAspect
          ? (e) => {
              const { width: w, height: h } = e.source ?? {};
              if (w && h) onAspect(w / h);
            }
          : undefined
      }
    />
  );
}

type AvatarProps = {
  uri?: string | null;
  name?: string;
  size?: number;
  online?: boolean | null;
  shape?: 'circle' | 'squircle';
  ring?: 'gold' | 'muted' | 'crush' | null;
  style?: StyleProp<ViewStyle>;
};

export function Avatar({ uri, name, size = 48, online, shape = 'circle', ring, style }: AvatarProps) {
  const { colors } = useTheme();
  const r = shape === 'circle' ? size / 2 : size * 0.32;
  const ringColor = ring === 'gold' ? colors.gold : ring === 'crush' ? colors.crush : ring === 'muted' ? colors.borderStrong : null;
  const inset = ringColor ? 3 : 0;
  const inner = size - inset * 2 - (ringColor ? 2 : 0);
  return (
    <View
      style={[
        { width: size, height: size, borderRadius: r, alignItems: 'center', justifyContent: 'center' },
        ringColor ? { borderWidth: 1.5, borderColor: ringColor } : null,
        style,
      ]}
    >
      {uri ? (
        <Photo uri={uri} style={{ width: inner, height: inner, borderRadius: shape === 'circle' ? inner / 2 : inner * 0.3 }} priority="low" />
      ) : (
        <View
          style={{
            width: inner, height: inner, borderRadius: shape === 'circle' ? inner / 2 : inner * 0.3,
            backgroundColor: colors.elevated, alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Txt variant="bodyStrong" color="textSecondary" style={{ fontSize: Math.max(12, inner * 0.36) }}>
            {(name || '?').slice(0, 1).toUpperCase()}
          </Txt>
        </View>
      )}
      {online ? <OnlineDot size={Math.max(10, size * 0.22)} style={{ position: 'absolute', right: shape === 'circle' ? size * 0.02 : -2, bottom: shape === 'circle' ? size * 0.02 : -2 }} /> : null}
    </View>
  );
}

export function OnlineDot({ size = 10, style }: { size?: number; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityLabel="Online"
      style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.success, borderWidth: 2, borderColor: colors.bg }, style]}
    />
  );
}
