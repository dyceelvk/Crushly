import React, { useId } from 'react';
import { View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { Txt } from './Txt';
import { useTheme } from '../theme/ThemeProvider';

/**
 * The Crushly mark: a single continuous fluid ribbon forming an abstract
 * dynamic "C" inside a dark rounded-square container.
 *
 * Gradient flows along the ribbon: cyan (#00C6FF) → purple (#A040FF) → magenta (#FF4081).
 * No heart / love symbol — pure connection.
 */
export function CrushlyMark({ size = 48, mono }: { size?: number; mono?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const g = `g${uid}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {/* Dark rounded-square container (matches logo design) */}
      <Rect
        x={12}
        y={12}
        width={76}
        height={76}
        rx={18}
        fill={mono || '#0A0E27'}
      />
      <Defs>
        <LinearGradient id={g} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#00C6FF" />
          <Stop offset="45%" stopColor="#A040FF" />
          <Stop offset="100%" stopColor="#FF4081" />
        </LinearGradient>
      </Defs>
      {/* Single continuous C ribbon — thick, open on the right side */}
      <Path
        d="M 66 42 C 52 36, 38 36, 30 52 C 28 66, 32 74, 42 74 C 52 74, 60 66, 62 58"
        fill="none"
        stroke={mono || `url(#${g})`}
        strokeWidth={16}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Self-overlap stripe where the ribbon crosses itself */}
      <Path
        d="M 42 46 L 56 56"
        fill="none"
        stroke={mono || '#0A0E27'}
        strokeWidth={10}
        strokeLinecap="round"
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
          d="M 66 42 C 52 36, 38 36, 30 52 C 28 66, 32 74, 42 74 C 52 74, 60 66, 62 58"
          fill={color}
        />
      ) : null}
      <Path
        d="M 66 42 C 52 36, 38 36, 30 52 C 28 66, 32 74, 42 74 C 52 74, 60 66, 62 58"
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
