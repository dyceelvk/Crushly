import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PressableScale } from './PressableScale';
import { Txt } from './Txt';
import { Toggle } from './Toggle';
import { useTheme } from '../theme/ThemeProvider';
import { space } from '../theme/tokens';

type RowProps = {
  title: string;
  subtitle?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  iconTone?: 'gold' | 'crush' | 'neutral' | 'danger' | 'success';
  value?: string;
  onPress?: () => void;
  toggle?: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean };
  destructive?: boolean;
  trailing?: React.ReactNode;
  leading?: React.ReactNode;
  last?: boolean;
  accessibilityHint?: string;
};

export function ListRow({ title, subtitle, icon, iconTone = 'neutral', value, onPress, toggle, destructive, trailing, leading, last, accessibilityHint }: RowProps) {
  const { colors } = useTheme();
  const tone = {
    gold: [colors.goldSoft, colors.gold],
    crush: [colors.crushSoft, colors.crush],
    neutral: [colors.elevated, colors.textSecondary],
    danger: [colors.dangerSoft, colors.danger],
    success: [colors.successSoft, colors.success],
  }[destructive ? 'danger' : iconTone];

  const content = (
    <View
      style={{
        flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 14, minHeight: 56,
        borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border,
      }}
    >
      {leading}
      {icon ? (
        <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: tone[0], alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={icon} size={18} color={tone[1]} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Txt variant="subheading" color={destructive ? 'danger' : 'text'}>
          {title}
        </Txt>
        {subtitle ? (
          <Txt variant="small" color="textSecondary" style={{ marginTop: 2 }}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {value ? (
        <Txt variant="small" color="textMuted" numberOfLines={1} style={{ maxWidth: '40%' }}>
          {value}
        </Txt>
      ) : null}
      {trailing}
      {toggle ? <Toggle value={toggle.value} onChange={toggle.onChange} label={title} disabled={toggle.disabled} /> : null}
      {onPress && !toggle ? <Ionicons name="chevron-forward" size={18} color={colors.textMuted} /> : null}
    </View>
  );

  if (!onPress || toggle) return <View accessible={!toggle} accessibilityLabel={!toggle ? `${title}${value ? `, ${value}` : ''}` : undefined}>{content}</View>;
  return (
    <PressableScale onPress={onPress} pressedScale={0.99} accessibilityLabel={`${title}${value ? `, ${value}` : ''}`} accessibilityHint={accessibilityHint}>
      {content}
    </PressableScale>
  );
}

export function Group({ title, children, footer, style }: { title?: string; children: React.ReactNode; footer?: string; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View style={[{ marginBottom: space.xl }, style]}>
      {title ? (
        <Txt variant="label" color="textSecondary" style={{ marginBottom: space.xs, marginLeft: 4 }} accessibilityRole="header">
          {title}
        </Txt>
      ) : null}
      <View style={{ backgroundColor: colors.card, borderRadius: 20, borderWidth: 1, borderColor: colors.border, paddingHorizontal: space.md }}>
        {children}
      </View>
      {footer ? (
        <Txt variant="small" color="textMuted" style={{ marginTop: space.xs, marginHorizontal: 4 }}>
          {footer}
        </Txt>
      ) : null}
    </View>
  );
}
