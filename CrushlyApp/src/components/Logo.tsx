import React, { useId } from 'react';
import { View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { Txt } from './Txt';
import { useTheme } from '../theme/ThemeProvider';

/**
 * The Crushly mark: a gold "C" that sweeps into a crimson arc — two opposing
 * shapes meeting to form a heart. Works on its own as the app icon.
 */
export function CrushlyMark({ size = 48, mono }: { size?: number; mono?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const g = `g${uid}`;
  const r = `r${uid}`;
  const stroke = 8.5;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Defs>
        <LinearGradient id={g} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#F3DDA6" />
          <Stop offset="1" stopColor="#B8893E" />
        </LinearGradient>
        <LinearGradient id={r} x1="1" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FF7A93" />
          <Stop offset="1" stopColor="#E0284F" />
        </LinearGradient>
      </Defs>
      <Path
        d="M62 22 C 56 14, 48 11, 39 11 C 22 11, 10 23, 10 39 C 10 58, 30 72, 50 86"
        fill="none"
        stroke={mono || `url(#${g})`}
        strokeWidth={stroke}
        strokeLinecap="round"
      />
      <Path
        d="M50 86 C 70 72, 90 58, 90 39 C 90 25, 81 15, 69 15 C 60 15, 54 21, 50 28"
        fill="none"
        stroke={mono || `url(#${r})`}
        strokeWidth={stroke}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Outline heart-mark used as the Crush icon in controls (single color). */
export function CrushIcon({ size = 22, color, filled }: { size?: number; color: string; filled?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {filled ? (
        <Path
          d="M50 88 C 26 70, 8 56, 8 37 C 8 22, 20 11, 35 11 C 42 11, 47 14, 50 19 C 53 14, 58 11, 65 11 C 80 11, 92 22, 92 37 C 92 56, 74 70, 50 88 Z"
          fill={color}
        />
      ) : null}
      <Path
        d="M62 22 C 56 14, 48 11, 39 11 C 22 11, 10 23, 10 39 C 10 58, 30 72, 50 86"
        fill="none"
        stroke={filled ? 'transparent' : color}
        strokeWidth={10}
        strokeLinecap="round"
      />
      <Path
        d="M50 86 C 70 72, 90 58, 90 39 C 90 25, 81 15, 69 15 C 60 15, 54 21, 50 28"
        fill="none"
        stroke={filled ? 'transparent' : color}
        strokeWidth={10}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function Wordmark({ size = 28, color }: { size?: number; color?: string }) {
  const { colors } = useTheme();
  return (
    <Txt
      variant="display"
      accessibilityRole="header"
      style={{ fontSize: size, lineHeight: size * 1.2, letterSpacing: -0.3, color: color || colors.text }}
    >
      Crushly
    </Txt>
  );
}

export function Logo({ size = 40, stacked = false }: { size?: number; stacked?: boolean }) {
  return (
    <View
      accessible
      accessibilityLabel="Crushly"
      style={{ flexDirection: stacked ? 'column' : 'row', alignItems: 'center', gap: stacked ? size * 0.25 : size * 0.22 }}
    >
      <CrushlyMark size={size} />
      <Wordmark size={stacked ? size * 0.62 : size * 0.68} />
    </View>
  );
}
