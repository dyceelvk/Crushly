import React from 'react';
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
};

/**
 * Cached, fading image. expo-image handles memory + disk caching and
 * downsampling, which keeps grids smooth on low-end Android devices.
 */
export function Photo({ uri, style, alt, priority = 'normal', contentPosition = 'top', fit = 'cover' }: PhotoProps) {
  const { colors } = useTheme();
  const src = mediaUrl(uri);
  if (!src) {
    return (
      <View style={[{ backgroundColor: colors.elevated, alignItems: 'center', justifyContent: 'center' }, style as StyleProp<ViewStyle>]}>
        <Ionicons name="person" size={28} color={colors.textMuted} />
      </View>
    );
  }
  return (
    <Image
      source={mediaSource(src)}
      style={[{ backgroundColor: colors.skeleton }, style]}
      contentFit={fit}
      contentPosition={contentPosition}
      transition={220}
      cachePolicy="memory-disk"
      priority={priority}
      recyclingKey={src}
      accessible={!!alt}
      accessibilityLabel={alt}
      accessibilityIgnoresInvertColors
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
  /**
   * Draw the Moment ring: a blue band around the photo that means "there is a
   * Moment here right now".
   *
   * It is a band rather than a border for a reason. The existing `ring` is a
   * 1.5px border competing for the same pixels, so a member who is verified
   * *and* has a Moment cannot show both with one border — an outer band leaves
   * the border's job alone and both facts survive.
   *
   * The band is drawn only when true. `undefined` and `false` are both "no
   * ring": the flag comes from the server, and treating "not asked" as "ring
   * them" would put a blue circle around every face in the app.
   */
  ringMoment?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** The blue of the Moments ring, in both palettes. */
const MOMENT_RING = '#2E9BFF';

export function Avatar({ uri, name, size = 48, online, shape = 'circle', ring, ringMoment, style }: AvatarProps) {
  const { colors } = useTheme();
  const r = shape === 'circle' ? size / 2 : size * 0.32;
  const ringColor = ring === 'gold' ? colors.gold : ring === 'crush' ? colors.crush : ring === 'muted' ? colors.borderStrong : null;
  const inset = ringColor ? 3 : 0;
  const inner = size - inset * 2 - (ringColor ? 2 : 0);
  // The band takes room from the outside, never from the face: the photo keeps
  // the size it was given and the whole avatar grows by the band's width.
  const band = ringMoment ? Math.max(2, Math.round(size * 0.05)) : 0;
  const box = size + band * 2;
  return (
    <View
      style={[
        { width: box, height: box, borderRadius: r + band, alignItems: 'center', justifyContent: 'center' },
        band ? { borderWidth: band, borderColor: MOMENT_RING } : null,
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
      {online ? <OnlineDot size={Math.max(10, size * 0.22)} style={{ position: 'absolute', right: band + (shape === 'circle' ? size * 0.02 : -2), bottom: band + (shape === 'circle' ? size * 0.02 : -2) }} /> : null}
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
