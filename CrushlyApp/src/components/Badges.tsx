import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Txt } from './Txt';
import { useTheme } from '../theme/ThemeProvider';
import type { BadgeTier } from '../api/types';

/**
 * The seals.
 *
 * Three of them, and they mean three different things:
 *
 *   verified  the ordinary badge — identity confirmed, nothing bought;
 *   gold      earned. A member who gives Crushly something worth having;
 *   diamond   the company's own account. Never a person, never awarded.
 *
 * Same silhouette for all three so a badge is a badge at a glance, and a
 * different material for each so nobody has to read a tooltip to tell them
 * apart: a scalloped rosette in the palette's cyan, the same rosette in struck
 * gold, and a cut diamond.
 */
const GOLD = '#F2C14E';
const GOLD_DEEP = '#C79A2E';
const DIAMOND = '#8FE3FF';
const DIAMOND_DEEP = '#3FA8D8';

const TIER_LABEL: Record<BadgeTier, string> = {
  none: '',
  verified: 'Verified',
  gold: 'Gold — earned on Crushly',
  diamond: 'Crushly company account',
};

export function VerifiedBadge({
  size = 18,
  tier = 'verified',
  style,
}: {
  size?: number;
  tier?: BadgeTier;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  if (tier === 'none') return null;

  if (tier === 'diamond') {
    return (
      <View accessible accessibilityLabel={TIER_LABEL.diamond} accessibilityRole="image" style={style}>
        <Svg width={size} height={size} viewBox="0 0 24 24">
          {/* A brilliant cut: table, crown, pavilion, and two facets to say "cut". */}
          <Path d="M12 2.6l7.2 5.1 2.1 3.6L12 21.4 2.7 11.3l2.1-3.6z" fill={DIAMOND} />
          <Path d="M12 2.6l7.2 5.1H4.8z" fill="#E8FAFF" opacity={0.85} />
          <Path d="M12 21.4L12 7.7l7.2 0z" fill={DIAMOND_DEEP} opacity={0.45} />
          <Path d="M2.7 11.3h18.6L12 21.4z" fill={DIAMOND_DEEP} opacity={0.3} />
          <Path d="M12 2.6L4.8 7.7h14.4z" stroke="#FFFFFF" strokeWidth={0.6} fill="none" opacity={0.7} />
        </Svg>
      </View>
    );
  }

  const face = tier === 'gold' ? GOLD : colors.gold;
  const ink = tier === 'gold' ? GOLD_DEEP : colors.onGold;
  return (
    <View accessible accessibilityLabel={TIER_LABEL[tier]} accessibilityRole="image" style={style}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path
          d="M12 1.8l2.3 1.7 2.8-.3 1.2 2.6 2.6 1.2-.3 2.8 1.7 2.3-1.7 2.3.3 2.8-2.6 1.2-1.2 2.6-2.8-.3L12 22.2l-2.3-1.7-2.8.3-1.2-2.6-2.6-1.2.3-2.8L1.7 12l1.7-2.3-.3-2.8 2.6-1.2 1.2-2.6 2.8.3z"
          fill={face}
        />
        <Path d="M7.8 12.3l2.7 2.7 5.7-5.8" stroke={ink} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
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
