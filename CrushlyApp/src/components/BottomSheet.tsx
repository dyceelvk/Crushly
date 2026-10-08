import React, { useEffect, useRef, useState } from 'react';
import { Animated, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from './Txt';
import { Button } from './Button';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';

type Props = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Max height as a fraction of the window. */
  maxHeight?: number;
};

/**
 * Glassy bottom sheet with a dimmed backdrop. Keyboard-aware, scrollable,
 * closes on backdrop tap / Android back, and centers as a card on tablets.
 */
export function BottomSheet({ visible, onClose, title, subtitle, children, footer, maxHeight = 0.88 }: Props) {
  const { colors, reduceMotion } = useTheme();
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  const y = useRef(new Animated.Value(1)).current;
  const native = Platform.OS !== 'web';

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(y, { toValue: 0, duration: reduceMotion ? 0 : 260, useNativeDriver: native }).start();
    } else if (mounted) {
      Animated.timing(y, { toValue: 1, duration: reduceMotion ? 0 : 200, useNativeDriver: native }).start(() => setMounted(false));
    }
  }, [visible, mounted, y, reduceMotion, native]);

  if (!mounted) return null;
  const wide = width >= 700;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Animated.View style={{ flex: 1, backgroundColor: colors.scrim, opacity: y.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }}>
          <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          style={{
            position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center',
            transform: [{ translateY: y.interpolate({ inputRange: [0, 1], outputRange: [0, height * 0.6] }) }],
          }}
        >
          <View
            style={{
              width: '100%', maxWidth: wide ? 560 : undefined, maxHeight: height * maxHeight, backgroundColor: colors.bgSecondary,
              borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: 1, borderColor: colors.border,
              paddingBottom: Math.max(insets.bottom, space.md), marginBottom: wide ? space.xl : 0,
              borderBottomLeftRadius: wide ? radius.xl : 0, borderBottomRightRadius: wide ? radius.xl : 0,
            }}
          >
            <View style={{ alignItems: 'center', paddingTop: 10 }}>
              <View style={{ width: 38, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong }} />
            </View>
            {title ? (
              <View style={{ paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.xs }}>
                <Txt variant="title" accessibilityRole="header">
                  {title}
                </Txt>
                {subtitle ? (
                  <Txt variant="body" color="textSecondary" style={{ marginTop: 4 }}>
                    {subtitle}
                  </Txt>
                ) : null}
              </View>
            ) : null}
            <ScrollView
              style={{ flexGrow: 0 }}
              contentContainerStyle={{ paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.md }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>
            {footer ? <View style={{ paddingHorizontal: space.xl, paddingTop: space.xs }}>{footer}</View> : null}
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

type ConfirmProps = {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
  loading?: boolean;
};

export function ConfirmSheet({ visible, title, message, confirmLabel, onConfirm, onCancel, destructive, loading }: ConfirmProps) {
  return (
    <BottomSheet visible={visible} onClose={onCancel} title={title} subtitle={message}>
      <View style={{ gap: space.xs, paddingTop: space.sm }}>
        <Button title={confirmLabel} onPress={onConfirm} variant={destructive ? 'danger' : 'primary'} loading={loading} />
        <Button title="Cancel" onPress={onCancel} variant="ghost" />
      </View>
    </BottomSheet>
  );
}

export type SheetAction = {
  label: string;
  icon?: React.ReactNode;
  onPress: () => void;
  destructive?: boolean;
  hint?: string;
};

/** Action list (profile "More", message long-press, etc.). */
export function ActionSheet({ visible, onClose, title, actions }: { visible: boolean; onClose: () => void; title?: string; actions: SheetAction[] }) {
  const { colors } = useTheme();
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      <View style={{ backgroundColor: colors.card, borderRadius: 20, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
        {actions.map((a, i) => (
          <Pressable
            key={a.label}
            onPress={() => {
              onClose();
              setTimeout(a.onPress, Platform.OS === 'web' ? 0 : 220);
            }}
            accessibilityRole="button"
            accessibilityLabel={a.label}
            accessibilityHint={a.hint}
            style={({ pressed }) => ({
              flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: space.md, minHeight: 56,
              backgroundColor: pressed ? colors.elevated : 'transparent',
              borderBottomWidth: i === actions.length - 1 ? 0 : 1, borderBottomColor: colors.border,
            })}
          >
            {a.icon}
            <View style={{ flex: 1, paddingVertical: 12 }}>
              <Txt variant="subheading" color={a.destructive ? 'danger' : 'text'}>
                {a.label}
              </Txt>
              {a.hint ? (
                <Txt variant="small" color="textMuted">
                  {a.hint}
                </Txt>
              ) : null}
            </View>
          </Pressable>
        ))}
      </View>
      <Button title="Cancel" variant="ghost" onPress={onClose} style={{ marginTop: space.xs }} />
    </BottomSheet>
  );
}
