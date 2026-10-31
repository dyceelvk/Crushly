import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleProp, View, ViewStyle } from 'react-native';
import { useVideoPlayer, type VideoPlayer } from 'expo-video';
import { VideoEditCanvas } from './VideoEditCanvas';
import { PlayPauseFlash } from './PlayPauseFlash';
import { NEUTRAL_LOOK, emptyEdit, type LiveEdit } from '../lib/videoEdit';
import { frameHeight, videoFrame, videoRatio } from '../lib/videoFrame';
import { registerPlayer, releaseFocus, takeFocus } from '../lib/playerFocus';
import { useTheme } from '../theme/ThemeProvider';

/** Width ÷ height of a local file, read off a hidden <video> on the web. */
function useWebRatio(uri: string | null | undefined): number | null {
  const [ratio, setRatio] = useState<number | null>(null);

  useEffect(() => {
    setRatio(null);
    if (Platform.OS !== 'web' || !uri || typeof document === 'undefined') return;
    const el = document.createElement('video');
    el.preload = 'metadata';
    el.muted = true;
    el.src = uri;
    const read = () => setRatio(videoRatio({ width: el.videoWidth, height: el.videoHeight }));
    el.addEventListener('loadedmetadata', read);
    if (el.readyState >= 1) read();
    return () => {
      el.removeEventListener('loadedmetadata', read);
      el.removeAttribute('src');
      el.load();
    };
  }, [uri]);

  return ratio;
}

/**
 * The native player knows its track only once it has loaded; there is no event to
 * subscribe to that fires for every source, so this asks on a slow interval and
 * stops asking the moment it gets an answer.
 */
function useNativeRatio(player: VideoPlayer | null, alreadyKnown: boolean): number | null {
  const [ratio, setRatio] = useState<number | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web' || !player || alreadyKnown) return;
    const ask = () => {
      const size = player.videoTrack?.size;
      const next = videoRatio({ width: size?.width, height: size?.height });
      if (next) {
        setRatio(next);
        return true;
      }
      return false;
    };
    if (ask()) return;
    const id = setInterval(() => {
      if (ask()) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [player, alreadyKnown]);

  return ratio;
}

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
 *
 * Two things it now owns that it did not before:
 *
 * * **Its own frame.** It measures the source and shapes the box to match, so a
 *   landscape clip is a landscape box rather than a portrait one it has to be
 *   crushed into. See `lib/videoFrame.ts`.
 * * **Its own controls.** Unless `controls` is false, a tap toggles play/pause and
 *   the state is shown. A video that cannot be paused, and cannot say whether it
 *   is playing, is not a video — it is an animation.
 */
export function EditedClip({
  uri,
  live,
  style,
  autoPlay = false,
  loop = true,
  controls = false,
  fill = false,
  maxHeight,
  fallbackRatio = 4 / 5,
  onDoubleTap,
  accessibilityLabel,
}: {
  uri: string;
  live: LiveEdit | null;
  style?: StyleProp<ViewStyle>;
  autoPlay?: boolean;
  /** A full-screen player loops; a tile in a grid does not. */
  loop?: boolean;
  /** Tap to play/pause, with the state drawn. Off for decorative tiles. */
  controls?: boolean;
  /**
   * The caller has already decided the box (a full-screen stage, a tile in a
   * grid). The clip then fills it and letterboxes inside it rather than shaping
   * itself — the opposite of the feed, where the frame must follow the file.
   */
  fill?: boolean;
  /**
   * Ceiling on the frame's height. The frame keeps its shape and narrows instead
   * of being squashed into a shorter box — clamping the height alone would turn a
   * 9:16 clip into a 0.67 box and letterbox it with black columns.
   */
  maxHeight?: number;
  /** Frame to hold before the source reports its shape. */
  fallbackRatio?: number;
  /** Double tap, for players that keep the "double tap to react" gesture. */
  onDoubleTap?: () => void;
  accessibilityLabel?: string;
}) {
  const look = live?.look ?? NEUTRAL_LOOK;
  const { reduceMotion } = useTheme();

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
  const [playing, setPlaying] = useState(false);

  const webRatio = useWebRatio(uri);
  const nativeRatio = useNativeRatio(player, webRatio != null);
  const frame = videoFrame({ measured: webRatio ?? nativeRatio, aspect: look.aspect, fallback: fallbackRatio });

  // The frame must know its width before it can honour `maxHeight` without
  // changing its shape, so the wrapper measures itself once.
  const [available, setAvailable] = useState(0);
  const box = useMemo(() => {
    if (fill) return { width: '100%' as const, height: '100%' as const };
    if (!available) return { width: '100%' as const, aspectRatio: frame.ratio };
    const h = frameHeight(frame.ratio, available, maxHeight);
    return { width: Math.min(available, h * frame.ratio), height: h };
  }, [fill, available, frame.ratio, maxHeight]);

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
      // One clip holds the sound. Claiming it pauses every other clip that is
      // already playing, so a feed cannot talk over itself.
      takeFocus(player);
      player.play();
      setPlaying(true);
      if (look.music) musicPlayer?.play();
    } else {
      releaseFocus(player);
      player.pause();
      setPlaying(false);
      musicPlayer?.pause();
    }
  }, [player, musicPlayer, autoPlay, look.music]);

  /**
   * Play/pause.
   *
   * `player.playing` is the truth, not a flag of ours: playback can stop on its
   * own (the end of a non-looping clip, a decoder stall), and a local boolean
   * would keep saying "playing" while the picture sat still.
   */
  const toggle = () => {
    if (!player) return;
    if (player.playing) {
      player.pause();
      musicPlayer?.pause();
      setPlaying(false);
      return;
    }
    // Pressing play is a claim on the sound, so the rest of the feed goes quiet.
    takeFocus(player);
    player.play();
    musicPlayer?.play();
    setPlaying(true);
  };

  // A double tap must not also register as a single tap; the gesture is decided
  // by waiting out the double-tap window once, not by firing both.
  const lastTap = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTap = () => {
    if (!onDoubleTap) {
      toggle();
      return;
    }
    const now = Date.now();
    if (now - lastTap.current < 300) {
      lastTap.current = 0;
      if (tapTimer.current) clearTimeout(tapTimer.current);
      onDoubleTap();
      return;
    }
    lastTap.current = now;
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => toggle(), 300);
  };
  useEffect(() => () => { if (tapTimer.current) clearTimeout(tapTimer.current); }, []);

  // A player that leaves the screen stops being a candidate for the sound.
  useEffect(() => {
    if (!player) return;
    const unregister = registerPlayer(player);
    return () => {
      unregister();
    };
  }, [player]);

  useEffect(() => {
    let raf = 0;
    let last = -1;
    const tick = () => {
      const t = player?.currentTime ?? 0;
      if (Math.abs(t - last) > 0.02) {
        last = t;
        setClipTime(t);
      }
      // The player is the source of truth for whether the picture is moving;
      // this keeps the disc honest when playback stops without a tap.
      const isPlaying = player?.playing ?? false;
      setPlaying((prev) => (prev === isPlaying ? prev : isPlaying));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [player]);

  return (
    <View
      onLayout={fill ? undefined : (e) => {
        const w = e.nativeEvent.layout.width;
        setAvailable((prev) => (Math.abs(prev - w) > 0.5 ? w : prev));
      }}
      style={[
        // The frame is the picture's shape, so `contain` fills it exactly and
        // `cover` only ever appears because the creator chose a crop. A `fill`
        // caller has its own box and must keep it, and centres what it draws.
        fill ? { alignItems: 'center', justifyContent: 'center' } : { alignSelf: 'center', overflow: 'hidden', backgroundColor: '#000' },
        box,
        style,
      ]}
      accessible={!controls}
      accessibilityLabel={!controls ? accessibilityLabel : undefined}
    >
      <VideoEditCanvas
        player={player}
        edit={edit}
        clipTime={clipTime}
        naturalRatio={frame.ratio}
        // A chosen shape crops, and the canvas honours it; otherwise the box and
        // the picture already agree and `contain` simply fills.
        fit={fill ? 'contain' : frame.fit}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      {controls ? (
        <PlayPauseFlash playing={playing} onPress={onTap} reduced={reduceMotion} label={accessibilityLabel} />
      ) : null}
    </View>
  );
}
