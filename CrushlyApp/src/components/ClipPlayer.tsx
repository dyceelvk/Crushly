import { useEffect, useRef, useState } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Txt } from './Txt';
import { mediaSource } from '../lib/mediaHost';
import { useTheme } from '../theme/ThemeProvider';
import { radius } from '../theme/tokens';

/**
 * A clip in a conversation, waiting to be watched.
 *
 * Deliberately not autoplaying. A chat can hold several clips, and a feed of
 * things that start making noise the moment they scroll into view is how a
 * conversation becomes hostile. The member taps; the clip plays once; tapping
 * again pauses.
 *
 * The first frame is nudged into view the same way ClipThumb does it: some
 * platforms will not decode a frame until playback has started, so playing for a
 * moment and stopping is what shows a picture instead of a black rectangle.
 */
export function ClipPlayer({
  uri,
  style,
  accessibilityLabel = 'Clip',
}: {
  uri: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const { colors } = useTheme();
  const player = useVideoPlayer(mediaSource(uri), (p) => {
    p.muted = false;
    p.loop = false;
  });
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const primed = useRef(false);

  useEffect(() => {
    if (!player || primed.current) return;
    primed.current = true;
    player.play();
    const t = setTimeout(() => {
      player.pause();
      player.currentTime = 0;
    }, 300);
    return () => clearTimeout(t);
  }, [player]);

  useEffect(() => {
    if (!player) return;
    const sub = player.addListener('statusChange', (payload) => {
      if (payload.status === 'error') setFailed(true);
      if (payload.status === 'idle' && playing) setPlaying(false);
    });
    return () => sub.remove();
  }, [player, playing]);

  const toggle = () => {
    if (!player || failed) return;
    if (playing) {
      player.pause();
      setPlaying(false);
    } else {
      if (player.currentTime >= (player.duration || 0) - 0.15) player.currentTime = 0;
      player.play();
      setPlaying(true);
    }
  };

  return (
    <Pressable
      onPress={toggle}
      accessibilityRole="button"
      accessibilityLabel={playing ? `Pause ${accessibilityLabel}` : `Play ${accessibilityLabel}`}
      style={[{ position: 'relative', backgroundColor: '#000' }, style]}
    >
      {failed ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <Ionicons name="videocam-off-outline" size={22} color={colors.textMuted} />
          <Txt variant="small" color="textMuted" style={{ marginTop: 6, textAlign: 'center' }}>
            This clip will not play here.
          </Txt>
        </View>
      ) : (
        <>
          <VideoView
            player={player}
            style={{ width: '100%', height: '100%' }}
            contentFit="contain"
            nativeControls={false}
            pointerEvents="none"
          />
          {!playing ? (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <View
                style={{
                  width: 52, height: 52, borderRadius: 26,
                  backgroundColor: 'rgba(0,0,0,0.55)',
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Ionicons name="play" size={26} color="#fff" style={{ marginLeft: 3 }} />
              </View>
            </View>
          ) : null}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute', right: 8, top: 8,
              paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill,
              backgroundColor: 'rgba(0,0,0,0.5)',
            }}
          >
            <Txt variant="caption" color="text" style={{ color: '#fff' }}>clip</Txt>
          </View>
        </>
      )}
    </Pressable>
  );
}
