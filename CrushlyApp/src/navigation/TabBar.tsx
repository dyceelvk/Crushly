import React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Txt } from '../components/Txt';
import { CrushIcon } from '../components/Logo';
import { CountBadge } from '../components/Badges';
import { useTheme } from '../theme/ThemeProvider';
import { useBadges } from '../api/hooks';
import { haptic } from '../lib/haptics';

const ICONS: Record<string, [keyof typeof Ionicons.glyphMap, keyof typeof Ionicons.glyphMap] | 'crush'> = {
  Flows: ['home', 'home-outline'],
  Crushes: 'crush',
  Messages: ['chatbubble-ellipses', 'chatbubble-ellipses-outline'],
  Profile: ['person-circle', 'person-circle-outline'],
};

/**
 * Minimal glass tab bar. The selected tab gets a champagne tint and a soft
 * glow line — never a heavy colored block.
 */
export function TabBar({ state, navigation, descriptors, onCreate }: BottomTabBarProps & { onCreate?: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { data: badges } = useBadges(true);

  const counts: Record<string, number> = {
    Crushes: badges?.crushes || 0,
    Messages: badges?.messages || 0,
  };

  const Container = Platform.OS === 'ios' ? BlurView : View;
  const containerProps = Platform.OS === 'ios' ? { intensity: 40, tint: colors.scheme === 'dark' ? ('dark' as const) : ('light' as const) } : {};

  /**
   * One tab.
   *
   * Pulled out of the map so the create button can sit *between* two runs of
   * tabs rather than floating on top of the screens: a plus in the corner of a
   * feed covers the thing it is asking you to add to, and on a phone it sits
   * exactly where the thumb scrolls.
   */
  const tab = (route: (typeof state.routes)[number], index: number) => {
    const focused = state.index === index;
    const { options } = descriptors[route.key];
    const label = (options.title as string) || route.name;
    const icon = ICONS[route.name];
    const color = focused ? colors.gold : colors.textMuted;
    const count = counts[route.name] || 0;
    return (
      <Pressable
        key={route.key}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={`${label}${count ? `, ${count} new` : ''}`}
        onPress={() => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) {
            haptic.tap();
            navigation.navigate(route.name, route.params);
          }
        }}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 50, gap: 3 }}
      >
        <View
          style={{
            position: 'absolute', top: -8, width: 26, height: 2, borderRadius: 1, backgroundColor: focused ? colors.gold : 'transparent',
            shadowColor: colors.gold, shadowOpacity: focused ? 0.9 : 0, shadowRadius: 8, shadowOffset: { width: 0, height: 0 },
          }}
        />
        <View>
          {icon === 'crush' ? (
            <CrushIcon size={24} color={color} filled={focused} />
          ) : (
            <Ionicons name={focused ? icon[0] : icon[1]} size={24} color={color} />
          )}
          {count ? <CountBadge count={count} style={{ position: 'absolute', top: -6, right: -12 }} /> : null}
        </View>
        <Txt variant="caption" color={focused ? 'text' : 'textMuted'} style={{ fontSize: 11 }} maxFontSizeMultiplier={1.2}>
          {label}
        </Txt>
      </Pressable>
    );
  };

  // The create button divides the bar in half, wherever the tab count falls.
  const half = Math.ceil(state.routes.length / 2);

  return (
    <Container
      {...containerProps}
      style={{
        flexDirection: 'row', paddingBottom: Math.max(insets.bottom, 10), paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border,
        backgroundColor: Platform.OS === 'ios' ? colors.glass : colors.bgSecondary,
      }}
      accessibilityRole="tablist"
    >
      <View style={{ flexDirection: 'row', flex: 1, maxWidth: 640, alignSelf: 'center', marginHorizontal: 'auto' }}>
        {state.routes.slice(0, half).map((route, i) => tab(route, i))}

        {onCreate ? (
          <View style={{ width: 68, alignItems: 'center', justifyContent: 'center' }}>
            <Pressable
              onPress={() => {
                haptic.tap();
                onCreate();
              }}
              accessibilityRole="button"
              accessibilityLabel="Create post"
              hitSlop={10}
              style={{
                width: 52,
                height: 52,
                borderRadius: 26,
                marginTop: -18,
                backgroundColor: colors.primary,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 3,
                borderColor: colors.bg,
                shadowColor: colors.primaryDeep,
                shadowOpacity: 0.45,
                shadowRadius: 14,
                shadowOffset: { width: 0, height: 6 },
                elevation: 10,
              }}
            >
              <Ionicons name="add" size={28} color="#FFFFFF" />
            </Pressable>
          </View>
        ) : null}

        {state.routes.slice(half).map((route, i) => tab(route, i + half))}
      </View>
    </Container>
  );
}
