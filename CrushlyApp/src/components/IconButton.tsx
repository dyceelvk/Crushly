import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PressableScale } from './PressableScale';
import { useTheme } from '../theme/ThemeProvider';
import { HIT } from '../theme/tokens';

type Props = {
  icon: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  /** Required: icon-only controls must be described for screen readers. */
  label: string;
  variant?: 'plain' | 'surface' | 'glass' | 'gold' | 'crush';
  size?: number;
  iconSize?: number;
  color?: string;
  badge?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
};

export function IconButton({ icon, onPress, label, variant = 'surface', size = HIT, iconSize, color, badge, disabled, style, children }: Props) {
  const { colors } = useTheme();
  const bg = {
    plain: 'transparent',
    surface: colors.card,
    glass: 'rgba(10,10,12,0.55)',
    gold: colors.goldSoft,
    crush: colors.crushSoft,
  }[variant];
  const fg = color || { plain: colors.text, surface: colors.text, glass: '#FFFFFF', gold: colors.gold, crush: colors.crush }[variant];
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      hitSlop={size < HIT ? (HIT - size) / 2 : undefined}
      pressedScale={0.92}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: bg,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: variant === 'surface' || variant === 'glass' ? 1 : 0,
          borderColor: variant === 'glass' ? 'rgba(255,255,255,0.14)' : colors.border,
        },
        style,
      ]}
    >
      {children ?? <Ionicons name={icon} size={iconSize ?? Math.round(size * 0.46)} color={fg} />}
      {badge ? (
        <View
          accessibilityElementsHidden
          style={{
            position: 'absolute', top: size * 0.2, right: size * 0.2, width: 9, height: 9, borderRadius: 5,
            backgroundColor: colors.crush, borderWidth: 2, borderColor: colors.card,
          }}
        />
      ) : null}
    </PressableScale>
  );
}
