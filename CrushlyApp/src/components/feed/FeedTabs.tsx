import React from 'react';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Txt } from '../Txt';
import { useTheme } from '../../theme/ThemeProvider';
import { space, stroke } from '../../theme/tokens';

/**
 * The text tabs across the top of the feed.
 *
 * Measured from the reference captures: 46 dp tall, 15 dp semibold labels, 20 dp
 * apart, the active one full-white with a 22×2.5 dp bar centered under it. No
 * pills, no fills — the underline does all the work, which is what keeps it from
 * competing with the video underneath.
 *
 * Four tabs is the most that fits at 412 dp without shrinking the type, so the
 * caller passes exactly the surfaces it can actually serve. A tab that opens
 * nothing is worse than a tab that is not there.
 */
export type FeedTab = {
  key: string;
  label: string;
};

export function FeedTabs({
  tabs,
  active,
  onChange,
  top = 0,
  onMenu,
  onSearch,
}: {
  tabs: FeedTab[];
  active: string;
  onChange: (key: string) => void;
  top?: number;
  /**
   * The button for everything the strip does not cover.
   *
   * It is drawn *in* this row rather than floating in the corner over the clip.
   * Floating meant it overlapped the first tab on a narrow phone — at 320 dp the
   * burger sat on top of "Discover", which is how the emulator walk found it —
   * and a row is the honest description of what it is anyway: the same line as
   * the three surfaces it is an alternative to.
   */
  onMenu?: () => void;
  /**
   * The search at the far end of the strip. It belongs here rather than in a
   * corner of its own: the strip is already the row of "where am I", and the
   * magnifier is the fourth thing on that row in the reference too.
   */
  onSearch?: () => void;
}) {
  const { colors } = useTheme();
  // At 320 dp — a small phone, or the same phone with the display size turned
  // up — the row is menu + Discover + Flow + Connections + magnifier, and at the
  // comfortable sizes that is wider than the screen: "Connections" ran under the
  // magnifier. Nothing is dropped at that width, the type and the air shrink.
  const { width } = useWindowDimensions();
  const compact = width < 380;
  const labelSize = compact ? 14 : 15;
  const gap = compact ? 12 : 18;
  return (
    <View
      style={{
        position: 'absolute',
        top,
        left: 0,
        right: 0,
        height: 46,
        zIndex: 20,
      }}
      pointerEvents="box-none"
    >
      {/* A short scrim rather than a bar: the tabs must stay readable over a
          bright clip without putting a slab across the video. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: -top,
          left: 0,
          right: 0,
          height: top + 46 + 24,
          backgroundColor: 'rgba(0,0,0,0.22)',
        }}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
      {onMenu ? (
        <Pressable
          onPress={onMenu}
          accessibilityRole="button"
          accessibilityLabel="Everything else in Crushly"
          hitSlop={10}
          style={{ paddingHorizontal: compact ? 9 : 13, paddingVertical: 10 }}
        >
          <Ionicons name="menu" size={compact ? 21 : 23} color="#FFFFFF" />
        </Pressable>
      ) : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flex: 1 }}
        contentContainerStyle={{
          flexGrow: 1,
          alignItems: 'center',
          justifyContent: 'center',
          gap,
          paddingHorizontal: compact ? 2 : space.sm,
        }}
      >
        {tabs.map((t) => {
          const on = t.key === active;
          return (
            <Pressable
              key={t.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={t.label}
              onPress={() => onChange(t.key)}
              hitSlop={8}
              style={{ paddingVertical: 10 }}
            >
              <Txt
                style={{
                  fontSize: labelSize,
                  fontFamily: on ? 'Manrope_800ExtraBold' : 'Manrope_600SemiBold',
                  color: on ? '#FFFFFF' : 'rgba(255,255,255,0.72)',
                  textShadowColor: 'rgba(0,0,0,0.35)',
                  textShadowRadius: 6,
                }}
              >
                {t.label}
              </Txt>
              <View
                style={{
                  position: 'absolute',
                  bottom: 0,
                  alignSelf: 'center',
                  width: 22,
                  height: 2.5,
                  borderRadius: stroke.hairline,
                  backgroundColor: on ? '#FFFFFF' : 'transparent',
                }}
              />
            </Pressable>
          );
        })}
      </ScrollView>
      {onSearch ? (
        <Pressable
          onPress={onSearch}
          accessibilityRole="button"
          accessibilityLabel="Search Crushly"
          hitSlop={10}
          style={{ paddingHorizontal: compact ? 10 : 14, paddingVertical: 10 }}
        >
          <Ionicons name="search" size={compact ? 19 : 21} color="#FFFFFF" />
        </Pressable>
      ) : null}
      </View>
      {/* The active bar is drawn per-tab above; this keeps the theme honest for
          anyone reading the file and looking for the accent. */}
      <View style={{ height: 0, backgroundColor: colors.text }} />
    </View>
  );
}
