import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppSettings } from '../api/hooks';
import { useTheme } from '../theme/ThemeProvider';
import { Txt } from './Txt';
import { space } from '../theme/tokens';

/** An actual server-published announcement; no placeholder or fake copy. */
export function Announcement({ children }: { children: React.ReactNode }) {
  const { data } = useAppSettings();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const item = data?.announcement;
  const key = item ? `${item.title}\n${item.body}` : null;
  const visible = !!item && key !== dismissed;
  return <>
  {visible && item && <View style={{ paddingTop: insets.top + space.sm, paddingBottom: space.sm, paddingHorizontal: space.md, backgroundColor: colors.bgSecondary, flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
    <Ionicons name="megaphone-outline" size={19} color={colors.primary} />
    <View style={{ flex: 1 }}><Txt variant="bodyStrong">{item.title}</Txt><Txt variant="small" color="textSecondary">{item.body}</Txt></View>
    <Pressable onPress={() => setDismissed(key)} accessibilityRole="button" accessibilityLabel="Dismiss announcement" hitSlop={8}><Ionicons name="close" size={20} color={colors.textSecondary} /></Pressable>
  </View>}
  {/* The banner has consumed the top inset; do not apply it twice. */}
  <SafeAreaInsetsContext.Provider value={visible ? { ...insets, top: 0 } : insets}>{children}</SafeAreaInsetsContext.Provider>
  </>;
}
