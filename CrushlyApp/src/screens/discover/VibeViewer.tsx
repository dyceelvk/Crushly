import React, { useEffect } from 'react';
import { ActivityIndicator, Modal, Pressable, View } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { Avatar } from '../../components/Photo';
import { VerifiedBadge } from '../../components/Badges';
import { IconButton } from '../../components/IconButton';
import { EmptyState } from '../../components/States';
import { useLayout } from '../../components/Layout';
import { mediaUrl } from '../../api/client';
import { mediaSource } from '../../lib/mediaHost';
import { useVibes, useViewVibe } from '../../api/hooks';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { timeAgo } from '../../lib/format';
import type { ScreenProps } from '../../navigation/types';

function daysLeft(expiresAt: number): string {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return 'gone';
  const d = Math.ceil(ms / 86_400_000);
  return d <= 1 ? 'gone tomorrow' : `${d} days left`;
}

/**
 * Watching one Vibe.
 *
 * It plays inside Crushly, full screen, and it counts as watched the moment it
 * opens — but only for somebody else's Vibe: your own view of your own clip is
 * not an audience. Who watched is recorded so the author can see it, and it is
 * the author alone who can ever read that list.
 */
export function VibeViewerScreen({ route, navigation }: ScreenProps<'VibeViewer'>) {
  const { id } = route.params;
  const insets = useSafeAreaInsets();
  const { contentWidth } = useLayout();
  const { colors } = useTheme();
  const vibes = useVibes();
  const view = useViewVibe();

  const vibe = vibes.data?.find((v) => v.id === id) ?? null;

  // Recorded once, and never for your own.
  useEffect(() => {
    if (vibe && !vibe.mine) view.mutate(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, vibe?.mine]);

  const player = useVideoPlayer(vibe ? mediaSource(mediaUrl(vibe.mediaUrl)) : null, (p) => {
    p.loop = true;
    p.play();
  });

  return (
    <Modal visible animationType="fade" onRequestClose={() => navigation.goBack()}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingTop: insets.top + space.sm,
            paddingHorizontal: space.md,
            paddingBottom: space.sm,
          }}
        >
          <IconButton icon="close" label="Close" onPress={() => navigation.goBack()} />
          {vibe ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
              <Avatar uri={vibe.author.photo} name={vibe.author.name} size={30} ring={vibe.author.mutual ? 'crush' : undefined} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Txt variant="bodyStrong" style={{ color: '#fff' }} numberOfLines={1}>
                    {vibe.mine ? 'Your Vibe' : vibe.author.name}
                  </Txt>
                  {vibe.author.verified ? <VerifiedBadge size={12} /> : null}
                </View>
                <Txt variant="caption" color="textMuted" numberOfLines={1}>
                  {timeAgo(vibe.createdAt)} · {daysLeft(vibe.expiresAt)}
                </Txt>
              </View>
            </View>
          ) : null}
        </View>

        <View style={{ flex: 1, justifyContent: 'center', width: '100%', maxWidth: contentWidth, alignSelf: 'center' }}>
          {!vibe ? (
            vibes.isLoading ? (
              <ActivityIndicator size="large" color={colors.gold} />
            ) : (
              <EmptyState
                icon="play-circle-outline"
                title="This Vibe has passed"
                message="Vibes last two weeks. Ask them to share another."
                action={{ label: 'Close', onPress: () => navigation.goBack() }}
              />
            )
          ) : (
            <VideoView
              player={player}
              style={{ width: '100%', height: '100%' }}
              contentFit="contain"
              nativeControls
              accessibilityLabel={`Vibe from ${vibe.author.name}`}
            />
          )}
        </View>

        {vibe && vibe.body ? (
          <View style={{ paddingHorizontal: space.lg, paddingBottom: insets.bottom + space.lg }}>
            <View
              style={{
                borderRadius: radius.lg,
                backgroundColor: 'rgba(255,255,255,0.10)',
                paddingHorizontal: 14,
                paddingVertical: 10,
              }}
            >
              <Txt variant="body" style={{ color: '#fff' }}>
                {vibe.body}
              </Txt>
            </View>
          </View>
        ) : null}

        {!vibe && !vibes.isLoading ? null : null}
      </View>
    </Modal>
  );
}
