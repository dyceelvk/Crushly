import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Txt } from './Txt';
import { Avatar } from './Photo';
import { CrushIcon } from './Logo';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import { haptic } from '../lib/haptics';

type ToastKind = 'success' | 'error' | 'info' | 'crush';
type ToastInput = { kind?: ToastKind; title: string; message?: string; avatar?: string | null; onPress?: () => void; duration?: number };
type ToastItem = ToastInput & { id: number };

const ToastContext = createContext<(t: ToastInput) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const counter = useRef(0);
  const show = useCallback((t: ToastInput) => {
    counter.current += 1;
    if (t.kind === 'crush') haptic.success();
    else if (t.kind === 'error') haptic.warning();
    AccessibilityInfo.announceForAccessibility(`${t.title}${t.message ? `. ${t.message}` : ''}`);
    setToast({ ...t, id: counter.current });
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast ? <ToastView key={toast.id} toast={toast} onDone={() => setToast((cur) => (cur?.id === toast.id ? null : cur))} /> : null}
    </ToastContext.Provider>
  );
}

function ToastView({ toast, onDone }: { toast: ToastItem; onDone: () => void }) {
  const { colors, reduceMotion } = useTheme();
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(0)).current;
  const native = Platform.OS !== 'web';

  const hide = useCallback(() => {
    Animated.timing(anim, { toValue: 0, duration: reduceMotion ? 0 : 180, useNativeDriver: native }).start(onDone);
  }, [anim, onDone, reduceMotion, native]);

  useEffect(() => {
    Animated.spring(anim, { toValue: 1, useNativeDriver: native, speed: 18, bounciness: reduceMotion ? 0 : 6 }).start();
    const t = setTimeout(hide, toast.duration ?? (toast.kind === 'error' ? 4200 : 3000));
    return () => clearTimeout(t);
  }, [anim, hide, toast, reduceMotion, native]);

  const accent = { success: colors.success, error: colors.danger, info: colors.gold, crush: colors.crush }[toast.kind || 'info'];
  const icon = { success: 'checkmark-circle', error: 'alert-circle', info: 'information-circle', crush: 'heart' }[toast.kind || 'info'] as keyof typeof Ionicons.glyphMap;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={{
        position: 'absolute', top: insets.top + 8, left: 0, right: 0, alignItems: 'center', paddingHorizontal: space.md,
        opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) }],
      }}
    >
      <Pressable
        onPress={() => {
          toast.onPress?.();
          hide();
        }}
        accessibilityRole={toast.onPress ? 'button' : 'alert'}
        accessibilityLiveRegion="polite"
        style={{
          width: '100%', maxWidth: 460, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.elevated,
          borderRadius: radius.lg, paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1,
          borderColor: toast.kind === 'crush' ? colors.crushSoft : colors.borderStrong,
          shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 12,
        }}
      >
        {toast.avatar !== undefined ? (
          <View>
            <Avatar uri={toast.avatar} size={40} />
            {toast.kind === 'crush' ? (
              <View style={{ position: 'absolute', right: -4, bottom: -4, backgroundColor: colors.crush, borderRadius: 10, padding: 3, borderWidth: 2, borderColor: colors.elevated }}>
                <CrushIcon size={10} color="#fff" filled />
              </View>
            ) : null}
          </View>
        ) : (
          <Ionicons name={icon} size={22} color={accent} />
        )}
        <View style={{ flex: 1 }}>
          <Txt variant="bodyStrong" numberOfLines={2}>
            {toast.title}
          </Txt>
          {toast.message ? (
            <Txt variant="small" color="textSecondary" numberOfLines={2}>
              {toast.message}
            </Txt>
          ) : null}
        </View>
        {toast.onPress ? <Ionicons name="chevron-forward" size={16} color={colors.textMuted} /> : null}
      </Pressable>
    </Animated.View>
  );
}
