import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, StyleProp, View, ViewStyle } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useVideoPlayer, type VideoPlayer, type VideoSource } from 'expo-video';
import { VideoEditCanvas } from './VideoEditCanvas';
import { PlayPauseFlash } from './PlayPauseFlash';
import { NEUTRAL_LOOK, emptyEdit, type LiveEdit } from '../lib/videoEdit';
import { followCuts } from '../lib/timeline';
import { VideoView } from 'expo-video';
import { frameHeight, leavesBands, stageFit, videoFrame, videoRatio, type StageFit } from '../lib/videoFrame';
import { registerPlayer, releaseFocus, takeFocus } from '../lib/playerFocus';
import { useTheme } from '../theme/ThemeProvider';
import { mediaSource } from '../lib/mediaHost';
import { mediaUrl } from '../api/client';

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
 * Used by Flows, Moments and Circles alike.
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
/** The URL inside a source, whatever shape the caller handed over. */
function sourceUrl(source: VideoSource): string {
  if (typeof source === 'string') return source;
  if (source && typeof source === 'object' && 'uri' in source) return source.uri ?? '';
  return '';
}

/**
 * Where a clip's soundtrack actually is.
 *
 * Before posting, the editor holds a file URI from this phone. After posting, it
 * holds the path of the uploaded track — private, like the clip beside it, and
 * only readable through the media Worker with the member's token. A player given
 * the bare path would ask the app's own origin for it and get nothing, which is
 * one way a posted clip ends up silent.
 */
function musicSourceOf(music: LiveEdit['look']['music']): VideoSource | null {
  if (!music?.uri) return null;
  if (/^(https?:|file:|content:|blob:|data:|ph:|assets-library:)/i.test(music.uri)) {
    return music.uri;
  }
  return mediaSource(mediaUrl(music.uri));
}

export function EditedClip({
  uri,
  live,
  style,
  autoPlay = false,
  holdToPause = false,
  loop = true,
  controls = false,
  fill = false,
  fit,
  maxHeight,
  fallbackRatio = 4 / 5,
  muted = false,
  maxMs,
  onDoubleTap,
  accessibilityLabel,
  cornerControl,
}: {
  /**
   * The clip. A plain URL for a local file, or `{ uri, headers }` for anything
   * behind the media Worker — which is every clip a member posts. Passing the
   * bare URL of a private file got a 401 and drew a black rectangle, which is
   * exactly what the feed showed: dark, and no amount of tapping helped.
   */
  uri: VideoSource;
  live: LiveEdit | null;
  style?: StyleProp<ViewStyle>;
  autoPlay?: boolean;
  /** Hold the picture to pause it, let go to carry on. */
  holdToPause?: boolean;
  /** A full-screen player loops; a tile in a grid does not. */
  loop?: boolean;
  /**
   * Tap to play/pause, with the state drawn. Off for decorative tiles.
   *
   * `'corner'` puts the control in a disc at the bottom-right instead of over the
   * whole picture — for a card that is itself a button, where the whole surface
   * has to keep meaning "open this".
   */
  controls?: boolean | 'corner';
  /**
   * The caller has already decided the box (a full-screen stage, a tile in a
   * grid). The clip then fills it and letterboxes inside it rather than shaping
   * itself — the opposite of the feed, where the frame must follow the file.
   */
  fill?: boolean;
  /**
   * How the picture sits in a `fill` box, and therefore what the leftover space
   * is made of. Only the full-screen stage passes this; a tile never has space
   * left over. See `stageFit` in `lib/videoFrame.ts` for why `'fit'` is the
   * default and why it is not the same thing as a black letterbox.
   */
  fit?: StageFit;
  /**
   * Ceiling on the frame's height. The frame keeps its shape and narrows instead
   * of being squashed into a shorter box — clamping the height alone would turn a
   * 9:16 clip into a 0.67 box and letterbox it with black columns.
   */
  maxHeight?: number;
  /** Frame to hold before the source reports its shape. */
  fallbackRatio?: number;
  /**
   * Silent.
   *
   * A feed previews a clip the way a shop window previews a film: moving
   * pictures, no soundtrack, and the sound only once somebody chooses it. It is
   * also the only way a browser lets a clip start by itself at all — an unmuted
   * autoplay is blocked outright, so a preview would simply sit still on the
   * web.
   */
  muted?: boolean;
  /**
   * Play at most this long, then go back to the start.
   *
   * A nine-second preview of a post is not the same thing as ninety seconds of
   * somebody's clip: the card is a doorway, so it shows the beginning of the
   * thing and starts again rather than playing the whole of it in a 9:16 box that
   * was never meant to hold a whole clip.
   */
  maxMs?: number;
  /** Double tap, for players that keep the "double tap to react" gesture. */
  onDoubleTap?: () => void;
  accessibilityLabel?: string;
  /** Optional control rendered inside the frame where the corner player control sits. */
  cornerControl?: React.ReactNode;
}) {
  const look = live?.look ?? NEUTRAL_LOOK;
  const { reduceMotion } = useTheme();

  const player = useVideoPlayer(uri, (p) => {
    p.loop = loop;
  });

  // Music is a second player running alongside the clip, the same way it was
  // heard in the editor. Most clips have none, and then this costs nothing.
  const musicPlayer = useVideoPlayer(musicSourceOf(look.music), (p) => {
    p.loop = loop;
    p.volume = look.music?.volume ?? 0.6;
  });

  const [clipTime, setClipTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  // A clip whose file could not be cut carries its pieces instead. The player
  // then has to skip what was cut away, or everybody watching would see the
  // part its author removed.
  const cuts = live?.cuts && live.cuts.length ? live.cuts : null;

  const webRatio = useWebRatio(sourceUrl(uri));
  const nativeRatio = useNativeRatio(player, webRatio != null);
  const frame = videoFrame({ measured: webRatio ?? nativeRatio, aspect: look.aspect, fallback: fallbackRatio });

  // The frame must know its width before it can honour `maxHeight` without
  // changing its shape, so the wrapper measures itself once.
  const [available, setAvailable] = useState(0);
  // The stage needs both sides of its box to know whether the picture will leave
  // bands in it; a feed card only ever needs the width.
  const [boxH, setBoxH] = useState(0);
  const box = useMemo(() => {
    if (fill) return { width: '100%' as const, height: '100%' as const };
    if (!available) return { width: '100%' as const, aspectRatio: frame.ratio };
    const h = frameHeight(frame.ratio, available, maxHeight);
    return { width: Math.min(available, h * frame.ratio), height: h };
  }, [fill, available, frame.ratio, maxHeight]);

  // What the stage does with a picture that is not its own shape.
  const stage = fill ? stageFit(fit) : null;
  const bands = !!stage && stage.backdrop &&
    leavesBands(available && boxH ? available / boxH : null, frame.ratio);

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
    if (player) player.muted = muted;
  }, [player, muted]);

  /**
   * The preview cap.
   *
   * Checked on a slow timer rather than by watching `currentTime`, because the
   * timer only has to be right to within a frame or two and a per-frame callback
   * per card is a per-frame callback per card. Seeking to zero rather than
   * pausing keeps a preview alive while the reader looks at it.
   */
  useEffect(() => {
    if (!player || !maxMs) return;
    const tick = setInterval(() => {
      const seconds = player.currentTime ?? 0;
      if (seconds * 1000 >= maxMs) {
        try { player.currentTime = 0; } catch { /* not seekable yet */ }
      }
    }, 250);
    return () => clearInterval(tick);
  }, [player, maxMs]);

  useEffect(() => {
    if (musicPlayer && look.music) musicPlayer.volume = look.music.volume;
  }, [musicPlayer, look.music]);

  /**
   * Off-screen means silent.
   *
   * A clip that is playing when you open a chat, tap a profile or put the phone
   * in your pocket should not keep talking from somewhere behind the screen. So
   * the rule is: play only while this clip's screen is the one in front of you
   * *and* the app is in the foreground. Coming back resumes it, because the
   * reason it stopped was that you left, not that you wanted it stopped.
   */
  const onScreen = useIsFocused();
  const [foreground, setForeground] = useState(() => (AppState.currentState ?? 'active') === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => sub.remove();
  }, []);
  const allowed = autoPlay && onScreen && foreground;
  // Delayed taps/holds must not restart a clip after its page has moved away.
  const allowedRef = useRef(allowed);
  allowedRef.current = allowed;

  useEffect(() => {
    if (!player) return;
    if (allowed) {
      // One clip holds the sound. Claiming it pauses every other clip that is
      // already playing, so a feed cannot talk over itself.
      takeFocus(player);
      player.play();
      setPlaying(true);
      if (look.music && !muted) musicPlayer?.play();
      else musicPlayer?.pause();
    } else {
      releaseFocus(player);
      player.pause();
      setPlaying(false);
      musicPlayer?.pause();
    }
  }, [player, musicPlayer, allowed, look.music, muted]);

  /**
   * Play/pause.
   *
   * `player.playing` is the truth, not a flag of ours: playback can stop on its
   * own (the end of a non-looping clip, a decoder stall), and a local boolean
   * would keep saying "playing" while the picture sat still.
   */
  const toggle = () => {
    if (!player || !allowedRef.current) return;
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

  /**
   * Hold to pause, let go to carry on.
   *
   * A long press is not a second kind of tap — it is the same hand staying put.
   * After 220 ms of contact the clip pauses where it is; lifting the finger
   * starts it again, and no toggle fires, because the hold already answered the
   * question the tap would have asked.
   */
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef<boolean | null>(null);
  const onHoldStart = () => {
    if (!holdToPause) return;
    holdTimer.current = setTimeout(() => {
      if (!player) return;
      held.current = player.playing;
      if (player.playing) {
        player.pause();
        musicPlayer?.pause();
      }
    }, 220);
  };
  const onHoldEnd = () => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    if (held.current === null) return;
    const wasPlaying = held.current;
    held.current = null;
    if (wasPlaying && allowedRef.current) {
      takeFocus(player!);
      player?.play();
      musicPlayer?.play();
    }
    // Swallow the tap that follows a hold.
    if (tapTimer.current) {
      clearTimeout(tapTimer.current);
      tapTimer.current = null;
    }
    lastTap.current = 0;
  };
  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
    },
    [],
  );

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
    // A frame-by-frame JS loop ran for every mounted clip, even when paused.
    // The native player renders video independently; JS only needs periodic
    // updates for overlays, controls and cut boundaries.
    let last = -1;
    const tick = () => {
      const raw = player?.currentTime ?? 0;
      let t = raw;
      if (cuts) {
        const step = followCuts(cuts, raw, loop);
        if (step.seekTo !== null) player!.currentTime = step.seekTo;
        if (step.ended) player!.pause();
        t = step.cut;
      }
      if (Math.abs(t - last) > 0.02) {
        last = t;
        setClipTime(t);
      }
      const isPlaying = player?.playing ?? false;
      setPlaying((prev) => (prev === isPlaying ? prev : isPlaying));
    };
    tick();
    const timer = setInterval(tick, cuts ? 50 : 200);
    return () => clearInterval(timer);
  }, [player, cuts, loop]);

  return (
    <View
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        setAvailable((prev) => (Math.abs(prev - w) > 0.5 ? w : prev));
        setBoxH((prev) => (Math.abs(prev - h) > 0.5 ? h : prev));
      }}
      style={[
        // The frame is the picture's shape, so `contain` fills it exactly and
        // `cover` only ever appears because the creator chose a crop. A `fill`
        // caller has its own box and must keep it, and centres what it draws.
        fill ? { alignItems: 'center', justifyContent: 'center' } : { alignSelf: 'center', overflow: 'hidden', backgroundColor: '#000' },
        box,
        style,
      ]}
      accessible={!controls && !cornerControl}
      accessibilityLabel={!controls && !cornerControl ? accessibilityLabel : undefined}
    >
      <VideoEditCanvas
        backdrop={bands && Platform.OS === 'web' ? <BackdropClip source={uri} active={allowed && playing} /> : null}
        player={player}
        edit={edit}
        clipTime={clipTime}
        naturalRatio={frame.ratio}
        // A chosen shape crops, and the canvas honours it; otherwise the box and
        // the picture already agree and `contain` simply fills.
        fit={stage ? stage.contentFit : frame.fit}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      {cornerControl}
      {controls ? (
        <PlayPauseFlash
          playing={playing}
          onPress={onTap}
          onPressIn={onHoldStart}
          onPressOut={onHoldEnd}
          reduced={reduceMotion}
          inline={controls === 'corner'}
          compact={controls === 'corner'}
          label={accessibilityLabel}
        />
      ) : null}
    </View>
  );
}

/**
 * The band above and below a clip that is not the screen's shape.
 *
 * It used to be black, and black is what made a landscape clip look like a fault
 * rather than a frame. This is the same clip again — its own muted player, blown
 * up to cover the stage, softened — so the space around the picture is still the
 * picture. Slow, low-detail frames; nothing is asked of it except colour.
 *
 * It has no sound to take, so it is not registered with the focus system. It
 * follows the foreground clip and pauses as soon as its page is inactive.
 */
function BackdropClip({ source, active }: { source: VideoSource; active: boolean }) {
  const player = useVideoPlayer(source, (p) => {
    p.loop = true;
    p.muted = true;
  });

  useEffect(() => {
    if (active) player?.play();
    else player?.pause();
  }, [player, active]);

  return (
    <VideoView
      player={player}
      style={[
        { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' },
        // The phone has no cheap blur on a video surface, so it is faked the
        // other way round: oversized and dim, which reads as light rather than
        // detail. The web does it properly.
        Platform.OS === 'web'
          ? ({ filter: 'blur(30px) saturate(1.15)', transform: [{ scale: 1.15 }], opacity: 0.6 } as ViewStyle)
          : ({ transform: [{ scale: 1.4 }], opacity: 0.42 } as ViewStyle),
      ]}
      contentFit="cover"
      nativeControls={false}
      pointerEvents="none"
    />
  );
}

