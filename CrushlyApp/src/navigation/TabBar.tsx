import React from 'react';
import { Platform, Pressable, View, useWindowDimensions } from 'react-native';
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
import { SpaceNavigation } from './SpaceNavigation';
import { useSwipeTabs } from '../components/SwipeTabs';

const ICONS: Record<string, [keyof typeof Ionicons.glyphMap, keyof typeof Ionicons.glyphMap] | 'crush'> = {
  Flows: ['home', 'home-outline'],
  Discover: ['compass', 'compass-outline'],
  Connections: ['people', 'people-outline'],
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

  const { width } = useWindowDimensions();
  const focusedRoute = state.routes[state.index]?.name;
  // Create is an action, not a page; swiping must never open the composer.
  const swipe = useSwipeTabs({
    options: ['Flows', 'Connections', 'Messages', 'Profile'] as const,
    value: focusedRoute === 'Connections' || focusedRoute === 'Messages' || focusedRoute === 'Profile' ? focusedRoute : 'Flows',
    width,
    onChange: (name) => {
      const route = state.routes.find((r) => r.name === name);
      if (!route) return;
      const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
      if (!event.defaultPrevented) navigation.navigate(route.name, route.params);
    },
  });
  if (focusedRoute === 'Profile') return <SpaceNavigation />;

  // Crushes is a part of Home now, so its count rides on Home's icon rather
  // than on a tab of its own.
  const counts: Record<string, number> = {
    Flows: badges?.crushes || 0,
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
    // A tab with no icon in the map used to throw here (`icon[1]` of undefined)
    // and take the whole bar — and therefore the whole app — down. A route the
    // map has not been told about draws a plain dot instead.
    const icon = ICONS[route.name] ?? ['ellipse-outline', 'ellipse-outline'];
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
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 42, gap: 2 }}
      >
        <View
          style={{
            // Centred by hand: an absolutely-positioned box with no offsets in RN starts
            // at the left edge, so the glow line drifted out of its own tab.
            position: 'absolute', top: -6, left: '50%', marginLeft: -13, width: 24, height: 2, borderRadius: 1,
            backgroundColor: focused ? colors.gold : 'transparent',
            shadowColor: colors.gold, shadowOpacity: focused ? 0.9 : 0, shadowRadius: 8, shadowOffset: { width: 0, height: 0 },
          }}
        />
        <View>
          {icon === 'crush' ? (
            <CrushIcon size={21} color={color} filled={focused} />
          ) : (
            <Ionicons name={focused ? icon[0] : icon[1] ?? icon[0]} size={21} color={color} />
          )}
          {count ? <CountBadge count={count} style={{ position: 'absolute', top: -6, right: -12 }} /> : null}
        </View>
        <Txt variant="caption" color={focused ? 'text' : 'textMuted'} style={{ fontSize: 10 }} maxFontSizeMultiplier={1.2}>
          {label}
        </Txt>
      </Pressable>
    );
  };

  // The create button divides the bar in half, wherever the tab count falls.
  // Discovery lives in Home's strip; retain its hidden route for old deep links.
  const shownRoutes = state.routes.map((route, index) => ({ route, index })).filter(({ route }) => route.name !== 'Discover');
  const half = Math.ceil(shownRoutes.length / 2);

  return (
    <Container
      {...containerProps}
      style={{
        flexDirection: 'row', paddingBottom: Math.max(insets.bottom, 6), paddingTop: 4, borderTopWidth: 1, borderTopColor: colors.border,
        backgroundColor: Platform.OS === 'ios' ? colors.glass : colors.bgSecondary,
      }}
      accessibilityRole="tablist"
    >
      <View {...swipe.panHandlers} style={{ flexDirection: 'row', flex: 1, maxWidth: 640, alignSelf: 'center', marginHorizontal: 'auto' }}>
        {shownRoutes.slice(0, half).map(({route, index}) => tab(route, index))}

        {/*
          Create sits in the row like the other five, exactly as it does inside a
          Space.

          It used to be a 52 px circle lifted 18 px above the bar, ringed in the
          page colour — a floating button in the middle of a phone that already
          has a bar there. It covered whatever the thumb was scrolling and it made
          the bar taller than the five tabs needed, for one action. The Space's
          version — a glyph and a word in the row — is the one the owner asked
          for, so this is that: same size as a tab, no lift, no ring.
        */}
        {onCreate ? (
          <Pressable
            onPress={() => {
              haptic.tap();
              onCreate();
            }}
            accessibilityRole="button"
            accessibilityLabel="Create a post"
            hitSlop={6}
            style={{ flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', gap: 2 }}
          >
            <Ionicons name="add-circle" size={21} color={colors.primary} />
            <Txt variant="caption" color="textMuted" style={{ fontSize: 10 }} maxFontSizeMultiplier={1.2} numberOfLines={1}>
              Create
            </Txt>
          </Pressable>
        ) : null}

        {shownRoutes.slice(half).map(({route, index}) => tab(route, index))}
      </View>
    </Container>
  );
}
