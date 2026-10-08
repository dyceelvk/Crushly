import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PressableScale } from './PressableScale';
import { Txt } from './Txt';
import { useTheme } from '../theme/ThemeProvider';
import { radius } from '../theme/tokens';
import { haptic } from '../lib/haptics';

type ChipProps = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  tone?: 'default' | 'gold' | 'crush';
  size?: 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
};

/**
 * Selectable or static tag. Selected state is conveyed by a checkmark and
 * border, not color alone.
 */
export function Chip({ label, selected, onPress, icon, tone = 'default', size = 'md', style, disabled }: ChipProps) {
  const { colors } = useTheme();
  const accent = tone === 'crush' ? colors.crush : colors.gold;
  const active = selected || tone !== 'default';
  const bg = selected ? (tone === 'crush' ? colors.crushSoft : colors.goldSoft) : tone === 'gold' ? colors.goldSoft : tone === 'crush' ? colors.crushSoft : colors.card;
  const border = selected ? accent : active ? 'transparent' : colors.border;
  const fg = active ? (tone === 'crush' ? colors.crush : selected || tone === 'gold' ? colors.gold : colors.text) : colors.text;
  const body = (
    <View
      style={[
        {
          flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: border,
          backgroundColor: bg, paddingHorizontal: size === 'sm' ? 10 : 14, minHeight: size === 'sm' ? 28 : 40,
        },
        style,
      ]}
    >
      {selected ? <Ionicons name="checkmark" size={15} color={accent} /> : icon ? <Ionicons name={icon} size={14} color={fg} /> : null}
      <Txt variant={size === 'sm' ? 'caption' : 'smallStrong'} color={fg}>
        {label}
      </Txt>
    </View>
  );
  if (!onPress) return <View accessible accessibilityLabel={label}>{body}</View>;
  return (
    <PressableScale
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: !!selected, disabled }}
      accessibilityLabel={label}
      hitSlop={size === 'sm' ? 8 : 2}
      pressedScale={0.95}
    >
      {body}
    </PressableScale>
  );
}

export function ChipGroup({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, style]}>{children}</View>;
}
