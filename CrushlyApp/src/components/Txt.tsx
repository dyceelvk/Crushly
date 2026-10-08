import React from 'react';
import { Text, type TextProps, type TextStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { type as typeScale, type TypeVariant, type Palette } from '../theme/tokens';

type ColorKey = 'text' | 'textSecondary' | 'textMuted' | 'gold' | 'crush' | 'success' | 'danger' | 'onGold' | 'onCrush';

export type TxtProps = TextProps & {
  variant?: TypeVariant;
  color?: ColorKey | (string & {});
  align?: TextStyle['textAlign'];
};

/** Themed text. Respects Dynamic Type, capped so layouts stay intact. */
export function Txt({ variant = 'body', color = 'text', align, style, maxFontSizeMultiplier = 1.5, ...rest }: TxtProps) {
  const { colors } = useTheme();
  const resolved = (colors as Record<string, unknown>)[color] as string | undefined;
  return (
    <Text
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[typeScale[variant], { color: resolved ?? color }, align ? { textAlign: align } : null, style]}
      {...rest}
    />
  );
}

export type { Palette };
