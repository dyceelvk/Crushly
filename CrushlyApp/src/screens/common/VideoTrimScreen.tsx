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
import {
  MOMENT_CLIP_SECONDS,
  clampWindow,
  clipTimeLabel,
  openingWindow,
  pickerSeconds,
} from '../../lib/momentClip';
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

  /**
   * The length of the file, measured by the decoder.
   *
   * It used to start from `sourceDuration || 60` and fall back to `Math.max(1,…)`
   * while the decoder was still loading — so a picker that reported nothing (or
   * reported seconds as milliseconds) produced a *one-second* window over a
   * twenty-second clip, and the Moment that came out was one second long. Now the
   * screen waits for a real number, and the picker's number is only a hint that
   * has to pass `pickerSeconds` before it is believed.
   */
  const hint = pickerSeconds(sourceDuration) ?? null;
  const [total, setTotal] = useState(0);
  const [window, setWindow] = useState<{ start: number; end: number } | null>(null);
  const [playing, setPlaying] = useState(false);

  // Ask the decoder. The picker's hint is only used if the decoder never answers,
  // and even then it has to be a believable length before a window is opened.
  useEffect(() => {
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      const measured = Number(player.duration) || 0;
      if (measured > 0) {
        setTotal(measured);
        clearInterval(timer);
      } else if (tries >= 24) {
        if (hint) setTotal(hint);
        clearInterval(timer);
      }
    }, 250);
    return () => clearInterval(timer);
  }, [player, hint]);

  // Open on the whole clip — or its first 25 seconds — the moment it is known.
  const selected = window;
  useEffect(() => {
    if (!total || selected) return;
    const previous = initialEdit ? segmentsOf(initialEdit).pop() : null;
    if (initialEdit && previous && previous.end > previous.start) {
      setWindow(clampWindow(previous.start, previous.end, total));
      return;
    }
    setWindow(openingWindow(total));
  }, [total, selected, initialEdit]);

  useEffect(() => {
    if (!selected) return;
    player.pause();
    setPlaying(false);
    player.currentTime = selected.start;
  }, [player, selected?.start]);

  // Keep the preview inside the selected window while it plays.
  useEffect(() => {
    if (!playing || !selected) return;
    const timer = setInterval(() => {
      if (player.currentTime >= selected.end || player.currentTime < selected.start) {
        player.currentTime = selected.start;
        player.play();
      }
    }, 120);
    return () => clearInterval(timer);
  }, [player, playing, selected?.start, selected?.end]);

  const setRange = (low: number, high: number) => {
    if (!total) return;
    setWindow(clampWindow(low, high, total));
  };

  const useClip = () => {
    if (!total || !selected || selected.end <= selected.start) return;
    const edit = clampEdit({
      ...emptyEdit(total),
      trimStart: selected.start,
      trimEnd: selected.end,
      segments: [{ id: 'moment-clip', start: selected.start, end: selected.end }],
    }, 'moment');
    setTrimResult({ edit, category: 'moment' });
    navigation.pop();
  };

  const selectedSeconds = selected ? Math.max(0, selected.end - selected.start) : 0;
  const reading = !total || !selected;

  return (
    <Screen
      scroll={false}
      footer={
        <Button
          title={reading ? 'Reading your clip…' : 'Use this clip'}
          icon="checkmark"
          onPress={useClip}
          disabled={reading}
          loading={reading}
        />
      }
    >
      <Header
        title="Trim your Moment"
        subtitle={`Choose up to ${MOMENT_CLIP_SECONDS} seconds to share.`}
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
                if (reading || !selected) return;
                if (playing) player.pause();
                else {
                  if (player.currentTime < selected.start || player.currentTime >= selected.end) player.currentTime = selected.start;
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
              {clipTimeLabel(selectedSeconds)} / {clipTimeLabel(MOMENT_CLIP_SECONDS)} max
            </Txt>
          </View>
          <ProgressBar
            value={Math.min(1, selectedSeconds / MOMENT_CLIP_SECONDS)}
            label={`Moment clip length, ${clipTimeLabel(selectedSeconds)} of ${MOMENT_CLIP_SECONDS} seconds`}
            style={{ height: 6 }}
          />
          {selected ? (
            <>
              <RangeSlider
                min={0}
                max={total}
                low={selected.start}
                high={selected.end}
                step={0.5}
                onChange={setRange}
                label="Clip trim"
                formatValue={clipTimeLabel}
              />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Txt variant="caption" color="textMuted">In {clipTimeLabel(selected.start)}</Txt>
                <Txt variant="caption" color="textMuted">Out {clipTimeLabel(selected.end)}</Txt>
              </View>
              {total > MOMENT_CLIP_SECONDS ? (
                <Txt variant="caption" color="textSecondary">
                  The source is {clipTimeLabel(total)} long. Choose any {MOMENT_CLIP_SECONDS} seconds of it.
                </Txt>
              ) : null}
            </>
          ) : (
            <Txt variant="caption" color="textSecondary">
              Reading the clip’s length…
            </Txt>
          )}
        </View>
      </View>
    </Screen>
  );
}
