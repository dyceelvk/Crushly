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
import { Timeline, TimelineOverlay } from './Timeline';
import { Rise } from './Rise';
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
  duplicatePiece,
  emptyEdit,
  exportEdit,
  formatTime,
  movePiece,
  newCaption,
  newSticker,
  playbackLength,
  removePiece,
  segmentsOf,
  setTrim,
  sourceTimeAt,
  splitEdit,
  trimPiece,
} from '../lib/videoEdit';
import {
  HISTORY_LIMIT,
  History,
  canRedo,
  canUndo,
  depth,
  record,
  redo,
  startHistory,
  undo,
} from '../lib/editHistory';
import { lengthOf, locate } from '../lib/timeline';
import { TRAVEL } from '../lib/motion';

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

  // Every change goes through the history, so there is always a way back and
  // no control has to know about it.
  const [history, setHistory] = useState<History<VideoEdit>>(() => startHistory(emptyEdit(sourceDuration ?? 0)));
  const edit = history.present;
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
    setHistory(startHistory(emptyEdit(sourceDuration ?? 0)));
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
        setHistory((h) => {
          const e = h.present;
          if (Math.abs(e.sourceDuration - d) < 0.25) return h;
          // The length arriving late must not count as an edit somebody made.
          const grown = clampEdit({ ...e, sourceDuration: d }, category);
          return { ...h, present: grown };
        });
        return;
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [visible, player, category]);

  // The driver.
  //
  // The player only knows the file; the timeline is a set of pieces of that
  // file laid end to end. So each frame asks: which piece is this frame in, and
  // how far into the made clip does that put us? When the frame falls inside a
  // piece we have thrown away, the playhead is pushed to the start of the next
  // piece — which is what makes a cut play as a cut rather than as a skip.
  useEffect(() => {
    if (!visible) return;
    let raf = 0;
    let last = -1;
    const tick = () => {
      const p = player;
      if (p) {
        const pieces = segmentsOf(edit);
        const total = clipLength(edit);
        const t = p.currentTime ?? 0;
        let cut = 0;

        // Walk the pieces to find the one this frame belongs to.
        let walked = 0;
        let placed = false;
        for (let i = 0; i < pieces.length; i++) {
          const piece = pieces[i];
          const len = lengthOf(piece);
          if (t >= piece.start - 0.06 && t < piece.end - 0.02) {
            cut = walked + Math.max(0, t - piece.start);
            placed = true;
            break;
          }
          if (t < piece.start - 0.06) {
            // The frame is in a gap — jump to the beginning of this piece.
            p.currentTime = piece.start;
            cut = walked;
            placed = true;
            break;
          }
          walked += len;
        }

        if (!placed) {
          // Past the end of the last piece: back to the top, like a loop.
          const first = pieces[0];
          if (first && (t >= pieces[pieces.length - 1].end - 0.02 || t < first.start)) {
            if (playing) p.currentTime = first.start;
            cut = 0;
          } else {
            cut = Math.min(total, walked);
          }
        }

        if (Math.abs(cut - last) > 0.02) {
          last = cut;
          setClipTime(cut);
        }
        if (p.playing !== playing) setPlaying(p.playing);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [visible, player, edit, playing]);

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

  /** Move the playhead to a point in the made clip. */
  const seek = (cutSeconds: number) => {
    const t = Math.min(Math.max(cutSeconds, 0), length);
    if (player) player.currentTime = sourceTimeAt(edit, t);
    setClipTime(t);
  };

  const togglePlay = () => {
    if (!player) return;
    if (player.playing) {
      player.pause();
      if (edit.music) musicPlayer?.pause();
    } else {
      if (clipTime >= length - 0.02) seek(0);
      player.play();
      if (edit.music) musicPlayer?.play();
    }
    haptic.tap();
    setPlaying(!player.playing);
  };

  /**
   * Every change to the edit goes through here.
   *
   * `mergeKey` names gestures that arrive as many updates — a dragged handle, a
   * slider — so they become one undo step rather than forty. Anything discrete
   * passes nothing and gets its own step.
   */
  const update = (next: VideoEdit, mergeKey: string | null = null) => {
    setHistory((h) => record(h, clampEdit(next, category), mergeKey));
  };

  const stepBack = () => {
    setHistory((h) => undo(h));
    haptic.tap();
  };
  const stepForward = () => {
    setHistory((h) => redo(h));
    haptic.tap();
  };

  // Cut operations. They act on the selected piece, or on the playhead, which
  // is the only other place a cut can mean anything.
  const selectedPiece = segmentsOf(edit).find((p) => p.id === selectedId) ?? null;
  const playheadIndex = locate(segmentsOf(edit), clipTime)?.index ?? 0;
  const pieceCount = segmentsOf(edit).length;

  // What the second lane draws: everything written over the picture, in the
  // same cut seconds the timeline works in.
  const timelineOverlays: TimelineOverlay[] = [
    ...edit.captions.map((c) => ({
      id: c.id,
      kind: 'caption' as const,
      start: c.start,
      end: c.end,
      label: c.text.trim() || 'Text',
    })),
    ...edit.stickers.map((k) => ({
      id: k.id,
      kind: 'sticker' as const,
      start: k.start,
      end: k.end,
      label: k.glyph,
    })),
  ];

  const splitNow = () => {
    const next = splitEdit(edit, clipTime, category);
    if (next === edit) {
      haptic.tap();
      return;
    }
    update(next);
    haptic.success();
  };

  const deletePieceNow = () => {
    if (pieceCount < 2) return;
    const target = selectedPiece ?? segmentsOf(edit)[playheadIndex];
    if (!target) return;
    update(removePiece(edit, target.id, category));
    setSelectedId(null);
    haptic.tap();
  };

  const duplicateNow = () => {
    const target = selectedPiece ?? segmentsOf(edit)[playheadIndex];
    if (!target) return;
    update(duplicatePiece(edit, target.id, category));
    haptic.success();
  };

  const moveNow = (by: -1 | 1) => {
    const target = selectedPiece ?? segmentsOf(edit)[playheadIndex];
    if (!target) return;
    update(movePiece(edit, target.id, by, category));
    haptic.tap();
  };

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
  // The stage gets a third of the screen, not half. The timeline, the cut bar
  // and the tool sheet all live below it now, and a preview that eats the room
  // the controls need is how the last version ended up with a rail on top of a
  // sheet.
  const availH = Math.max(150, winH * 0.33);
  const ratio = edit.aspect === 'original' ? naturalRatio : (ASPECTS[edit.aspect].ratio ?? naturalRatio);
  let frameW = availW;
  let frameH = frameW / ratio;
  if (frameH > availH) {
    frameH = availH;
    frameW = frameH * ratio;
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
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
          <IconButton icon="close" label="Discard edits" variant="plain" color={colors.text} onPress={onCancel} />
          {/* The bar reads left to right the way an editor does: out, what it
              is, and how much of it you have used. Export is the only thing on
              the right, because it is the only thing you cannot undo. */}
          <IconButton
            icon="arrow-undo"
            label={`Undo${canUndo(history) ? `, ${depth(history).undo} step${depth(history).undo === 1 ? '' : 's'}` : ''}`}
            variant="plain"
            color={canUndo(history) ? colors.text : colors.textMuted}
            onPress={() => {
              if (canUndo(history)) stepBack();
            }}
          />
          <IconButton
            icon="arrow-redo"
            label="Redo"
            variant="plain"
            color={canRedo(history) ? colors.text : colors.textMuted}
            onPress={() => {
              if (canRedo(history)) stepForward();
            }}
          />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt variant="subheading" style={{ color: colors.text }} accessibilityRole="header" numberOfLines={1}>
              {CATEGORY_LABEL[category]}
            </Txt>
            <Txt variant="caption" style={{ color: colors.textSecondary }} numberOfLines={1}>
              {`${clock(clipTime)} / ${clock(length)}  ·  ${pieceCount === 1 ? '1 piece' : `${pieceCount} pieces`}`}
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
                update(
                  { ...edit, captions: edit.captions.map((c) => (c.id === id ? { ...c, x, y } : c)) },
                  `caption-move-${id}`,
                )
              }
              onMoveSticker={(id, x, y) =>
                update(
                  { ...edit, stickers: edit.stickers.map((s) => (s.id === id ? { ...s, x, y } : s)) },
                  `sticker-move-${id}`,
                )
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
          <Txt variant="caption" style={{ color: ready ? colors.textMuted : colors.textSecondary, marginTop: 4 }}>
            {limit.note}
          </Txt>
        </View>

        {/* The timeline, and the five things you can do to a piece of it. The
            bar is directly under the lanes because a cut is a decision about
            what is in front of you, and the tool sheet below is a decision
            about how it looks. */}
        <Timeline
          pieces={segmentsOf(edit)}
          duration={length}
          playhead={clipTime}
          overlays={timelineOverlays}
          selectedId={selectedId}
          onSeek={seek}
          onSelect={setSelectedId}
          onTrim={(id, start, end) => update(trimPiece(edit, id, start, end, category), 'trim')}
        />

        <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: space.md, paddingTop: space.sm }}>
          <CutChip icon="cut" label="Split" onPress={splitNow} />
          <CutChip icon="copy-outline" label="Copy" onPress={duplicateNow} />
          <CutChip
            icon="trash-outline"
            label="Delete"
            disabled={pieceCount < 2}
            onPress={deletePieceNow}
          />
          <CutChip icon="chevron-back" label="Earlier" compact disabled={pieceCount < 2} onPress={() => moveNow(-1)} />
          <CutChip icon="chevron-forward" label="Later" compact disabled={pieceCount < 2} onPress={() => moveNow(1)} />
        </View>

        {/* The sheet for whichever tool is open, directly above the rail. */}
        <View
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
            backgroundColor: colors.bgSecondary,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
          }}
        >
          {tool === null ? (
            <View style={{ paddingHorizontal: space.md, paddingTop: space.sm }}>
              <Txt variant="small" style={{ color: colors.textSecondary }} numberOfLines={2}>
                Split at the playhead, then drag a piece's ends to trim it. Nothing here is final —
                Undo is the arrow at the top.
              </Txt>
            </View>
          ) : (
            <Rise key={tool} distance={TRAVEL.card}>
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
            </Rise>
          )}
        </View>

        {/* The tool rail. One row, icon over name, the way the apps people
            already edit in lay it out — and the panel for the chosen tool
            opens directly above it, so the finger never has to travel. */}
        <View style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
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
                      backgroundColor: active ? colors.gold : colors.elevated,
                    }}
                  >
                    <Ionicons name={t.icon} size={17} color={active ? colors.onGold : colors.textSecondary} />
                  </View>
                  <Txt variant="caption" style={{ color: active ? colors.gold : colors.textSecondary }} maxFontSizeMultiplier={1.2}>
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
 * One cut action, as a chip.
 *
 * Five of these fit on one row of a phone, which is the whole reason they are
 * chips and not a menu: split, copy, delete and the two moves are used together
 * and often, and anything behind a long press may as well not exist.
 */
/** Minutes and seconds only — the subtitle has one line and Export sits on it. */
function clock(seconds: number): string {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function CutChip({
  icon,
  label,
  onPress,
  disabled,
  compact,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Icon only: the two moves sit beside three words and a row has to fit. */
  compact?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={() => {
        if (disabled) return;
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: compact ? 10 : 10,
        height: 32,
        borderRadius: 16,
        backgroundColor: disabled ? colors.bgSecondary : colors.elevated,
      }}
    >
      <Ionicons name={icon} size={14} color={disabled ? colors.textMuted : colors.textSecondary} />
      {compact ? null : (
        <Txt variant="caption" style={{ color: disabled ? colors.textMuted : colors.textSecondary }} maxFontSizeMultiplier={1.2}>
          {label}
        </Txt>
      )}
    </Pressable>
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
        backgroundColor: colors.bgSecondary,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <Ionicons name="download-outline" size={13} color={colors.gold} />
      <Txt variant="caption" style={{ color: colors.textSecondary, flex: 1 }} numberOfLines={2} maxFontSizeMultiplier={1.2}>
        Trimming, text and sound are applied in the app. Install Crushly to cut the actual clip.
      </Txt>
      <Ionicons name="chevron-forward" size={13} color={colors.textMuted} />
    </Pressable>
  );
}

function PanelNote({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <Txt variant="small" style={{ color: colors.textSecondary }}>
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
  update: (e: VideoEdit, mergeKey?: string | null) => void;
}) {
  const limit = EDIT_LIMITS[category];
  const pieces = segmentsOf(edit).length;
  return (
    <>
      <RangeSlider
        min={0}
        max={Math.max(1, total)}
        low={edit.trimStart}
        high={edit.trimEnd}
        step={0.1}
        onChange={(l, h) => update(setTrim(edit, l, h, category), 'trim')}
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
        {pieces > 1
          ? `Keeping ${formatTime(clipLength(edit))} of ${formatTime(total)} in ${pieces} pieces. These handles move the two outer ends; the cuts you made in between stay where you put them.`
          : `Keeping ${formatTime(clipLength(edit))} of ${formatTime(total)}. Trimmed-away video is hidden, not deleted, so you can always widen it again — and Split on the timeline cuts the middle out.`}
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
                  borderColor: active ? colors.gold : colors.borderStrong,
                  maxWidth: 160,
                }}
              >
                <Txt variant="small" numberOfLines={1} style={{ color: active ? colors.gold : colors.text }}>
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
            <Txt variant="label" style={{ color: colors.textSecondary }}>
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
                    borderColor: caption.color === c ? colors.gold : colors.borderStrong,
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
                  borderColor: active ? colors.gold : colors.borderStrong,
                  backgroundColor: colors.bgSecondary,
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
              <Txt variant="caption" style={{ color: active ? colors.gold : colors.textSecondary }} numberOfLines={1}>
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
  const { colors } = useTheme();
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
              backgroundColor: colors.elevated,
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
  const { colors } = useTheme();
  return (
    <>
      {edit.music ? (
        <View style={{ gap: space.md }}>
          <Txt variant="bodyStrong" style={{ color: colors.text }} numberOfLines={1}>
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

      <View style={{ height: 1, backgroundColor: colors.borderStrong }} />

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
