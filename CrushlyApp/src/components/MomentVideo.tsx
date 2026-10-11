import React, { useEffect, useMemo, useState } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { useVideoPlayer } from 'expo-video';
import { VideoEditCanvas } from './VideoEditCanvas';
import { emptyEdit, type LiveEdit } from '../lib/videoEdit';

/**
 * A Moment that is a clip.
 *
 * The clip itself arrives already cut — the encoder wrote the trim, the speed,
 * the crop and the look into it on the phone. What is left to do here is draw
 * the half that was deliberately left out of the pixels: the words and the
 * stickers, which are why a caption can still be changed after posting.
 */
export function MomentVideo({
  uri,
  live,
  style,
  autoPlay = false,
  loop = true,
}: {
  uri: string;
  live: LiveEdit | null;
  style?: StyleProp<ViewStyle>;
  autoPlay?: boolean;
  /** The full-screen viewer loops; a tile in a grid does not. */
  loop?: boolean;
}) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = loop;
  });
  const [clipTime, setClipTime] = useState(0);

  // Only the live half is replayed here, so the edit is rebuilt from it and the
  // baked half stays at its defaults — nothing is graded or trimmed twice.
  const edit = useMemo(
    () => ({
      ...emptyEdit(0),
      captions: live?.captions ?? [],
      stickers: live?.stickers ?? [],
    }),
    [live],
  );

  useEffect(() => {
    if (!player) return;
    if (autoPlay) player.play();
  }, [player, autoPlay]);

  useEffect(() => {
    let raf = 0;
    let last = -1;
    const tick = () => {
      const t = player?.currentTime ?? 0;
      if (Math.abs(t - last) > 0.02) {
        last = t;
        setClipTime(t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [player]);

  return <VideoEditCanvas player={player} edit={edit} clipTime={clipTime} style={style} />;
}
