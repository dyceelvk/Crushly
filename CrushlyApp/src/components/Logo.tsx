import React, { useId } from 'react';
import { View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { Txt } from './Txt';
import { useTheme } from '../theme/ThemeProvider';

/**
 * The Crushly mark: an abstract, dynamic "C" monogram with fluid ribbon
 * accents inside a dark rounded-square container. Gradient runs
 * cyan → electric purple → vibrant magenta. No heart / love symbol.
 */
export function CrushlyMark({ size = 48, mono }: { size?: number; mono?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const g = `g${uid}`;
  const pad = size * 0.14;
  const inner = size - pad * 2;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {/* Dark rounded-square container */}
      <Rect
        x={12}
        y={12}
        width={76}
        height={76}
        rx={18}
        fill={mono || '#0F142D'}
      />
      <Defs>
        <LinearGradient id={g} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#00C6FF" />
          <Stop offset="50%" stopColor="#A040FF" />
          <Stop offset="100%" stopColor="#FF4081" />
        </LinearGradient>
      </Defs>
      {/* Main C monogram — open, dynamic form */}
      <Path
        d="M 68 45 C 52 40, 38 42, 32 55 C 28 68, 30 78, 42 78"
        fill="none"
        stroke={mono || `url(#${g})`}
        strokeWidth={9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Fluid ribbon accent sweeping through the C */}
      <Path
        d="M 44 52 C 50 50, 58 52, 62 56"
        fill="none"
        stroke={mono || '#FFFFFF'}
        strokeWidth={4}
        strokeLinecap="round"
        opacity={0.6}
      />
    </Svg>
  );
}

/** Outline C-mark used as the Crush icon in controls (single color). */
export function CrushIcon({ size = 22, color, filled }: { size?: number; color: string; filled?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {filled ? (
        <Path
          d="M 68 45 C 52 40, 38 42, 32 55 C 28 68, 30 78, 42 78"
          fill={color}
        />
      ) : null}
      <Path
        d="M 68 45 C 52 40, 38 42, 32 55 C 28 68, 30 78, 42 78"
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
      style={{
        fontSize: size,
        lineHeight: size * 1.2,
        letterSpacing: 2,
        textTransform: 'uppercase',
        color: color || colors.text,
      }}
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
