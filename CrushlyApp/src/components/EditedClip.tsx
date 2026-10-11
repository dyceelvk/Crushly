import React, { useEffect, useMemo, useState } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { useVideoPlayer } from 'expo-video';
import { VideoEditCanvas } from './VideoEditCanvas';
import { NEUTRAL_LOOK, emptyEdit, type LiveEdit } from '../lib/videoEdit';

/**
 * A clip with its live half drawn on top.
 *
 * The file arrives already cut — that one edit had to happen to the file itself,
 * because it is the only one that makes the clip smaller. Everything else is
 * drawn here: the words, the stickers, and the look — the filter, the light,
 * the shape of the frame, the speed and the sound.
 *
 * Drawing the look rather than baking it is what makes an edit survive at all on
 * a phone with no encoder. What you saw while editing is what everybody sees.
 *
 * Used by Flows, Moments, Circles and Vibes alike.
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
  const look = live?.look ?? NEUTRAL_LOOK;

  const player = useVideoPlayer(uri, (p) => {
    p.loop = loop;
  });

  // Music is a second player running alongside the clip, the same way it was
  // heard in the editor. Most clips have none, and then this costs nothing.
  const musicPlayer = useVideoPlayer(look.music?.uri ?? null, (p) => {
    p.loop = loop;
    p.volume = look.music?.volume ?? 0.6;
  });

  const [clipTime, setClipTime] = useState(0);

  // Only the live half is replayed here, so the edit is rebuilt from it and the
  // cut stays at its defaults — the file is already trimmed, and trimming it a
  // second time would cut into the part that was kept.
  const edit = useMemo(
    () => ({
      ...emptyEdit(0),
      captions: live?.captions ?? [],
      stickers: live?.stickers ?? [],
      filter: look.filter,
      brightness: look.brightness,
      contrast: look.contrast,
      saturation: look.saturation,
      aspect: look.aspect,
    }),
    [live, look.filter, look.brightness, look.contrast, look.saturation, look.aspect],
  );

  useEffect(() => {
    if (player) player.playbackRate = look.speed;
  }, [player, look.speed]);

  useEffect(() => {
    if (player) player.volume = look.clipVolume;
  }, [player, look.clipVolume]);

  useEffect(() => {
    if (musicPlayer && look.music) musicPlayer.volume = look.music.volume;
  }, [musicPlayer, look.music]);

  useEffect(() => {
    if (!player) return;
    if (autoPlay) {
      player.play();
      if (look.music) musicPlayer?.play();
    }
  }, [player, musicPlayer, autoPlay, look.music]);

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
