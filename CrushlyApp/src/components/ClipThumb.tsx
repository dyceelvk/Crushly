import React, { useEffect } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { mediaSource } from '../lib/mediaHost';

/**
 * A still of a clip, for grids.
 *
 * A grid of clips used to be a grid of empty boxes: `Photo` cannot decode an
 * mp4, so every video tile in the sound page and every other wall of clips
 * rendered as a rectangle of card colour. That reads as broken media rather than
 * as a picture of something.
 *
 * This mounts the clip's own player, muted, paused on its first frame, and
 * paints it like a photograph. Nothing plays: a tile is a picture of a clip, and
 * the decoder budget is why this is only used where the caller renders a handful
 * of tiles at once.
 */
export function ClipThumb({
  uri,
  style,
  contentFit = 'cover',
}: {
  uri: string;
  style?: StyleProp<ViewStyle>;
  contentFit?: 'cover' | 'contain';
}) {
  const player = useVideoPlayer(mediaSource(uri), (p) => {
    p.muted = true;
    p.loop = false;
  });

  // Paused on frame one. Some platforms only decode a frame once playback has
  // actually started, so it is nudged for a moment and stopped again.
  useEffect(() => {
    if (!player) return;
    player.play();
    const t = setTimeout(() => {
      player.pause();
      player.currentTime = 0;
    }, 260);
    return () => clearTimeout(t);
  }, [player]);

  return (
    <View style={style} pointerEvents="none">
      <VideoView
        player={player}
        style={{ width: '100%', height: '100%' }}
        contentFit={contentFit}
        nativeControls={false}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    </View>
  );
}
