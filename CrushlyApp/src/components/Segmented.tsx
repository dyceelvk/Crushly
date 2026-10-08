import React from 'react';
import { Pressable, View } from 'react-native';
import { Txt } from './Txt';
import { useTheme } from '../theme/ThemeProvider';
import { haptic } from '../lib/haptics';

type Option<T extends string> = { value: T; label: string; count?: number };

export function Segmented<T extends string>({ options, value, onChange }: { options: Option<T>[]; value: T; onChange: (v: T) => void }) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={{ flexDirection: 'row', backgroundColor: colors.card, borderRadius: 999, padding: 4, borderWidth: 1, borderColor: colors.border }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${o.label}${o.count != null ? `, ${o.count}` : ''}`}
            onPress={() => {
              haptic.tap();
              onChange(o.value);
            }}
            style={{
              flexGrow: 1, flexShrink: 1, flexBasis: 'auto', minHeight: 40, borderRadius: 999, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6,
              paddingHorizontal: 10, backgroundColor: active ? colors.elevated : 'transparent',
              borderWidth: active ? 1 : 0, borderColor: colors.goldLine,
            }}
          >
            <Txt variant="smallStrong" color={active ? 'text' : 'textSecondary'} numberOfLines={1} maxFontSizeMultiplier={1.25} style={{ flexShrink: 1 }}>
              {o.label}
            </Txt>
            {o.count ? (
              <Txt variant="caption" color={active ? 'gold' : 'textMuted'} maxFontSizeMultiplier={1.2}>
                {o.count}
              </Txt>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
