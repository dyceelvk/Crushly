import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Photo } from './Photo';
import { Txt } from './Txt';
import { useTheme } from '../theme/ThemeProvider';
import { radius } from '../theme/tokens';
import { resolveTheme } from '../lib/circleThemes';

/**
 * The picture on a Circle.
 *
 * A Circle's cover is its theme until the owner puts a photograph on it — so a
 * room made five seconds ago already looks like a room, and the themes do the
 * job they were chosen for: making a list of Circles scannable.
 *
 * This one component is the only place that decides, which is why the cover now
 * appears on every surface that lists a Circle rather than on one of them. The
 * bug was never the art; it was that each list drew its own grey placeholder and
 * only checked for a photograph.
 */
export function CircleCover({
  circle,
  size = 44,
  radius: corner = radius.md,
  showLabel = false,
}: {
  circle: { name: string; coverUrl?: string | null; theme?: string | null };
  /** Height, and width when `ratio` is not given by the caller through style. */
  size?: number;
  radius?: number;
  /** Draw the theme's name over the picture (used on the big surfaces). */
  showLabel?: boolean;
}) {
  const { colors } = useTheme();
  const theme = resolveTheme(circle.theme);

  const body = circle.coverUrl ? (
    <Photo uri={circle.coverUrl} style={{ width: '100%', height: '100%' }} alt="" />
  ) : theme ? (
    <LinearGradient
      colors={theme.cover as [string, string]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
    >
      <Ionicons name={theme.icon as keyof typeof Ionicons.glyphMap} size={Math.max(14, size * 0.4)} color="rgba(255,255,255,0.9)" />
    </LinearGradient>
  ) : (
    <View style={{ width: '100%', height: '100%', backgroundColor: colors.elevated, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name="people-outline" size={Math.max(14, size * 0.4)} color={colors.textMuted} />
    </View>
  );

  return (
    <View style={{ width: size, height: size, borderRadius: corner, overflow: 'hidden' }}>
      {body}
      {showLabel && theme ? (
        <View style={{ position: 'absolute', left: 6, bottom: 5, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.45)' }}>
          <Txt variant="caption" style={{ color: '#fff', fontSize: 10 }}>
            {theme.label}
          </Txt>
        </View>
      ) : null}
    </View>
  );
}
