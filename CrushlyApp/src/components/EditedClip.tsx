import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleProp, View, ViewStyle } from 'react-native';
import { useEvent } from 'expo';
import { useVideoPlayer } from 'expo-video';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Txt } from './Txt';
import { VideoEditCanvas } from './VideoEditCanvas';
import { NEUTRAL_LOOK, emptyEdit, type LiveEdit } from '../lib/videoEdit';

/** What the clip team reports about itself once it has loaded. */
type Track = { width: number; height: number };

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
  controlPlacement = 'center',
  showSoundHint = false,
  muted = false,
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
   * Tap control. On by default: every place a clip is shown in this app is a
   * place somebody will want to stop it.
   */
  controls?: boolean;
  /**
   * Where the control lives.
   *
   * `center` — the whole clip is the tap target and the mark is drawn dead
   * centre. This is for a clip that is the point of the screen: the Post
   * Viewer, where nothing else competes for the tap.
   *
   * `corner` — a small button in the bottom corner. This is for a feed, where
   * the clip sits inside something that is already a button; a sheet over it
   * would silently swallow the tap that is supposed to open the post. It is
   * also where every feed puts it, for exactly that reason.
   */
  controlPlacement?: 'center' | 'corner';
  /**
   * Show a small "no sound" mark while playing. Only the feed wants this — it
   * is where a clip starts without being asked for, and there is otherwise no
   * way to tell whether a silent clip is silent or broken.
   */
  showSoundHint?: boolean;
  /**
   * Start silent, and let a tap on the clip bring the sound up.
   *
   * This is what a feed wants. A clip that begins playing unmuted without being
   * asked is the thing that makes people close an app. Muted playback is the
   * only kind a browser will allow unprompted anyway, so the same rule holds on
   * web and on a phone.
   */
  muted?: boolean;
  /**
   * Called when the viewer presses play/pause, so a parent that decides what
   * plays (the Vibe feed, which owns one clip per page) can stay the only
   * thing that decides. Without it, the tap drives the player directly.
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

  // Sound is its own decision, separate from playing. A viewer who unmutes one
  // clip has said something about that clip, not about the next one, so the
  // choice lives here and resets when the component does.
  const [soundOn, setSoundOn] = useState(!muted);

  // The truth from the player, not our own bookkeeping — a clip that ends, or
  // that the OS stops, must show the right icon.
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player?.playing ?? false });
  const [ended, setEnded] = useState(false);
  useEffect(() => {
    if (!player) return;
    const sub = player.addListener('playToEnd', () => setEnded(true));
    return () => sub.remove();
  }, [player]);
  const playing = isPlaying && !ended;

  /**
   * The clip's own shape.
   *
   * `contentFit="contain"` fits the picture inside whatever box it is given, so
   * a box of the wrong shape leaves bars down the sides — which is what "not
   * fit to the video dimension" means when you see it. The fix is to stop
   * guessing the box: the player reports the track's real size when the source
   * loads, and the frame is rebuilt to exactly that ratio. A 9:16 clip then
   * draws edge to edge in a 9:16 box, with nothing to letterbox.
   *
   * Until the track arrives the caller's frame is used, so there is no layout
   * jump beyond the one correction, and a still frame shows immediately.
   */
  const [track, setTrack] = useState<Track | null>(null);
  const [box, setBox] = useState<Track>({ width: 0, height: 0 });

  useEffect(() => {
    if (!player) return;
    // `VideoTrack.size` is where expo-video puts the real pixel dimensions.
    const read = (t: { size?: { width: number; height: number } } | null | undefined) => {
      const size = t?.size;
      if (size && size.width > 0 && size.height > 0) setTrack({ width: size.width, height: size.height });
    };
    const sub = player.addListener('sourceLoad', (payload) => read(payload.availableVideoTracks?.[0]));
    // A source that finished loading before this effect ran will never fire
    // `sourceLoad` again, so the current track is read once as well.
    read(player.videoTrack);
    return () => sub.remove();
  }, [player]);

  // Fit the reported ratio into the box the caller gave us. The smaller of the
  // two scales wins, so a portrait clip in a wide slot gets its full height and
  // centred sides rather than being cropped.
  const fitted = useMemo<ViewStyle | null>(() => {
    if (!track || !box.width || !box.height) return null;
    const scale = Math.min(box.width / track.width, box.height / track.height);
    return { width: Math.round(track.width * scale), height: Math.round(track.height * scale) };
  }, [track, box]);

  const toggle = useCallback(() => {
    if (!player) return;
    if (onTogglePlay) {
      onTogglePlay();
      return;
    }
    // The first tap on a muted clip brings the sound up rather than stopping
    // it: that is the thing the viewer is reaching for, and it is what the
    // "Tap for sound" mark just told them to do.
    if (muted && !soundOn) {
      setSoundOn(true);
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
  }, [player, musicPlayer, look.music, onTogglePlay, ended, muted, soundOn]);

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
    if (player) player.volume = soundOn ? look.clipVolume : 0;
  }, [player, look.clipVolume, soundOn]);

  useEffect(() => {
    if (musicPlayer && look.music) musicPlayer.volume = soundOn ? look.music.volume : 0;
  }, [musicPlayer, look.music, soundOn]);

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

  // Always pause when the component unmounts so audio never leaks into another
  // screen (e.g. feed video under a post viewer).
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
    <View
      style={[{ alignItems: 'center', justifyContent: 'center' }, style]}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setBox((b) => (b.width === width && b.height === height ? b : { width, height }));
      }}
    >
      <View style={fitted ?? { width: '100%', height: '100%' }}>
        <VideoEditCanvas
          player={player}
          edit={edit}
          clipTime={clipTime}
          style={{ flex: 1 }}
          contentFit={contentFit}
        />
      </View>

      {controls && controlPlacement === 'center' ? (
        // Whole-clip target, mark dead centre. Only where the clip is the
        // point of the screen — see `controlPlacement`.
        <Pressable
          onPress={toggle}
          accessibilityRole="button"
          accessibilityLabel={playing ? 'Pause clip' : 'Play clip'}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}
        >
          {!playing ? (
            <View
              pointerEvents="none"
              style={{
                width: 64,
                height: 64,
                borderRadius: 32,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(0,0,0,0.42)',
              }}
            >
              <Ionicons name="play" size={30} color="#fff" style={{ marginLeft: 4 }} />
            </View>
          ) : null}
        </Pressable>
      ) : null}

      {controls && controlPlacement === 'corner' ? (
        // A small button that never covers the middle of the clip, so a tap on
        // the picture still means "open this post".
        <Pressable
          onPress={toggle}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={playing ? 'Pause clip' : 'Play clip'}
          style={{
            position: 'absolute',
            right: 10,
            bottom: 10,
            width: 34,
            height: 34,
            borderRadius: 17,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.5)',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.22)',
          }}
        >
          <Ionicons
            name={playing ? 'pause' : 'play'}
            size={16}
            color="#fff"
            style={playing ? undefined : { marginLeft: 2 }}
          />
        </Pressable>
      ) : null}

      {/*
        Whether a clip has sound is not something the viewer can infer, and a
        clip that starts playing unmuted in a feed is a jump scare. The mark
        says which it is. It sits above the tap target and never takes a press.
      */}
      {showSoundHint && !soundOn ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            right: 10,
            bottom: controlPlacement === 'corner' ? 52 : 10,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: 999,
            backgroundColor: 'rgba(0,0,0,0.45)',
          }}
        >
          <Ionicons name="volume-mute" size={12} color="#fff" />
          <Txt variant="caption" color="#FFFFFF">
            Tap for sound
          </Txt>
        </View>
      ) : null}
    </View>
  );
}
