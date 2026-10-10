import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Txt } from '../../components/Txt';
import { Photo } from '../../components/Photo';
import { Skeleton } from '../../components/States';
import { useVibes } from '../../api/hooks';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { timeAgo } from '../../lib/format';
import type { Vibe } from '../../api/types';
import type { RootStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const TILE_W = 116;
const TILE_H = 168;

/** How long a Vibe has left, in the plainest words. */
function leftLabel(expiresAt: number): string {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return 'gone';
  const days = Math.ceil(ms / 86_400_000);
  if (days <= 1) return 'gone tomorrow';
  return `${days} days left`;
}

/**
 * Vibes, as a row of clips.
 *
 * A Vibe lasts a fortnight — long enough to say something that isn't a mood,
 * short enough that nothing here becomes a permanent record of a member's face
 * and voice. Unseen Vibes wear a gold ring so the row tells you, at a glance,
 * what you have not watched yet. Anything you may not watch never arrives from
 * the database, so there is nothing here to hide.
 */
export function VibesRow() {
  const navigation = useNavigation<Nav>();
  const { colors } = useTheme();
  const vibes = useVibes();

  const items = vibes.data ?? [];

  if (vibes.isLoading && !items.length) {
    return (
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Skeleton style={{ width: TILE_W, height: TILE_H, borderRadius: radius.md }} />
        <Skeleton style={{ width: TILE_W, height: TILE_H, borderRadius: radius.md }} />
        <Skeleton style={{ width: TILE_W, height: TILE_H, borderRadius: radius.md }} />
      </View>
    );
  }

  if (!items.length) return null;

  return (
    <View>
      <SectionLabel title="Vibes" hint="Gone in two weeks" />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 10, paddingRight: space.md }}
      >
        {items.map((v) => (
          <VibeTile
            key={v.id}
            vibe={v}
            onPress={() => navigation.navigate('VibeViewer', { id: v.id })}
          />
        ))}
        {vibes.isError ? (
          <View style={{ width: TILE_W, justifyContent: 'center' }}>
            <Txt variant="caption" color="textSecondary">
              Vibes didn’t load. Pull to try again.
            </Txt>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** One section's heading inside Discover. */
function SectionLabel({ title, hint }: { title: string; hint?: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        marginTop: space.xl,
        marginBottom: space.sm,
      }}
    >
      <Txt variant="title" accessibilityRole="header">
        {title}
      </Txt>
      {hint ? (
        <Txt variant="small" color="textMuted">
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

function VibeTile({ vibe, onPress }: { vibe: Vibe; onPress: () => void }) {
  const { colors } = useTheme();
  const unwatched = !vibe.mine && !vibe.seen;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${vibe.author.name}’s Vibe, ${timeAgo(vibe.createdAt)}, ${leftLabel(vibe.expiresAt)}`}
      style={{
        width: TILE_W,
        borderRadius: radius.md,
        overflow: 'hidden',
        backgroundColor: colors.card,
        borderWidth: unwatched ? 1.5 : 0,
        borderColor: colors.gold,
      }}
    >
      <View style={{ width: '100%', height: TILE_H - 40, backgroundColor: '#000' }}>
        {vibe.coverUrl ? (
          <Photo uri={vibe.coverUrl} style={{ width: '100%', height: '100%' }} />
        ) : (
          // No still to show, and a clip must never be drawn as if it were a
          // photo: a play mark on black says what it is.
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="play" size={22} color="#fff" />
          </View>
        )}
      </View>
      <View style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
        <Txt variant="caption" numberOfLines={1}>
          {vibe.mine ? 'Your Vibe' : vibe.author.name}
        </Txt>
        <Txt variant="caption" color="textMuted" numberOfLines={1}>
          {vibe.mine ? leftLabel(vibe.expiresAt) : timeAgo(vibe.createdAt)}
        </Txt>
      </View>
    </Pressable>
  );
}
