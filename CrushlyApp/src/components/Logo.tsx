import React from 'react';
import { Image, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Txt } from './Txt';
import { useTheme } from '../theme/ThemeProvider';

// Official holUpp artwork supplied by the product owner. Keep these local so
// the brand is visible before the network has loaded and in native builds.
const markArtwork = require('../../assets/brand/holup-mark.png');
/**
 * Official holUpp mark: two overlapping conversation circles. The coloured
 * image is used for the primary brand lockup; a single-colour SVG equivalent is
 * reserved for tiny interactive controls, where the surrounding UI supplies the
 * contrast colour.
 */
export function CrushlyMark({ size = 48, mono }: { size?: number; mono?: string }) {
  if (mono) {
    return (
      <Svg width={size} height={size} viewBox="0 0 100 80" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Circle cx="35" cy="40" r="28" fill={mono} />
        <Circle cx="63" cy="43" r="28" fill={mono} />
      </Svg>
    );
  }
  return <Image source={markArtwork} style={{ width: size, height: size }} resizeMode="contain" accessibilityIgnoresInvertColors />;
}

/** Small, one-colour version of the mark for reactions and navigation controls. */
export function CrushIcon({ size = 22, color, filled }: { size?: number; color: string; filled?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 80" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {filled ? (
        <>
          <Circle cx="35" cy="40" r="28" fill={color} />
          <Circle cx="63" cy="43" r="28" fill={color} opacity="0.86" />
        </>
      ) : (
        <>
          <Circle cx="35" cy="40" r="25" fill="none" stroke={color} strokeWidth="8" />
          <Circle cx="63" cy="43" r="25" fill="none" stroke={color} strokeWidth="8" />
        </>
      )}
    </Svg>
  );
}

/** A locally rendered wordmark: no old-name artwork or network needed. */
export function Wordmark({ size = 28, color }: { size?: number; color?: string }) {
  const { colors } = useTheme();
  return <Txt variant="display" accessibilityRole="header" style={{
    fontSize: size, lineHeight: size * 1.22, letterSpacing: 0.6, fontFamily: 'Manrope_800ExtraBold',
    // No textTransform: the name is holUpp, and upper-casing it would flatten
    // the only part of it that is not a plain word.
    color: color ?? colors.text,
  }}>holUpp</Txt>;
}

export function Logo({ size = 40, stacked = false, color }: { size?: number; stacked?: boolean; color?: string }) {
  return <View accessible accessibilityLabel="holUpp" style={{ flexDirection: stacked ? 'column' : 'row', alignItems: 'center', gap: stacked ? size * 0.16 : size * 0.16 }}>
    <CrushlyMark size={size} />
    <Wordmark size={size * 0.62} color={color} />
  </View>;
}
