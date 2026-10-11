import React, { useEffect, useMemo, useState } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { useVideoPlayer } from 'expo-video';
import { VideoEditCanvas } from './VideoEditCanvas';
import { emptyEdit, type LiveEdit } from '../lib/videoEdit';

/**
 * A clip that has already been cut, played back with its live half on top.
 *
 * The file arrives already edited — the encoder wrote the trim, the speed, the
 * crop and the look into it on the phone. What is left to draw here is the part
 * that was deliberately kept out of the pixels: the words and the stickers,
 * which is why a caption can still be changed after posting.
 *
 * Used by Moments, Circles and Vibes alike.
 */
export function EditedClip({
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
  /** A full-screen player loops; a tile in a grid does not. */
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
