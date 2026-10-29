import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleProp, View, ViewStyle } from 'react-native';
import { useEvent } from 'expo';
import { useVideoPlayer } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
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
  loop = false,
  paused = false,
  contentFit = 'contain',
  controls = true,
  onTogglePlay,
}: {
  uri: string;
  live: LiveEdit | null;
  style?: StyleProp<ViewStyle>;
  autoPlay?: boolean;
  loop?: boolean;
  /** Pause playback (e.g. when a full-screen viewer is open on top). */
  paused?: boolean;
  /** 'contain' shows the full video without cropping; 'cover' fills the frame. */
  contentFit?: 'contain' | 'cover';
  /**
   * Draw the play/pause button. On by default: every place a clip is shown in
   * this app is a place somebody will want to stop it. Turn it off for an
   * embedded thumbnail where a button would just be clutter.
   */
  controls?: boolean;
  /**
   * Called when the viewer presses play/pause, so a parent that decides what
   * plays (the Vibe feed, which owns one clip per page) can stay the only
   * thing that decides. Without it, the button drives the player directly.
   */
  onTogglePlay?: () => void;
}) {
  const look = live?.look ?? NEUTRAL_LOOK;

  const player = useVideoPlayer(uri, (p) => {
    p.loop = loop ?? false;
  });

  // Music is a second player running alongside the clip, the same way it was
  // heard in the editor. Most clips have none, and then this costs nothing.
  const musicPlayer = useVideoPlayer(look.music?.uri ?? null, (p) => {
    p.loop = loop ?? false;
    p.volume = look.music?.volume ?? 0.6;
  });

  const [clipTime, setClipTime] = useState(0);

  // A press and the parent's `autoPlay` fight each other unless the press wins
  // for as long as it should. `held` is that: the viewer's choice, which the
  // parent's props cannot overwrite on the next render.
  const [held, setHeld] = useState<'playing' | 'paused' | null>(null);

  // `playing` is the truth from the player itself, not from our own bookkeeping
  // — a clip that ends, or that the OS stops, must show the right icon.
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player?.playing ?? false });

  const [ended, setEnded] = useState(false);
  useEffect(() => {
    if (!player) return;
    const sub = player.addListener('playToEnd', () => setEnded(true));
    return () => sub.remove();
  }, [player]);

  const playing = isPlaying && !ended;

  const toggle = useCallback(() => {
    if (!player) return;
    if (onTogglePlay) {
      onTogglePlay();
      return;
    }
    if (player.playing) {
      player.pause();
      musicPlayer?.pause();
      setHeld('paused');
    } else {
      // Pressing play on a finished clip starts it again rather than doing
      // nothing, which is what a viewer means by pressing play.
      if (ended) {
        player.currentTime = 0;
        setEnded(false);
      }
      player.play();
      if (look.music) musicPlayer?.play();
      setHeld('playing');
    }
  }, [player, musicPlayer, look.music, onTogglePlay, ended]);

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
    // Being paused by the screen outranks everything: nothing should be
    // audible behind a viewer or under a modal.
    if (paused || held === 'paused') {
      player.pause();
      if (look.music) musicPlayer?.pause();
      return;
    }
    if (held === 'playing' || autoPlay) {
      if (ended) return;
      player.play();
      if (look.music) musicPlayer?.play();
    }
  }, [player, musicPlayer, autoPlay, paused, look.music, held, ended]);

  // Always pause when the component unmounts so audio never leaks
  // into another screen (e.g. feed video under a post viewer).
  useEffect(() => {
    return () => {
      if (player) player.pause();
      if (musicPlayer) musicPlayer.pause();
    };
  }, [player, musicPlayer]);

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

  return (
    <View style={style}>
      <VideoEditCanvas player={player} edit={edit} clipTime={clipTime} style={{ flex: 1 }} contentFit={contentFit} />
      {controls ? (
        <Pressable
          onPress={toggle}
          accessibilityRole="button"
          accessibilityLabel={playing ? 'Pause clip' : 'Play clip'}
          // A corner button, not a sheet over the clip. In the Flow the whole
          // video is already a button that opens the post, and a full-cover
          // overlay here would silently win that tap — leaving people unable
          // to open a clip's post. Small, always visible, and it never
          // competes for the gesture the screen below already claimed.
          hitSlop={8}
          style={{
            position: 'absolute',
            right: 10,
            bottom: 10,
            width: 38,
            height: 38,
            borderRadius: 19,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.55)',
          }}
        >
          <Ionicons
            name={playing ? 'pause' : 'play'}
            size={19}
            color="#fff"
            style={playing ? undefined : { marginLeft: 2 }}
          />
        </Pressable>
      ) : null}
    </View>
  );
}
