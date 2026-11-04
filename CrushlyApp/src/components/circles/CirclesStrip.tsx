import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Txt } from '../Txt';
import { CircleCover } from '../CircleCover';
import { Skeleton } from '../States';
import { useMyCircles } from '../../api/hooks';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';
import type { RootStackParamList } from '../../navigation/types';

/**
 * Circles, as a row you can reach from the feed.
 *
 * There is one Circle system in Crushly and it now has three presentations:
 *
 *   * this strip       — a row of rooms at the top of Connections, for when you
 *                        are already scrolling and one room has something new;
 *   * the Space's row  — "Your Circles", which is the door when you are not;
 *   * `CirclesScreen`  — the full list, with the members, the themes and the
 *                        invitation-only rules behind each one.
 *
 * All three read the same `my_circles()` call, so a Circle cannot appear in one
 * place and be missing from another, and its unread count cannot disagree with
 * itself. Nothing here is a second kind of Circle: a tap opens the room.
 *
 * The row draws nothing at all when you are in no Circles. Home is the feed, and
 * an empty "you have no rooms" panel above it would be an advert for a feature
 * rather than a fact about your account — the Space is where that belongs.
 */
export function CirclesStrip({ top = 0 }: { top?: number }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors } = useTheme();
  const circles = useMyCircles();

  const items = circles.data?.items ?? [];
  const loading = circles.isLoading;

  // Nothing to show and nothing on the way: stay out of the feed's way.
  if (!loading && !items.length) return null;

  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top,
        zIndex: 18,
      }}
      pointerEvents="box-none"
    >
      {/* A short scrim, not a bar: the strip sits over a video, and a slab here
          would divide the page in two. */}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', top: -12, left: 0, right: 0, bottom: -10, backgroundColor: 'rgba(0,0,0,0.28)' }}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.sm, paddingVertical: 6 }}
      >
        {loading
          ? [0, 1, 2].map((i) => <Skeleton key={i} style={{ width: 104, height: 34, borderRadius: 17 }} />)
          : items.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => navigation.navigate('Circle', { circleId: c.id })}
                accessibilityRole="button"
                accessibilityLabel={`${c.name}${c.unreadCount ? `, ${c.unreadCount} new` : ''}`}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 7,
                  paddingLeft: 3,
                  paddingRight: 11,
                  height: 34,
                  borderRadius: 17,
                  backgroundColor: c.unreadCount ? 'rgba(255,198,87,0.18)' : 'rgba(255,255,255,0.12)',
                  borderWidth: 1,
                  borderColor: c.unreadCount ? colors.gold : 'rgba(255,255,255,0.16)',
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <CircleCover circle={c} size={28} radius={14} />
                <Txt variant="smallStrong" color="#FFFFFF" numberOfLines={1} style={{ maxWidth: 96 }}>
                  {c.name}
                </Txt>
                {c.unreadCount ? (
                  <View
                    style={{
                      backgroundColor: colors.gold,
                      borderRadius: 999,
                      minWidth: 18,
                      height: 18,
                      paddingHorizontal: 4,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Txt variant="caption" color="#0A0A0C">
                      {c.unreadCount > 9 ? '9+' : c.unreadCount}
                    </Txt>
                  </View>
                ) : null}
              </Pressable>
            ))}
        {loading ? null : (
          <Pressable
            onPress={() => navigation.navigate('Circles')}
            accessibilityRole="button"
            accessibilityLabel="All your Circles"
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: 11,
              height: 34,
              borderRadius: 17,
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.24)',
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Ionicons name="people-outline" size={14} color="#FFFFFF" />
            <Txt variant="smallStrong" color="#FFFFFF">
              All
            </Txt>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}
