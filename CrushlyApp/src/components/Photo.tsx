import React from 'react';
import { View, type StyleProp, type ImageStyle, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { mediaUrl } from '../api/client';
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
      source={{ uri: src }}
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
