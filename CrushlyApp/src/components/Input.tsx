import React, { forwardRef, useState } from 'react';
import { TextInput, View, type TextInputProps, type StyleProp, type ViewStyle, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Txt } from './Txt';
import { useTheme } from '../theme/ThemeProvider';
import { fonts, radius } from '../theme/tokens';

type Props = TextInputProps & {
  label?: string;
  hint?: string;
  error?: string | null;
  icon?: keyof typeof Ionicons.glyphMap;
  containerStyle?: StyleProp<ViewStyle>;
  showCount?: boolean;
};

export const Input = forwardRef<TextInput, Props>(function Input(
  { label, hint, error, icon, containerStyle, secureTextEntry, multiline, maxLength, showCount, value, style, onFocus, onBlur, ...rest },
  ref,
) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(!!secureTextEntry);
  const borderColor = error ? colors.danger : focused ? colors.goldLine : colors.border;

  return (
    <View style={[{ gap: 8, minWidth: 0 }, containerStyle]}>
      {label ? (
        <Txt variant="label" color="textSecondary" nativeID={`${label}-label`}>
          {label}
        </Txt>
      ) : null}
      <View
        style={{
          flexDirection: 'row', alignItems: multiline ? 'flex-start' : 'center', backgroundColor: colors.card, borderRadius: radius.md,
          borderWidth: 1, borderColor, paddingHorizontal: 16, minHeight: multiline ? 120 : 54, minWidth: 0,
        }}
      >
        {icon ? <Ionicons name={icon} size={18} color={colors.textMuted} style={{ marginRight: 10, marginTop: multiline ? 16 : 0 }} /> : null}
        <TextInput
          ref={ref}
          value={value}
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.gold}
          secureTextEntry={hidden}
          multiline={multiline}
          maxLength={maxLength}
          accessibilityLabel={label}
          accessibilityHint={error || hint}
          maxFontSizeMultiplier={1.4}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[
            {
              flex: 1, minWidth: 0, width: '100%', color: colors.text, fontFamily: fonts.medium, fontSize: 16, paddingVertical: multiline ? 14 : 0,
              minHeight: multiline ? 110 : 52, textAlignVertical: multiline ? 'top' : 'center',
            },
            // Removes the default browser focus ring; our border shows focus instead.
            { outlineStyle: 'none' } as object,
            style,
          ]}
          {...rest}
        />
        {secureTextEntry ? (
          <Pressable
            onPress={() => setHidden((h) => !h)}
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}
            hitSlop={12}
            style={{ padding: 4 }}
          >
            <Ionicons name={hidden ? 'eye-outline' : 'eye-off-outline'} size={20} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {error || hint || (showCount && maxLength) ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
          <Txt variant="small" color={error ? 'danger' : 'textMuted'} style={{ flex: 1 }} accessibilityLiveRegion={error ? 'polite' : 'none'}>
            {error ? `${error}` : hint}
          </Txt>
          {showCount && maxLength ? (
            <Txt variant="small" color="textMuted">
              {(value || '').length}/{maxLength}
            </Txt>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});
