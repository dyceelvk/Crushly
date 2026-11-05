/**
 * Top Crushes This Week — a rail of clips on Discover.
 *
 * Nine-by-sixteen, one author each, ranked by the backend (Crushes, comments
 * counting for three, the last seven days first). The rail is the reason clips
 * earned their way back into the product: a clip is the one kind of post that
 * can be a picture of itself at this size.
 *
 * Two deliberate choices:
 *
 *  · It runs off the right edge. There is no right gutter and no pager — the cut
 *    card is the invitation to swipe, the way every rail on Discover behaves.
 *  · A tile is a still, not a player. `ClipThumb` pauses on the first frame, so
 *    a dozen tiles cost one frame each and nothing starts moving under a thumb
 *    that was only scrolling. The tap opens the post, which does play.
 */
import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Txt } from '../Txt';
import { ClipThumb } from '../ClipThumb';
import { Skeleton } from '../States';
import { useLayout } from '../Layout';
import { useTrendingClips } from '../../api/hooks';
import { useTheme } from '../../theme/ThemeProvider';
import { space, radius, stroke } from '../../theme/tokens';
import { formatCount } from '../../lib/counts';
import type { RootStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const TILE_WIDTH = 124;
const TILE_HEIGHT = 208;

export function ClipRail() {
  const navigation = useNavigation<Nav>();
  const { colors } = useTheme();
  const { gutter } = useLayout();
  const clips = useTrendingClips();

  const items = clips.data ?? [];
  if (clips.isLoading) {
    return (
      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
        <Skeleton style={{ width: TILE_WIDTH, height: TILE_HEIGHT, borderRadius: radius.md }} />
        <Skeleton style={{ width: TILE_WIDTH, height: TILE_HEIGHT, borderRadius: radius.md }} />
      </View>
    );
  }
  // A quiet week is not an error and not an empty state with an apology on it:
  // the section simply is not there, and Discover starts with what it has.
  if (!items.length) return null;

  return (
    <View style={{ marginTop: space.xl }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: space.sm }}>
        <Txt variant="title" accessibilityRole="header">
          Top Crushes This Week
        </Txt>
        <Txt variant="small" color="textMuted">
          7 days
        </Txt>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        // Bleed past the page gutter so the next tile is cut by the screen edge
        // rather than politely padded away from it.
        contentContainerStyle={{ gap: space.sm, paddingRight: gutter }}
        decelerationRate="fast"
        snapToInterval={TILE_WIDTH + space.sm}
        snapToAlignment="start"
      >
        {items.map((clip) => (
          <Pressable
            key={clip.id}
            onPress={() => navigation.navigate('PostViewer', { postId: clip.id })}
            accessibilityRole="button"
            accessibilityLabel={`${clip.author?.name ?? 'A member'}: ${clip.body || 'a clip'}, ${formatCount(clip.likeCount)} Crushes`}
            style={({ pressed }) => ({
              width: TILE_WIDTH,
              borderRadius: radius.md,
              overflow: 'hidden',
              borderWidth: stroke.hairline,
              borderColor: colors.border,
              backgroundColor: colors.card,
              transform: [{ scale: pressed ? 0.985 : 1 }],
            })}
          >
            <View style={{ width: TILE_WIDTH, height: TILE_HEIGHT }}>
              {clip.mediaUrl ? (
                <ClipThumb uri={clip.mediaUrl} style={{ width: TILE_WIDTH, height: TILE_HEIGHT }} />
              ) : null}

              {/* A gradient, not a band: the words have to sit on a photograph
                  without a visible edge showing where the scrim starts. */}
              <LinearGradient
                pointerEvents="none"
                colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.82)']}
                locations={[0, 0.45, 1]}
                style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: TILE_HEIGHT * 0.62 }}
              />

              {/* A bare triangle: no plate, no ring, no duration badge. */}
              <View pointerEvents="none" style={{ position: 'absolute', top: '44%', left: 0, right: 0, alignItems: 'center' }}>
                <Ionicons name="play" size={26} color="rgba(255,255,255,0.94)" />
              </View>

              <View pointerEvents="none" style={{ position: 'absolute', left: 9, right: 9, bottom: 9 }}>
                <Txt variant="caption" numberOfLines={2} style={{ color: '#FFFFFF', fontWeight: '600' }}>
                  {clip.body?.trim() || clip.author?.name || 'A clip'}
                </Txt>
                <Txt variant="caption" numberOfLines={1} style={{ color: 'rgba(255,255,255,0.68)', marginTop: 2 }}>
                  {formatCount(clip.likeCount)} Crushes · {clip.author?.name ?? 'Member'}
                </Txt>
              </View>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
