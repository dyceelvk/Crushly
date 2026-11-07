import React from 'react';
import { Image, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Txt } from './Txt';
import { useTheme } from '../theme/ThemeProvider';

// Official Crushly artwork supplied by the product owner. Keep these local so
// the brand is visible before the network has loaded and in native builds.
const markArtwork = require('../../assets/brand/crushly-mark.png');
const lockupArtwork = require('../../assets/brand/crushly-lockup-light.png');
const wordmarkOnDark = require('../../assets/brand/crushly-word-light.png');
const wordmarkOnLight = require('../../assets/brand/crushly-word-plum.png');

/**
 * Official Crushly mark: two overlapping conversation circles. The coloured
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

/** Official typography asset; switches to a plum treatment on light surfaces. */
export function Wordmark({ size = 28, color }: { size?: number; color?: string }) {
  const { colors } = useTheme();
  // Retain the optional colour API for any one-off contextual use, while the
  // standard app lockup always uses the supplied official lettering.
  if (color) {
    return (
      <Txt
        variant="display"
        accessibilityRole="header"
        style={{ fontSize: size, lineHeight: size * 1.2, letterSpacing: 2, textTransform: 'uppercase', color }}
      >
        Crushly
      </Txt>
    );
  }
  const source = colors.scheme === 'light' ? wordmarkOnLight : wordmarkOnDark;
  const height = size * 0.86;
  return <Image source={source} style={{ width: height * 5.61, height }} resizeMode="contain" accessibilityLabel="Crushly" accessibilityIgnoresInvertColors />;
}

export function Logo({ size = 40, stacked = false }: { size?: number; stacked?: boolean }) {
  if (stacked) {
    return (
      <View accessible accessibilityLabel="Crushly" style={{ alignItems: 'center', gap: size * 0.16 }}>
        <CrushlyMark size={size} />
        <Wordmark size={size * 0.62} />
      </View>
    );
  }
  const height = size * 1.04;
  return (
    <Image
      source={lockupArtwork}
      accessibilityLabel="Crushly"
      accessibilityIgnoresInvertColors
      resizeMode="contain"
      style={{ width: height * 4.72, height }}
    />
  );
}
