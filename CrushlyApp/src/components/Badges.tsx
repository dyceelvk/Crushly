import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Txt } from './Txt';
import { useTheme } from '../theme/ThemeProvider';

/**
 * Verified seal: a small scalloped gold rosette with a check. Deliberately
 * understated so it reads as trust, not as a paid badge.
 */
export function VerifiedBadge({ size = 18, style }: { size?: number; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View accessible accessibilityLabel="Verified" accessibilityRole="image" style={style}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path
          d="M12 1.8l2.3 1.7 2.8-.3 1.2 2.6 2.6 1.2-.3 2.8 1.7 2.3-1.7 2.3.3 2.8-2.6 1.2-1.2 2.6-2.8-.3L12 22.2l-2.3-1.7-2.8.3-1.2-2.6-2.6-1.2.3-2.8L1.7 12l1.7-2.3-.3-2.8 2.6-1.2 1.2-2.6 2.8.3z"
          fill={colors.gold}
        />
        <Path d="M7.8 12.3l2.7 2.7 5.7-5.8" stroke={colors.onGold} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </View>
  );
}

export function CountBadge({ count, style }: { count: number; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  if (!count) return null;
  return (
    <View
      accessibilityLabel={`${count} unread`}
      style={[
        {
          minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, backgroundColor: colors.crush,
          alignItems: 'center', justifyContent: 'center',
        },
        style,
      ]}
    >
      <Txt variant="caption" color="onCrush" style={{ fontSize: 11, lineHeight: 14 }} maxFontSizeMultiplier={1.2}>
        {count > 99 ? '99+' : count}
      </Txt>
    </View>
  );
}

export function Pill({
  label, tone = 'neutral', icon, style,
}: { label: string; tone?: 'neutral' | 'gold' | 'crush' | 'success' | 'glass'; icon?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const map = {
    neutral: [colors.elevated, colors.textSecondary],
    gold: [colors.goldSoft, colors.gold],
    crush: [colors.crushSoft, colors.crush],
    success: [colors.successSoft, colors.success],
    glass: ['rgba(10,10,12,0.55)', '#FFFFFF'],
  }[tone];
  return (
    <View
      style={[
        {
          flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: map[0],
          borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
        },
        tone === 'glass' ? { borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' } : null,
        style,
      ]}
    >
      {icon}
      <Txt variant="caption" color={map[1]}>
        {label}
      </Txt>
    </View>
  );
}
