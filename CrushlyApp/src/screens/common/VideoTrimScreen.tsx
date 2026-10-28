import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { RangeSlider } from '../../components/Slider';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';
import { formatTime } from '../../lib/videoEdit';
import type { ScreenProps } from '../../navigation/types';

export type TrimResult = { trimStart: number; trimEnd: number; category: string };

let pendingTrim: TrimResult | null = null;
export function setTrimResult(result: TrimResult) {
  pendingTrim = result;
}
export function takeTrimResult() {
  const result = pendingTrim;
  pendingTrim = null;
  return result;
}

/**
 * Dedicated trim screen: the very first thing shown after a member picks a
 * video clip for a post, Vibe, Moment or Circle. Nothing else lives here — no
 * captions, no filters, no stickers — just where the clip starts and stops.
 *
 * Returns `{ trimStart, trimEnd }` in source seconds via navigation params on
 * dismiss, or nothing when cancelled.
 */
export function VideoTrimScreen({ navigation, route }: ScreenProps<'VideoTrim'>) {
  const { sourceUri, sourceDuration, category } = route.params as {
    sourceUri: string;
    sourceDuration: number;
    category: 'post' | 'vibe' | 'moment' | 'circle';
  };
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(sourceDuration);

  const player = useVideoPlayer(sourceUri, (p) => {
    p.loop = false;
  });

  const limit = {
    moment: 15,
    vibe: 30,
    post: 60,
    circle: 60,
  }[category];

  const cap = Math.min(limit, Math.max(1, sourceDuration || limit));

  const done = () => {
    setTrimResult({ trimStart, trimEnd, category });
    navigation.pop();
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#0b0b0d' }}>
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
        <IconButton icon="chevron-back" label="Back" onPress={() => navigation.pop()} />
        <Txt variant="title" style={{ flex: 1, color: '#fff' }} accessibilityRole="header">
          Trim your clip
        </Txt>
        <Button title="Done" size="sm" variant="primary" onPress={done} accessibilityLabel="Keep this trim" />
      </View>

      <View style={{ alignItems: 'center', paddingHorizontal: space.md, paddingTop: space.sm }}>
        <VideoView
          player={player}
          style={{ width: '100%', height: 260, borderRadius: 16 }}
          contentFit="contain"
          nativeControls
          accessibilityLabel="Your clip"
        />
        <View style={{ marginTop: 8, flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          <Txt variant="caption" color="#9a9aa2">
            {formatTime(trimStart)}
          </Txt>
          <Txt variant="caption" color="#7c7c86" style={{ flex: 1, textAlign: 'center' }}>
            {formatTime(trimEnd - trimStart)} of {formatTime(sourceDuration)}
          </Txt>
          <Txt variant="caption" color="#9a9aa2">
            {formatTime(trimEnd)}
          </Txt>
        </View>
      </View>

      <View style={{ paddingHorizontal: space.md, paddingTop: space.sm, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <RangeSlider
            min={0}
            max={Math.max(0.1, sourceDuration)}
            low={trimStart}
            high={trimEnd}
            step={0.1}
            onChange={(s, e) => {
              setTrimStart(s);
              setTrimEnd(e);
            }}
            label="Start and end"
            formatValue={(v) => `${formatTime(v)}s`}
          />
        </View>
        <Txt variant="caption" style={{ color: '#7c7c86' }}>
          Keep {formatTime(trimEnd - trimStart)} of {formatTime(sourceDuration)}. Trimmed-away video is hidden, not
          deleted — you can widen it again later.
        </Txt>
      </View>

      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: space.md, paddingTop: space.sm }}>
        <Button
          title="Use everything"
          size="sm"
          variant="secondary"
          full={false}
          onPress={() => {
            setTrimStart(0);
            setTrimEnd(sourceDuration);
          }}
        />
        <Button
          title={`First ${Math.min(limit, Math.round(sourceDuration))}s`}
          size="sm"
          variant="secondary"
          full={false}
          onPress={() => {
            setTrimStart(0);
            setTrimEnd(Math.min(limit, sourceDuration));
          }}
        />
        <Button
          title="Last 5s"
          size="sm"
          variant="secondary"
          full={false}
          onPress={() => {
            setTrimStart(Math.max(0, sourceDuration - 5));
            setTrimEnd(sourceDuration);
          }}
        />
      </View>

      <View
        style={{
          flex: 1,
          justifyContent: 'flex-end',
          paddingHorizontal: space.md,
          paddingBottom: insets.bottom + space.xxl,
        }}
      >
        <Pressable
          onPress={() => navigation.pop()}
          accessibilityLabel="Cancel trim"
          style={{ paddingVertical: space.sm }}
        >
          <Txt variant="bodyStrong" color="#9a9aa2" align="center">
            Cancel
          </Txt>
        </Pressable>
      </View>
    </View>
  );
}
