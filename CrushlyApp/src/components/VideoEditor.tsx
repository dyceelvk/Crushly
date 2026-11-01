import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer } from 'expo-video';
import * as DocumentPicker from 'expo-document-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VideoEditCanvas } from './VideoEditCanvas';
import { RangeSlider } from './Slider';
import { Segmented } from './Segmented';
import { Txt } from './Txt';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { Input } from './Input';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import { haptic } from '../lib/haptics';
import {
  ASPECTS,
  CAPTION_COLORS,
  CATEGORY_LABEL,
  CaptionAnimation,
  CaptionStyle,
  EDIT_LIMITS,
  EditCategory,
  FILTERS,
  FILTER_ORDER,
  SPEEDS,
  VideoEdit,
  clipLength,
  clampEdit,
  emptyEdit,
  exportEdit,
  formatTime,
  newCaption,
  newSticker,
  playbackLength,
  setTrim,
} from '../lib/videoEdit';

type ToolId = 'trim' | 'captions' | 'filters' | 'speed' | 'crop' | 'stickers' | 'music' | 'adjust';

const TOOLS: { id: ToolId; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'trim', label: 'Trim', icon: 'cut-outline' },
  { id: 'captions', label: 'Text', icon: 'text-outline' },
  { id: 'filters', label: 'Filters', icon: 'color-wand-outline' },
  { id: 'adjust', label: 'Adjust', icon: 'sunny-outline' },
  { id: 'speed', label: 'Speed', icon: 'speedometer-outline' },
  { id: 'crop', label: 'Crop', icon: 'crop-outline' },
  { id: 'stickers', label: 'Stickers', icon: 'happy-outline' },
  { id: 'music', label: 'Sound', icon: 'musical-notes-outline' },
];

const STICKERS = [
  '🔥', '💜', '😂', '🥹', '✨', '🩷', '👀', '🙌', '💯', '🌙',
  '☀️', '🍃', '🎧', '☕', '🕊️', '🐆', '🌊', '⭐', '🫶', '🎈',
];

const ANIMATIONS: { value: CaptionAnimation; label: string }[] = [
  { value: 'none', label: 'Still' },
  { value: 'fade', label: 'Fade' },
  { value: 'pop', label: 'Pop' },
  { value: 'slide', label: 'Slide' },
];

const CAPTION_STYLES: { value: CaptionStyle; label: string }[] = [
  { value: 'none', label: 'Plain' },
  { value: 'box', label: 'Box' },
  { value: 'outline', label: 'Outline' },
];

export type VideoEditorResult = { uri: string; edit: VideoEdit | null };

/**
 * The editor.
 *
 * Everything here works on the clip you picked rather than on a copy, which is
 * why it opens instantly and why you can come back and change your mind later.
 * The frame above is drawn by the same component the feed uses, so there is no
 * gap between the preview and what gets posted.
 *
 * The tools are the same set everywhere. Only the ceiling moves: a Moment is
 * capped at fifteen seconds, a Vibe at thirty, a Flow or a Circle at a minute.
 */
export function VideoEditorModal({
  visible,
  sourceUri,
  sourceDuration,
  category = 'post',
  naturalRatio = 9 / 16,
  initialTool,
  onCancel,
  onDone,
}: {
  visible: boolean;
  sourceUri: string | null;
  /** Seconds. Falls back to what the player reports if the picker didn't know. */
  sourceDuration?: number;
  category?: EditCategory;
  naturalRatio?: number;
  /** Tool to pre-select when the editor opens. */
  initialTool?: ToolId | null;
  onCancel: () => void;
  onDone: (result: VideoEditorResult) => void;
}) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { width: winW, height: winH } = useWindowDimensions();

  const [edit, setEdit] = useState<VideoEdit>(() => emptyEdit(sourceDuration ?? 0));
  const [clipTime, setClipTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [tool, setTool] = useState<ToolId | null>(initialTool ?? null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const player = useVideoPlayer(visible && sourceUri ? sourceUri : null, (p) => {
    p.loop = false;
  });
  const musicPlayer = useVideoPlayer(edit.music?.uri ?? null, (p) => {
    p.loop = true;
  });

  // A fresh clip resets everything: an edit belongs to one clip and one place.
  useEffect(() => {
    if (!visible) return;
    setEdit(emptyEdit(sourceDuration ?? 0));
    setClipTime(0);
    setPlaying(false);
    setTool(null);
    setSelectedId(null);
    setReady(false);
  }, [visible, sourceUri, sourceDuration]);

  // Some browsers will not read a video's length until it has been played once.
  // When that happens we take the length from the player as soon as it arrives.
  useEffect(() => {
    if (!visible || !player) return;
    let raf = 0;
    const poll = () => {
      const d = player.duration ?? 0;
      if (d > 0.2) {
        setReady(true);
        setEdit((e) =>
          Math.abs(e.sourceDuration - d) < 0.25
            ? e
            : clampEdit({ ...e, sourceDuration: d, trimEnd: Math.min(e.trimEnd || d, d) }, category),
        );
        return;
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [visible, player, category]);

  // The driver. Keeps the playhead inside the trim window, loops it there, and
  // reports clip time for the overlays to follow.
  useEffect(() => {
    if (!visible) return;
    let raf = 0;
    let last = -1;
    const tick = () => {
      const p = player;
      if (p) {
        const t = p.currentTime ?? 0;
        if (t < edit.trimStart - 0.06 || t >= edit.trimEnd - 0.02) {
          p.currentTime = edit.trimStart;
          if (last !== 0) {
            last = 0;
            setClipTime(0);
          }
        } else {
          const next = t - edit.trimStart;
          if (Math.abs(next - last) > 0.02) {
            last = next;
            setClipTime(next);
          }
        }
        if (p.playing !== playing) setPlaying(p.playing);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [visible, player, edit.trimStart, edit.trimEnd, playing]);

  useEffect(() => {
    if (player) player.playbackRate = edit.speed;
  }, [player, edit.speed]);

  useEffect(() => {
    if (player) player.volume = edit.clipVolume;
  }, [player, edit.clipVolume]);

  useEffect(() => {
    if (musicPlayer && edit.music) musicPlayer.volume = edit.music.volume;
  }, [musicPlayer, edit.music]);

  const total = edit.sourceDuration || 0;
  const length = clipLength(edit);
  const limit = EDIT_LIMITS[category];

  const seek = (clipSeconds: number) => {
    const t = Math.min(Math.max(clipSeconds, 0), length);
    if (player) player.currentTime = edit.trimStart + t;
    setClipTime(t);
  };

  const togglePlay = () => {
    if (!player) return;
    if (player.playing) {
      player.pause();
      if (edit.music) musicPlayer?.pause();
    } else {
      const t = player.currentTime ?? 0;
      if (t < edit.trimStart || t >= edit.trimEnd - 0.02) player.currentTime = edit.trimStart;
      player.play();
      if (edit.music) musicPlayer?.play();
    }
    haptic.tap();
    setPlaying(!player.playing);
  };

  const update = (next: VideoEdit) => setEdit(clampEdit(next, category));

  const pickMusic = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets?.length) return;
      const asset = res.assets[0];
      update({
        ...edit,
        music: {
          id: asset.uri,
          title: asset.name ?? 'Your sound',
          uri: asset.uri,
          volume: 0.6,
          offset: 0,
        },
      });
    } catch {
      /* The picker was dismissed or refused; nothing to do. */
    }
  };

  const selectedCaption = edit.captions.find((c) => c.id === selectedId) ?? null;
  const selectedSticker = edit.stickers.find((s) => s.id === selectedId) ?? null;

  // Size the frame to the crop, then shrink it if it would crowd the tools.
  const availW = Math.min(winW - space.lg * 2, 520);
  const availH = Math.max(180, winH * 0.4);
  const ratio = edit.aspect === 'original' ? naturalRatio : (ASPECTS[edit.aspect].ratio ?? naturalRatio);
  let frameW = availW;
  let frameH = frameW / ratio;
  if (frameH > availH) {
    frameH = availH;
    frameW = frameH * ratio;
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
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
          <IconButton icon="close" label="Discard edits" variant="plain" color="#fff" onPress={onCancel} />
          {/* The bar reads left to right the way an editor does: out, what it
              is, and how much of it you have used. Export is the only thing on
              the right, because it is the only thing you cannot undo. */}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt variant="subheading" style={{ color: '#fff' }} accessibilityRole="header" numberOfLines={1}>
              {CATEGORY_LABEL[category]}
            </Txt>
            <Txt variant="caption" style={{ color: '#8b8b95' }} numberOfLines={1}>
              {`${formatTime(clipTime)} / ${formatTime(length)}  ·  ${Math.round((length / Math.max(0.1, limit.maxSeconds)) * 100)}%`}
            </Txt>
          </View>
          <Button
            title="Export"
            size="sm"
            variant="primary"
            onPress={() => {
              if (!sourceUri) return;
              haptic.success();
              onDone(exportEdit(sourceUri, edit, category));
            }}
            accessibilityLabel="Keep this edit"
          />
        </View>

        {/* The stage. Nothing on it but the frame and the play control — an
            editor should look like the thing being edited. */}
        <View style={{ alignItems: 'center', paddingHorizontal: space.md, paddingTop: space.xs }}>
          <View style={{ width: frameW, height: frameH }}>
            <VideoEditCanvas
              player={player}
              edit={edit}
              clipTime={clipTime}
              naturalRatio={naturalRatio}
              interactive
              selectedId={selectedId}
              onSelect={setSelectedId}
              onMoveCaption={(id, x, y) =>
                update({ ...edit, captions: edit.captions.map((c) => (c.id === id ? { ...c, x, y } : c)) })
              }
              onMoveSticker={(id, x, y) =>
                update({ ...edit, stickers: edit.stickers.map((s) => (s.id === id ? { ...s, x, y } : s)) })
              }
              style={{ width: frameW, height: frameH, borderRadius: radius.md }}
            />
            {/* Tapping the picture is play/pause, the way it is in every editor
                people already know. */}
            <Pressable
              onPress={togglePlay}
              accessibilityRole="button"
              accessibilityLabel={playing ? 'Pause preview' : 'Play preview'}
              style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}
            >
              {!playing ? (
                <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: 'rgba(8,8,10,0.55)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' }}>
                  <Ionicons name="play" size={24} color="#fff" style={{ marginLeft: 3 }} />
                </View>
              ) : null}
            </Pressable>
          </View>
          <Txt variant="caption" style={{ color: ready ? '#7c7c86' : '#9a9aa2', marginTop: 4 }}>
            {limit.note}
          </Txt>
        </View>

        {/* The timeline: a strip of the clip with the part you kept lit, a
            playhead, and handles you can drag. Above it a ruler, because "one
            third of the way in" is a place, and a percentage is not. */}
        <ClipTimeline
          total={total}
          start={edit.trimStart}
          end={edit.trimEnd}
          playhead={edit.trimStart + clipTime}
          onSeek={(t) => seek(t - edit.trimStart)}
          onTrim={(nextStart, nextEnd) =>
            update({ ...edit, trimStart: nextStart, trimEnd: Math.max(nextStart + 0.4, nextEnd) })
          }
        />

        {/* The sheet for whichever tool is open, directly above the rail. */}
        <View
          style={{
            flex: 1,
            minHeight: 0,
            backgroundColor: '#141418',
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
          }}
        >
          {tool === null ? (
            <View style={{ padding: space.lg, gap: 10 }}>
              <Txt variant="bodyStrong" style={{ color: '#fff' }}>
                Pick a tool to start
              </Txt>
              <Txt variant="small" style={{ color: '#9a9aa2' }}>
                Drag anything on the frame to move it. Everything you do here can be changed later —
                nothing is written into the clip.
              </Txt>
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={{
                padding: space.md,
                paddingBottom: insets.bottom + space.xxl,
                gap: space.md,
              }}
              keyboardShouldPersistTaps="handled"
            >
              {tool === 'trim' ? (
                <TrimPanel edit={edit} total={total} category={category} update={update} />
              ) : null}
              {tool === 'captions' ? (
                <CaptionsPanel
                  edit={edit}
                  caption={selectedCaption}
                  onSelect={setSelectedId}
                  update={update}
                  colors={colors}
                  category={category}
                />
              ) : null}
              {tool === 'filters' ? <FiltersPanel edit={edit} update={update} /> : null}
              {tool === 'adjust' ? <AdjustPanel edit={edit} update={update} /> : null}
              {tool === 'speed' ? <SpeedPanel edit={edit} update={update} /> : null}
              {tool === 'crop' ? <CropPanel edit={edit} update={update} /> : null}
              {tool === 'stickers' ? (
                <StickersPanel
                  edit={edit}
                  sticker={selectedSticker}
                  onSelect={setSelectedId}
                  update={update}
                  category={category}
                />
              ) : null}
              {tool === 'music' ? (
                <MusicPanel edit={edit} update={update} onPick={pickMusic} />
              ) : null}
            </ScrollView>
          )}
        </View>

        {/* The tool rail. One row, icon over name, the way the apps people
            already edit in lay it out — and the panel for the chosen tool
            opens directly above it, so the finger never has to travel. */}
        <View style={{ borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' }}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: space.md, paddingVertical: space.sm, gap: 4 }}
          >
            {TOOLS.map((t) => {
              const active = tool === t.id;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => {
                    haptic.tap();
                    setTool(active ? null : t.id);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={t.label}
                  style={{ alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 10, minWidth: 62, borderRadius: radius.md }}
                >
                  <View
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 17,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: active ? colors.gold : 'rgba(255,255,255,0.07)',
                    }}
                  >
                    <Ionicons name={t.icon} size={17} color={active ? colors.onGold : '#e8e8ee'} />
                  </View>
                  <Txt variant="caption" style={{ color: active ? colors.gold : '#9a9aa2' }} maxFontSizeMultiplier={1.2}>
                    {t.label}
                  </Txt>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* Add text bar below tabs */}
        {tool !== 'captions' && edit.captions.length < EDIT_LIMITS[category].maxCaptions ? (
          <View
            style={{
              paddingHorizontal: space.md,
              paddingVertical: space.sm,
              gap: 6,
            }}
          >
            <Button
              title="Add text"
              icon="add"
              size="sm"
              variant="secondary"
              onPress={() => {
                const c = newCaption(edit, clipTime);
                update({ ...edit, captions: [...edit.captions, c] });
                setSelectedId(c.id);
                setTool('captions');
              }}
              accessibilityLabel="Add caption text"
            />
          </View>
        ) : null}

        {/* What the web build cannot do, said once, quietly, at the bottom —
            not a banner on top of the picture you are trying to edit. */}
        {Platform.OS === 'web' ? <WebEditorNotice /> : null}

        <View style={{ height: insets.bottom + space.sm }} />
      </View>
    </Modal>
  );
}

/**
 * The clip, drawn as a piece of time.
 *
 * A slider says "somewhere in the middle"; a timeline says *where*, and how much
 * you kept. The strip is the whole clip, the lit window is what survives the
 * trim, and the two handles are the only decisions that matter in this tool.
 *
 * Drag the body to scrub, drag a handle to move the cut. Both are rounded to a
 * tenth of a second, because nobody trims to the millisecond and a number that
 * jitters is a number nobody trusts.
 */
function ClipTimeline({
  total,
  start,
  end,
  playhead,
  onSeek,
  onTrim,
}: {
  total: number;
  start: number;
  end: number;
  playhead: number;
  onSeek: (seconds: number) => void;
  onTrim: (start: number, end: number) => void;
}) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const live = useRef({ total, start, end, width, onSeek, onTrim });
  live.current = { total, start, end, width, onSeek, onTrim };
  const grab = useRef<{ kind: 'body' | 'left' | 'right'; startX: number; from: number; to: number } | null>(null);

  const pct = (t: number) => (live.current.total > 0 ? Math.min(1, Math.max(0, t / live.current.total)) : 0);
  const snap = (t: number) => Math.round(t * 10) / 10;

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e: { nativeEvent: { locationX: number } }) => {
        const { width: w, total: tt, start: a, end: b, onSeek: seek } = live.current;
        if (!w || !tt) return;
        const x = e.nativeEvent.locationX;
        // Within 18 px of a handle, that handle is what you grabbed.
        const leftPx = pct(a) * w;
        const rightPx = pct(b) * w;
        const kind = Math.abs(x - leftPx) <= 18 ? 'left' : Math.abs(x - rightPx) <= 18 ? 'right' : 'body';
        grab.current = { kind, startX: x, from: a, to: b };
        if (kind === 'body') seek(snap((x / w) * tt));
      },
      onPanResponderMove: (e: { nativeEvent: { locationX: number } }) => {
        const g = grab.current;
        const { width: w, total: tt, start: a, end: b, onTrim: trim, onSeek: seek } = live.current;
        if (!g || !w || !tt) return;
        const dx = ((e.nativeEvent.locationX - g.startX) / w) * tt;
        if (g.kind === 'left') {
          trim(snap(Math.min(Math.max(0, g.from + dx), b - 0.4)), b);
        } else if (g.kind === 'right') {
          trim(a, snap(Math.min(Math.max(a + 0.4, g.to + dx), tt)));
        } else {
          seek(snap(Math.min(Math.max(g.from, (e.nativeEvent.locationX / w) * tt), tt)));
        }
      },
      onPanResponderRelease: () => {
        grab.current = null;
      },
      onPanResponderTerminate: () => {
        grab.current = null;
      },
    }),
  ).current;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(total * f));

  return (
    <View style={{ paddingHorizontal: space.md, paddingTop: space.sm, gap: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {ticks.map((t, i) => (
          <Txt key={i} variant="caption" style={{ color: '#63636d', fontSize: 10 }}>
            {formatTime(t)}
          </Txt>
        ))}
      </View>
      <View
        {...responder.panHandlers}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        accessibilityLabel="Timeline. Drag to scrub, drag the handles to trim."
        style={{ height: 46, borderRadius: radius.sm, backgroundColor: '#17171c', overflow: 'hidden', justifyContent: 'center' }}
      >
        {width > 0 ? (
          <>
            {/* The whole clip, unlit. */}
            <View style={{ position: 'absolute', left: 0, right: 0, height: 34, backgroundColor: '#202027' }} />
            {/* What survived the trim. */}
            <View
              style={{
                position: 'absolute',
                left: pct(start) * width,
                width: Math.max(2, (pct(end) - pct(start)) * width),
                height: 34,
                backgroundColor: colors.goldSoft,
                borderColor: colors.gold,
                borderTopWidth: 1.5,
                borderBottomWidth: 1.5,
              }}
            />
            {/* The two things you can grab. */}
            {[pct(start), pct(end)].map((x, i) => (
              <View
                key={i}
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: Math.min(Math.max(0, x * width - 4), width - 8),
                  width: 8,
                  height: 34,
                  backgroundColor: colors.gold,
                  borderRadius: 3,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <View style={{ width: 1.5, height: 12, backgroundColor: 'rgba(0,0,0,0.35)' }} />
              </View>
            ))}
            {/* The playhead. */}
            <View
              pointerEvents="none"
              style={{ position: 'absolute', left: Math.min(Math.max(0, pct(playhead) * width - 1), width - 2), width: 2, height: 46, backgroundColor: '#fff', borderRadius: 1 }}
            />
          </>
        ) : null}
      </View>
    </View>
  );
}

/**
 * On the web every tool here works, but the clip that gets posted is the one
 * you picked — the encoder that makes a trimmed clip genuinely smaller lives in
 * the app. Rather than quietly offering less, we say so and point at the app.
 */
function WebEditorNotice() {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel="Install Crushly on Android"
      onPress={() => {
        haptic.tap();
        Linking.openURL('/download/').catch(() => undefined);
      }}
      style={{
        marginHorizontal: space.md,
        marginTop: space.xs,
        paddingHorizontal: space.sm,
        paddingVertical: 8,
        borderRadius: radius.sm,
        backgroundColor: 'rgba(255,255,255,0.04)',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <Ionicons name="download-outline" size={13} color={colors.gold} />
      <Txt variant="caption" style={{ color: '#9a9aa2', flex: 1 }} numberOfLines={2} maxFontSizeMultiplier={1.2}>
        Trimming, text and sound are applied in the app. Install Crushly to cut the actual clip.
      </Txt>
      <Ionicons name="chevron-forward" size={13} color="#63636d" />
    </Pressable>
  );
}

function PanelNote({ children }: { children: React.ReactNode }) {
  return (
    <Txt variant="small" style={{ color: '#8d8d97' }}>
      {children}
    </Txt>
  );
}

function TrimPanel({
  edit,
  total,
  category,
  update,
}: {
  edit: VideoEdit;
  total: number;
  category: EditCategory;
  update: (e: VideoEdit) => void;
}) {
  const limit = EDIT_LIMITS[category];
  return (
    <>
      <RangeSlider
        min={0}
        max={Math.max(1, total)}
        low={edit.trimStart}
        high={edit.trimEnd}
        step={0.1}
        onChange={(l, h) => update(setTrim(edit, l, h, category))}
        label="Start and end"
        formatValue={(v) => `${formatTime(v)}s`}
      />
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Button
          title="Use everything"
          size="sm"
          variant="secondary"
          full={false}
          onPress={() => update(setTrim(edit, 0, total || limit.maxSeconds, category))}
        />
        <Button
          title={`First ${Math.min(limit.maxSeconds, Math.round(total))}s`}
          size="sm"
          variant="secondary"
          full={false}
          onPress={() =>
            update(setTrim(edit, 0, Math.min(limit.maxSeconds, total || limit.maxSeconds), category))
          }
        />
        <Button
          title="Last 5s"
          size="sm"
          variant="secondary"
          full={false}
          onPress={() => update(setTrim(edit, Math.max(0, total - 5), total || 5, category))}
        />
      </View>
      <PanelNote>
        Keeping {formatTime(clipLength(edit))} of {formatTime(total)}. Trimmed-away video is hidden, not
        deleted, so you can always widen it again.
      </PanelNote>
    </>
  );
}

function CaptionsPanel({
  edit,
  caption,
  onSelect,
  update,
  colors,
  category,
}: {
  edit: VideoEdit;
  caption: VideoEdit['captions'][number] | null;
  onSelect: (id: string | null) => void;
  update: (e: VideoEdit) => void;
  colors: ReturnType<typeof useTheme>['colors'];
  category: EditCategory;
}) {
  const limit = EDIT_LIMITS[category].maxCaptions;
  const width = clipLength(edit);

  return (
    <>
      <Button
        title="Add text"
        icon="add"
        size="sm"
        variant="secondary"
        onPress={() => {
          const c = newCaption(edit, 0);
          update({ ...edit, captions: [...edit.captions, c] });
          onSelect(c.id);
        }}
        disabled={edit.captions.length >= limit}
      />
      {edit.captions.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {edit.captions.map((c, i) => {
            const active = caption?.id === c.id;
            return (
              <Pressable
                key={c.id}
                onPress={() => onSelect(c.id)}
                accessibilityRole="button"
                accessibilityLabel={`Caption ${i + 1}`}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: active ? colors.gold : 'rgba(255,255,255,0.18)',
                  maxWidth: 160,
                }}
              >
                <Txt variant="small" numberOfLines={1} style={{ color: active ? colors.gold : '#d8d8e0' }}>
                  {c.text || `Text ${i + 1}`}
                </Txt>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : (
        <PanelNote>Words on the screen. Drag to place them.</PanelNote>
      )}

      {caption ? (
        <View style={{ gap: space.md }}>
          <Input
            label="Your words"
            value={caption.text}
            onChangeText={(text) =>
              update({
                ...edit,
                captions: edit.captions.map((c) => (c.id === caption.id ? { ...c, text } : c)),
              })
            }
            placeholder="Say it here"
            maxLength={120}
          />

          <View style={{ gap: 8 }}>
            <Txt variant="label" style={{ color: '#9a9aa2' }}>
              Colour
            </Txt>
            <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
              {CAPTION_COLORS.map((c) => (
                <Pressable
                  key={c}
                  onPress={() =>
                    update({
                      ...edit,
                      captions: edit.captions.map((x) => (x.id === caption.id ? { ...x, color: c } : x)),
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Colour ${c}`}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    backgroundColor: c,
                    borderWidth: caption.color === c ? 2 : 1,
                    borderColor: caption.color === c ? colors.gold : 'rgba(255,255,255,0.25)',
                  }}
                />
              ))}
            </View>
          </View>

          <Segmented<CaptionStyle>
            options={CAPTION_STYLES}
            value={caption.style}
            onChange={(style) =>
              update({
                ...edit,
                captions: edit.captions.map((c) => (c.id === caption.id ? { ...c, style } : c)),
              })
            }
          />
          <Segmented<CaptionAnimation>
            options={ANIMATIONS}
            value={caption.animation}
            onChange={(animation) =>
              update({
                ...edit,
                captions: edit.captions.map((c) => (c.id === caption.id ? { ...c, animation } : c)),
              })
            }
          />

          <RangeSlider
            min={0.02}
            max={0.12}
            low={caption.size}
            step={0.005}
            onChange={(v) =>
              update({ ...edit, captions: edit.captions.map((c) => (c.id === caption.id ? { ...c, size: v } : c)) })
            }
            label="Size"
            formatValue={(v) => `${Math.round(v * 1000)}`}
          />

          <RangeSlider
            min={0}
            max={Math.max(0.2, width)}
            low={caption.start}
            high={caption.end}
            step={0.1}
            onChange={(l, h) =>
              update({
                ...edit,
                captions: edit.captions.map((c) => (c.id === caption.id ? { ...c, start: l, end: h } : c)),
              })
            }
            label="On screen from"
            formatValue={(v) => `${v.toFixed(1)}s`}
          />

          <Button
            title="Delete this text"
            size="sm"
            variant="danger"
            icon="trash-outline"
            onPress={() => {
              update({ ...edit, captions: edit.captions.filter((c) => c.id !== caption.id) });
              onSelect(null);
            }}
          />
        </View>
      ) : null}
    </>
  );
}

function FiltersPanel({ edit, update }: { edit: VideoEdit; update: (e: VideoEdit) => void }) {
  const { colors } = useTheme();
  return (
    <>
      <PanelNote>Tap a look. These sit over the clip, so they never damage the picture underneath.</PanelNote>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
        {FILTER_ORDER.map((id) => {
          const f = FILTERS[id];
          const active = edit.filter === id;
          return (
            <Pressable
              key={id}
              onPress={() => {
                haptic.tap();
                update({ ...edit, filter: id });
              }}
              accessibilityRole="button"
              accessibilityLabel={`Filter ${f.label}`}
              style={{ alignItems: 'center', gap: 6, width: 68 }}
            >
              <View
                style={{
                  width: 62,
                  height: 62,
                  borderRadius: 12,
                  overflow: 'hidden',
                  borderWidth: active ? 2 : 1,
                  borderColor: active ? colors.gold : 'rgba(255,255,255,0.18)',
                  backgroundColor: '#3a3a44',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <View
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: f.tint ?? 'transparent',
                    opacity: f.tint ? Math.max(0.5, f.tintOpacity) : 0,
                  }}
                />
              </View>
              <Txt variant="caption" style={{ color: active ? colors.gold : '#b9b9c4' }} numberOfLines={1}>
                {f.label}
              </Txt>
            </Pressable>
          );
        })}
      </ScrollView>
    </>
  );
}

function AdjustPanel({ edit, update }: { edit: VideoEdit; update: (e: VideoEdit) => void }) {
  return (
    <>
      <PanelNote>
        Light and colour. On the web these are true grades; on the phone they are drawn over the clip.
      </PanelNote>
      <RangeSlider
        min={-1}
        max={1}
        low={edit.brightness}
        step={0.02}
        onChange={(v) => update({ ...edit, brightness: v })}
        label="Brightness"
        formatValue={(v) => `${Math.round(v * 100)}`}
      />
      <RangeSlider
        min={-1}
        max={1}
        low={edit.contrast}
        step={0.02}
        onChange={(v) => update({ ...edit, contrast: v })}
        label="Contrast"
        formatValue={(v) => `${Math.round(v * 100)}`}
      />
      <RangeSlider
        min={-1}
        max={1}
        low={edit.saturation}
        step={0.02}
        onChange={(v) => update({ ...edit, saturation: v })}
        label="Saturation"
        formatValue={(v) => `${Math.round(v * 100)}`}
      />
      <Button
        title="Reset light and colour"
        size="sm"
        variant="secondary"
        onPress={() => update({ ...edit, brightness: 0, contrast: 0, saturation: 0, filter: 'none' })}
      />
    </>
  );
}

function SpeedPanel({ edit, update }: { edit: VideoEdit; update: (e: VideoEdit) => void }) {
  return (
    <>
      <Segmented<string>
        options={SPEEDS.map((s) => ({ value: String(s), label: `${s}×` }))}
        value={String(edit.speed)}
        onChange={(v) => update({ ...edit, speed: Number(v) })}
      />
      <PanelNote>
        At {edit.speed}× the clip runs for {formatTime(playbackLength(edit))} on screen. Sound is left at
        normal pitch where the device allows it.
      </PanelNote>
    </>
  );
}

function CropPanel({ edit, update }: { edit: VideoEdit; update: (e: VideoEdit) => void }) {
  const ids = Object.keys(ASPECTS) as (keyof typeof ASPECTS)[];
  return (
    <>
      <Segmented<string>
        options={ids.map((id) => ({ value: id, label: ASPECTS[id].label }))}
        value={edit.aspect}
        onChange={(v) => update({ ...edit, aspect: v as VideoEdit['aspect'] })}
      />
      <PanelNote>Cropping only changes the frame — nothing is cut out of your clip.</PanelNote>
    </>
  );
}

function StickersPanel({
  edit,
  sticker,
  onSelect,
  update,
  category,
}: {
  edit: VideoEdit;
  sticker: VideoEdit['stickers'][number] | null;
  onSelect: (id: string | null) => void;
  update: (e: VideoEdit) => void;
  category: EditCategory;
}) {
  const width = clipLength(edit);
  const limit = EDIT_LIMITS[category].maxStickers;
  const full = edit.stickers.length >= limit;
  return (
    <>
      <PanelNote>
        {full
          ? `That’s the lot — ${limit} stickers on ${CATEGORY_LABEL[category]}. Remove one to add another.`
          : 'Tap to add, then drag it anywhere on the frame.'}
      </PanelNote>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {STICKERS.map((g) => (
          <Pressable
            key={g}
            onPress={() => {
              if (full) return;
              const s = newSticker(edit, g, 0);
              update({ ...edit, stickers: [...edit.stickers, s] });
              onSelect(s.id);
              haptic.tap();
            }}
            disabled={full}
            accessibilityRole="button"
            accessibilityState={{ disabled: full }}
            accessibilityLabel={full ? `Sticker limit reached` : `Add sticker ${g}`}
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              backgroundColor: 'rgba(255,255,255,0.08)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Txt style={{ fontSize: 22 }}>{g}</Txt>
          </Pressable>
        ))}
      </View>

      {sticker ? (
        <View style={{ gap: space.md }}>
          <RangeSlider
            min={0.4}
            max={2.4}
            low={sticker.scale}
            step={0.05}
            onChange={(v) =>
              update({ ...edit, stickers: edit.stickers.map((s) => (s.id === sticker.id ? { ...s, scale: v } : s)) })
            }
            label="Size"
            formatValue={(v) => `${Math.round(v * 100)}%`}
          />
          <RangeSlider
            min={-180}
            max={180}
            low={sticker.rotation}
            step={1}
            onChange={(v) =>
              update({ ...edit, stickers: edit.stickers.map((s) => (s.id === sticker.id ? { ...s, rotation: v } : s)) })
            }
            label="Rotation"
            formatValue={(v) => `${Math.round(v)}°`}
          />
          <RangeSlider
            min={0}
            max={Math.max(0.2, width)}
            low={sticker.start}
            high={sticker.end}
            step={0.1}
            onChange={(l, h) =>
              update({
                ...edit,
                stickers: edit.stickers.map((s) => (s.id === sticker.id ? { ...s, start: l, end: h } : s)),
              })
            }
            label="On screen from"
            formatValue={(v) => `${v.toFixed(1)}s`}
          />
          <Button
            title="Remove sticker"
            size="sm"
            variant="danger"
            icon="trash-outline"
            onPress={() => {
              update({ ...edit, stickers: edit.stickers.filter((s) => s.id !== sticker.id) });
              onSelect(null);
            }}
          />
        </View>
      ) : null}
    </>
  );
}

function MusicPanel({
  edit,
  update,
  onPick,
}: {
  edit: VideoEdit;
  update: (e: VideoEdit) => void;
  onPick: () => void;
}) {
  return (
    <>
      {edit.music ? (
        <View style={{ gap: space.md }}>
          <Txt variant="bodyStrong" style={{ color: '#fff' }} numberOfLines={1}>
            {edit.music.title}
          </Txt>
          <RangeSlider
            min={0}
            max={1}
            low={edit.music.volume}
            step={0.02}
            onChange={(v) => update({ ...edit, music: { ...edit.music!, volume: v } })}
            label="Music volume"
            formatValue={(v) => `${Math.round(v * 100)}%`}
          />
          <Button
            title="Use a different sound"
            size="sm"
            variant="secondary"
            onPress={onPick}
          />
          <Button
            title="Remove sound"
            size="sm"
            variant="danger"
            icon="trash-outline"
            onPress={() => update({ ...edit, music: null })}
          />
        </View>
      ) : (
        <Button title="Add sound from your device" icon="musical-notes-outline" size="sm" variant="secondary" onPress={onPick} />
      )}

      <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.1)' }} />

      <RangeSlider
        min={0}
        max={1}
        low={edit.clipVolume}
        step={0.02}
        onChange={(v) => update({ ...edit, clipVolume: v })}
        label="Clip's own sound"
        formatValue={(v) => (v === 0 ? 'Muted' : `${Math.round(v * 100)}%`)}
      />
      <PanelNote>
        Music you add plays over the clip. Only add sound you have the right to use.
      </PanelNote>
    </>
  );
}
