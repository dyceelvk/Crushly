import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BottomSheet } from './BottomSheet';
import { Txt } from './Txt';
import { useBadges } from '../api/hooks';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

type Destination = 'Circles' | 'Moments' | 'Notifications' | 'Settings' | 'SavedPosts';

type Row = {
  key: Destination;
  label: string;
  hint: string;
  icon: keyof typeof Ionicons.glyphMap;
  badge?: number;
};

/**
 * The menu behind the Flow's top-left button.
 *
 * That button used to open a second, older feed — a scrolling list of the same
 * posts under a different name — which is the sort of thing you notice
 * immediately and cannot un-notice: two Feeds, and neither of them the whole
 * app. Everything that is not one of the four tabs (Flow, Crushes, Whispers,
 * Space) lives here instead, named in Crushly's words rather than the
 * reference's.
 */
export function AppMenu({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const navigation = useNavigation<Nav>();
  const { colors } = useTheme();
  const { data: badges } = useBadges(true);

  const rows: Row[] = [
    { key: 'Circles', label: 'Your Circles', hint: 'The small rooms you are in', icon: 'people-outline' },
    { key: 'Moments', label: 'Moments', hint: 'Today, then gone', icon: 'aperture-outline' },
    { key: 'SavedPosts', label: 'Picked', hint: 'What you picked from the Flow', icon: 'download-outline' },
    { key: 'Notifications', label: 'Notifications', hint: 'Crushes, Whispers and everything else', icon: 'notifications-outline', badge: badges?.notifications || 0 },
    { key: 'Settings', label: 'Settings', hint: 'Account, privacy and appearance', icon: 'settings-outline' },
  ];

  const go = (key: Row['key']) => {
    onClose();
    // The sheet closes first: a nav push behind a closing sheet looks like two
    // screens arriving at once.
    setTimeout(() => {
      navigation.navigate(key);
    }, 180);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Everything else" subtitle="The Flow is one place. Here is the rest of Crushly.">
      <View style={{ paddingBottom: space.sm }}>
        {rows.map((row, i) => (
          <Pressable
            key={row.key}
            onPress={() => go(row.key)}
            accessibilityRole="button"
            accessibilityLabel={row.label}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.sm,
              paddingVertical: 13,
              paddingHorizontal: space.xs,
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: colors.border,
            }}
          >
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: radius.md,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.elevated,
              }}
            >
              <Ionicons name={row.icon} size={19} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt variant="bodyStrong">{row.label}</Txt>
              <Txt variant="caption" color="textMuted" numberOfLines={1}>
                {row.hint}
              </Txt>
            </View>
            {row.badge ? (
              <View style={{ minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.crush }}>
                <Txt variant="caption" style={{ color: '#FFFFFF', fontSize: 11 }}>
                  {row.badge > 99 ? '99+' : row.badge}
                </Txt>
              </View>
            ) : null}
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </Pressable>
        ))}
      </View>
    </BottomSheet>
  );
}
