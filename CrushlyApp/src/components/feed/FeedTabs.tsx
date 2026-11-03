import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
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
  onSearch,
}: {
  tabs: FeedTab[];
  active: string;
  onChange: (key: string) => void;
  top?: number;
  /**
   * The search at the far end of the strip. It belongs here rather than in a
   * corner of its own: the strip is already the row of "where am I", and the
   * magnifier is the fourth thing on that row in the reference too.
   */
  onSearch?: () => void;
}) {
  const { colors } = useTheme();
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
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flex: 1 }}
        contentContainerStyle={{
          flexGrow: 1,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 20,
          paddingHorizontal: space.md,
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
                  fontSize: 15,
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
          style={{ paddingHorizontal: 14, paddingVertical: 10 }}
        >
          <Ionicons name="search" size={21} color="#FFFFFF" />
        </Pressable>
      ) : null}
      </View>
      {/* The active bar is drawn per-tab above; this keeps the theme honest for
          anyone reading the file and looking for the accent. */}
      <View style={{ height: 0, backgroundColor: colors.text }} />
    </View>
  );
}
