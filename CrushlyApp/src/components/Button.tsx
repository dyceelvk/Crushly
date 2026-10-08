import React from 'react';
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { PressableScale } from './PressableScale';
import { Txt } from './Txt';
import { useTheme } from '../theme/ThemeProvider';
import { HIT, radius } from '../theme/tokens';
import { haptic } from '../lib/haptics';

export type ButtonVariant = 'primary' | 'crush' | 'secondary' | 'ghost' | 'danger' | 'outline';

type Props = {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: 'md' | 'lg' | 'sm';
  icon?: keyof typeof Ionicons.glyphMap;
  iconRight?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  full?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  leading?: React.ReactNode;
};

export function Button({
  title, onPress, variant = 'primary', size = 'lg', icon, iconRight, loading, disabled, full = true, style,
  accessibilityLabel, accessibilityHint, leading,
}: Props) {
  const { colors } = useTheme();
  const height = size === 'lg' ? 56 : size === 'md' ? 48 : 40;
  const fg = {
    primary: colors.onGold,
    crush: colors.onCrush,
    secondary: colors.text,
    ghost: colors.textSecondary,
    danger: colors.danger,
    outline: colors.text,
  }[variant];

  const content = (
    <View style={styles.row}>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {leading}
          {icon ? <Ionicons name={icon} size={size === 'sm' ? 16 : 19} color={fg} style={{ marginRight: 8 }} /> : null}
          <Txt variant={size === 'sm' ? 'smallStrong' : 'button'} color={fg} numberOfLines={1}>
            {title}
          </Txt>
          {iconRight ? <Ionicons name={iconRight} size={18} color={fg} style={{ marginLeft: 8 }} /> : null}
        </>
      )}
    </View>
  );

  const base: ViewStyle = {
    height,
    minHeight: HIT,
    borderRadius: radius.pill,
    paddingHorizontal: size === 'sm' ? 16 : 24,
    alignSelf: full ? 'stretch' : 'flex-start',
    overflow: 'hidden',
    justifyContent: 'center',
  };

  let surface: React.ReactNode;
  if (variant === 'primary') {
    surface = (
      <LinearGradient colors={[colors.goldBright, colors.gold, colors.goldDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[base, style]}>
        {content}
      </LinearGradient>
    );
  } else if (variant === 'crush') {
    surface = (
      <LinearGradient colors={[colors.crush, colors.crushDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[base, style]}>
        {content}
      </LinearGradient>
    );
  } else {
    const bg = { secondary: colors.elevated, ghost: 'transparent', danger: colors.dangerSoft, outline: 'transparent' }[variant];
    const border =
      variant === 'outline' ? { borderWidth: 1, borderColor: colors.borderStrong } : variant === 'secondary' ? { borderWidth: 1, borderColor: colors.border } : null;
    surface = <View style={[base, { backgroundColor: bg }, border, style]}>{content}</View>;
  }

  return (
    <PressableScale
      onPress={() => {
        if (variant === 'crush' || variant === 'primary') haptic.soft();
        onPress?.();
      }}
      disabled={disabled || loading}
      accessibilityLabel={accessibilityLabel || title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      style={full ? { alignSelf: 'stretch' } : { alignSelf: 'flex-start' }}
    >
      {surface}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});
