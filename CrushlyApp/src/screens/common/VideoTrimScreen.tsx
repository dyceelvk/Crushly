import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { VideoEditorModal } from '../../components/VideoEditor';
import { RangeSlider } from '../../components/Slider';
import { Screen, Header } from '../../components/Layout';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { ProgressBar } from '../../components/States';
import { radius, space } from '../../theme/tokens';
import { clampEdit, emptyEdit, segmentsOf, type VideoEdit } from '../../lib/videoEdit';
import type { ScreenProps } from '../../navigation/types';

export type TrimResult = { edit: VideoEdit | null; category: 'post' | 'moment' | 'circle' };

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
 * Moments get a simple length trim, not the full multi-tool editor. Other
 * sharing surfaces keep the shared workbench and open directly on Trim.
 */
export function VideoTrimScreen({ navigation, route }: ScreenProps<'VideoTrim'>) {
  const { sourceUri, sourceDuration, category, initialEdit } = route.params;
  if (category === 'moment') {
    return (
      <MomentClipTrim
        navigation={navigation}
        sourceUri={sourceUri}
        sourceDuration={sourceDuration}
        initialEdit={initialEdit ?? null}
      />
    );
  }

  return (
    <VideoEditorModal
      visible
      sourceUri={sourceUri}
      sourceDuration={sourceDuration}
      category={category}
      initialTool="trim"
      modalAnimation="none"
      onCancel={() => navigation.pop()}
      onDone={(result) => {
        setTrimResult({ edit: result.edit, category });
        navigation.pop();
      }}
    />
  );
}

function timeLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function MomentClipTrim({
  navigation,
  sourceUri,
  sourceDuration,
  initialEdit,
}: {
  navigation: ScreenProps<'VideoTrim'>['navigation'];
  sourceUri: string;
  sourceDuration: number;
  initialEdit: VideoEdit | null;
}) {
  const player = useVideoPlayer(sourceUri, (p) => {
    p.loop = false;
  });
  const initialSeconds = Math.max(0, sourceDuration || initialEdit?.sourceDuration || 0);
  const [total, setTotal] = useState(initialSeconds);
  const initialSegments = useMemo(() => initialEdit ? segmentsOf(initialEdit) : [], [initialEdit]);
  const initialStart = initialEdit?.trimStart ?? initialSegments[0]?.start ?? 0;
  const initialEnd = initialEdit?.trimEnd ?? initialSegments[initialSegments.length - 1]?.end ?? Math.min(initialSeconds || 60, 60);
  const [range, setRange] = useState({
    start: Math.max(0, initialStart),
    end: Math.min(initialSeconds || 60, Math.max(initialStart + 0.1, initialEnd)),
  });
  const [playing, setPlaying] = useState(false);
  const max = Math.max(1, total || initialSeconds || 60);

  // Picker metadata is usually present, but native/web decoders are the source
  // of truth when it is not. Ask briefly until the player has loaded the track.
  useEffect(() => {
    if (total > 0) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      const duration = Number(player.duration) || 0;
      if (duration > 0) {
        setTotal(duration);
        setRange((current) => ({ start: Math.min(current.start, duration - 0.1), end: Math.min(current.end, duration) }));
        clearInterval(timer);
      } else if (tries >= 40) {
        clearInterval(timer);
      }
    }, 250);
    return () => clearInterval(timer);
  }, [player, total]);

  useEffect(() => {
    player.pause();
    setPlaying(false);
    player.currentTime = range.start;
  }, [player, range.start]);

  // Keep the preview inside the selected window, while the visible range line
  // and time count show exactly how much of the one-minute allowance is used.
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      if (player.currentTime >= range.end || player.currentTime < range.start) {
        player.currentTime = range.start;
        player.play();
      }
    }, 120);
    return () => clearInterval(timer);
  }, [player, playing, range.start, range.end]);

  const setWindow = (low: number, high: number) => {
    const start = Math.max(0, Math.min(low, max - 0.1));
    let end = Math.max(start + 0.1, Math.min(high, max));
    if (end - start > 60) end = start + 60;
    setRange({ start, end });
  };

  const useClip = () => {
    const duration = max;
    const base = emptyEdit(duration);
    const edit = clampEdit({
      ...base,
      trimStart: range.start,
      trimEnd: range.end,
      segments: [{ id: 'moment-clip', start: range.start, end: range.end }],
    }, 'moment');
    setTrimResult({ edit, category: 'moment' });
    navigation.pop();
  };

  const selectedSeconds = Math.max(0, range.end - range.start);

  return (
    <Screen
      scroll={false}
      footer={<Button title="Use this clip" icon="checkmark" onPress={useClip} />}
    >
      <Header
        title="Trim your Moment"
        subtitle="Choose the part you want to share."
        back
        onBack={() => navigation.pop()}
        right={<IconButton icon="close" label="Cancel clip trim" onPress={() => navigation.pop()} />}
      />
      <View style={{ flex: 1, justifyContent: 'center', gap: space.lg }}>
        <View style={{ width: '100%', aspectRatio: 9 / 16, maxHeight: 380, alignSelf: 'center', overflow: 'hidden', borderRadius: radius.xl, backgroundColor: '#000' }}>
          <VideoView
            player={player}
            style={{ width: '100%', height: '100%' }}
            contentFit="contain"
            nativeControls={false}
          />
          <View style={{ position: 'absolute', right: 12, bottom: 12 }}>
            <IconButton
              icon={playing ? 'pause' : 'play'}
              variant="glass"
              label={playing ? 'Pause preview' : 'Play preview'}
              onPress={() => {
                if (playing) player.pause();
                else {
                  if (player.currentTime < range.start || player.currentTime >= range.end) player.currentTime = range.start;
                  player.play();
                }
                setPlaying(!playing);
              }}
            />
          </View>
        </View>

        <View style={{ gap: space.sm }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Txt variant="bodyStrong">Clip length</Txt>
            <Txt variant="smallStrong" color="gold">
              {timeLabel(selectedSeconds)} / 1:00 max
            </Txt>
          </View>
          <ProgressBar
            value={Math.min(1, selectedSeconds / 60)}
            label={`Moment clip length, ${timeLabel(selectedSeconds)} of 1 minute`}
            style={{ height: 6 }}
          />
          <RangeSlider
            min={0}
            max={max}
            low={range.start}
            high={range.end}
            step={0.5}
            onChange={setWindow}
            label="Clip trim"
            formatValue={timeLabel}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Txt variant="caption" color="textMuted">In {timeLabel(range.start)}</Txt>
            <Txt variant="caption" color="textMuted">Out {timeLabel(range.end)}</Txt>
          </View>
          {total > 60 ? (
            <Txt variant="caption" color="textSecondary">
              The source is {timeLabel(total)} long. Choose any section up to one minute.
            </Txt>
          ) : null}
        </View>
      </View>
    </Screen>
  );
}
