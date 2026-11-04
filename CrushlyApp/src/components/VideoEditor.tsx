import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
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
import { MIN_SEGMENT, lengthOf, locate } from '../lib/timeline';
import { EASE_OUT, TRAVEL } from '../lib/motion';

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

function startingEdit(sourceDuration: number | undefined, previous: VideoEdit | null | undefined, category: EditCategory): VideoEdit {
  const duration = sourceDuration && sourceDuration > 0 ? sourceDuration : previous?.sourceDuration ?? 0;
  return previous
    ? clampEdit({ ...previous, sourceDuration: duration }, category)
    : emptyEdit(duration);
}

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
 * capped at fifteen seconds, a Flow or a Circle at a minute.
 */
export function VideoEditorModal({
  visible,
  sourceUri,
  sourceDuration,
  category = 'post',
  naturalRatio = 9 / 16,
  initialTool,
  initialEdit,
  modalAnimation = 'slide',
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
  /** Existing recipe to reopen without losing the earlier edit. */
  initialEdit?: VideoEdit | null;
  /** A route-hosted editor can disable its inner transition to avoid double-sliding. */
  modalAnimation?: 'none' | 'slide' | 'fade';
  onCancel: () => void;
  onDone: (result: VideoEditorResult) => void;
}) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { width: winW, height: winH } = useWindowDimensions();

  // Every change goes through the history, so there is always a way back and
  // no control has to know about it.
  const [history, setHistory] = useState<History<VideoEdit>>(() => startHistory(startingEdit(sourceDuration, initialEdit, category)));
  const edit = history.present;
  const [clipTime, setClipTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [tool, setTool] = useState<ToolId | null>(initialTool ?? null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const player = useVideoPlayer(visible && sourceUri ? sourceUri : null, (p) => {
    p.loop = false;
  });
  const musicPlayer = useVideoPlayer(edit.music?.uri ?? null, (p) => {
    p.loop = true;
  });

  // A fresh clip resets everything: an edit belongs to one clip and one place.
  useEffect(() => {
    if (!visible) {
      player?.pause();
      musicPlayer?.pause();
      setPlaying(false);
      return;
    }
    setHistory(startHistory(startingEdit(sourceDuration, initialEdit, category)));
    setClipTime(0);
    setPlaying(false);
    // A caller can open directly into the control they asked for (for example,
    // the crop action from the composer). Do not erase that route on mount.
    setTool(initialTool ?? null);
    setSelectedId(null);
  // `initialTool` is read when the editor opens; changing a parent prop while
  // an edit is already in progress must not reset the edit history.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, sourceUri, sourceDuration]);

  // Some browsers will not read a video's length until it has been played once.
  // When that happens we take the length from the player as soon as it arrives.
  useEffect(() => {
    if (!visible || !player) return;
    let raf = 0;
    const poll = () => {
      const d = player.duration ?? 0;
      if (d > 0.2) {
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

  // The preview sound is a real second player. It follows transport state and
  // is always stopped when the editor is not active (including route dismissal).
  useEffect(() => {
    if (!visible || !playing || !edit.music) {
      musicPlayer?.pause();
      return;
    }
    if (!musicPlayer?.playing) musicPlayer?.play();
  }, [visible, playing, edit.music, musicPlayer]);

  const total = edit.sourceDuration || 0;
  const length = clipLength(edit);
  const limit = EDIT_LIMITS[category];

  /** Move the playhead to a point in the made clip. */
  const seek = (cutSeconds: number) => {
    const t = Math.min(Math.max(cutSeconds, 0), length);
    if (player) player.currentTime = sourceTimeAt(edit, t);
    if (edit.music && musicPlayer) {
      const musicTime = edit.music.offset + t / Math.max(0.1, edit.speed);
      if (Math.abs(musicPlayer.currentTime - musicTime) > 0.35) musicPlayer.currentTime = musicTime;
    }
    setClipTime(t);
  };

  const togglePlay = () => {
    if (!player) return;
    const shouldPlay = !player.playing;
    if (!shouldPlay) {
      player.pause();
      musicPlayer?.pause();
    } else {
      const startAt = clipTime >= length - 0.02 ? 0 : clipTime;
      if (startAt !== clipTime) seek(0);
      if (edit.music && musicPlayer) {
        musicPlayer.currentTime = edit.music.offset + startAt / Math.max(0.1, edit.speed);
        musicPlayer.play();
      }
      player.play();
    }
    haptic.tap();
    setPlaying(shouldPlay);
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
  const pieces = segmentsOf(edit);
  const selectedPiece = pieces.find((p) => p.id === selectedId) ?? null;
  const playheadPosition = locate(pieces, clipTime);
  const playheadIndex = playheadPosition?.index ?? 0;
  const activePiece = selectedPiece ?? pieces[playheadIndex] ?? null;
  const activePieceIndex = activePiece ? pieces.findIndex((p) => p.id === activePiece.id) : -1;
  const pieceCount = pieces.length;
  const canSplit = !!playheadPosition &&
    playheadPosition.into >= MIN_SEGMENT &&
    lengthOf(playheadPosition.segment) - playheadPosition.into >= MIN_SEGMENT;
  const canMoveEarlier = activePieceIndex > 0;
  const canMoveLater = activePieceIndex >= 0 && activePieceIndex < pieceCount - 1;

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

  // CapCut's measured workbench maps to three stable regions: the preview,
  // timeline command strip and tracks. At desktop widths, tools live in the
  // measured 58px sider and the inspector opens on the right; on a phone the
  // same tools become a bottom rail and inspector.
  const isWide = winW >= 900;
  const mobilePanelHeight = Math.min(248, Math.max(156, winH * 0.3));
  const availW = Math.min(winW - space.lg * 2 - (isWide && tool ? 340 : 0), isWide ? 720 : 520);
  // Mobile preview height is calculated after the actual fixed workbench rows,
  // not as a percentage of the screen that can push the preview under them.
  const mobileRows = insets.top + 58 + 44 + 48 + 114 + (tool ? mobilePanelHeight : 0) + insets.bottom + 70 + space.md;
  const availH = isWide ? Math.min(winH * 0.62, 620) : Math.max(144, winH - mobileRows);
  const ratio = edit.aspect === 'original' ? naturalRatio : (ASPECTS[edit.aspect].ratio ?? naturalRatio);
  let frameW = availW;
  let frameH = frameW / ratio;
  if (frameH > availH) {
    frameH = availH;
    frameW = frameH * ratio;
  }

  const panelTitle = TOOLS.find((t) => t.id === tool)?.label ?? '';
  const panelContent = (
    <>
      {tool === 'trim' ? <TrimPanel edit={edit} total={total} category={category} update={update} /> : null}
      {tool === 'captions' ? (
        <CaptionsPanel
          edit={edit}
          caption={selectedCaption}
          playhead={clipTime}
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
          playhead={clipTime}
          onSelect={setSelectedId}
          update={update}
          category={category}
        />
      ) : null}
      {tool === 'music' ? <MusicPanel edit={edit} update={update} onPick={pickMusic} /> : null}
    </>
  );

  const toolPanel = tool === null ? null : (
    <View
      style={[
        {
          minHeight: 0,
          overflow: 'hidden',
          backgroundColor: colors.bgSecondary,
          borderColor: colors.border,
        },
        isWide
          ? { width: 320, borderLeftWidth: 1 }
          : { height: mobilePanelHeight, borderTopWidth: 1, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md },
      ]}
    >
      <View style={{ height: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.md, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Txt variant="smallStrong" style={{ flex: 1, color: colors.text }} accessibilityRole="header">
          {panelTitle}
          {tool === 'captions' && selectedCaption ? ` · Text ${edit.captions.findIndex((c) => c.id === selectedCaption.id) + 1}` : ''}
          {tool === 'stickers' && selectedSticker ? ' · Selected' : ''}
        </Txt>
        <IconButton icon="close" label={`Close ${panelTitle} panel`} size={36} variant="plain" onPress={() => setTool(null)} />
      </View>
      <PanelSlide key={tool} wide={isWide}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: space.md, paddingBottom: insets.bottom + space.md, gap: space.md }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <PanelNote>
            Save stores edits, not a new file. Some trims may be applied on share; other edits stay live in this build.
          </PanelNote>
          {panelContent}
        </ScrollView>
      </PanelSlide>
    </View>
  );

  const transport = (
    <View style={{ height: 44, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, borderTopWidth: 1, borderTopColor: colors.border }}>
      <IconButton
        icon={playing ? 'pause' : 'play'}
        label={playing ? 'Pause preview' : 'Play preview'}
        size={40}
        variant="plain"
        disabled={!sourceUri}
        onPress={togglePlay}
      />
      <Txt variant="numeric" style={{ color: colors.text }}>
        {clock(clipTime / edit.speed)} <Txt variant="caption" color="textMuted">/ {clock(playbackLength(edit))}</Txt>
      </Txt>
      <View style={{ flex: 1 }} />
      <Txt variant="caption" style={{ color: colors.textMuted }}>
        {playing ? 'Preview playing' : 'Preview paused'}
      </Txt>
    </View>
  );

  const timelineCommands = (
    <View style={{ height: 48, flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: space.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
      <TimelineCommand icon="cut" label="Split at playhead" disabled={!canSplit} onPress={splitNow} />
      <TimelineCommand icon="copy-outline" label="Duplicate selected clip" disabled={!activePiece} onPress={duplicateNow} />
      <TimelineCommand icon="trash-outline" label="Delete selected clip" disabled={pieceCount < 2 || !activePiece} onPress={deletePieceNow} />
      <View style={{ width: 1, height: 24, backgroundColor: colors.border, marginHorizontal: 4 }} />
      <TimelineCommand icon="chevron-back" label="Move clip earlier" disabled={!canMoveEarlier} onPress={() => moveNow(-1)} />
      <TimelineCommand icon="chevron-forward" label="Move clip later" disabled={!canMoveLater} onPress={() => moveNow(1)} />
      <View style={{ flex: 1 }} />
      <Txt variant="caption" style={{ color: colors.textSecondary }} numberOfLines={1}>
        {activePiece ? `Clip ${activePieceIndex + 1}  ·  ${lengthOf(activePiece).toFixed(1)}s` : `${pieceCount} clips`}
      </Txt>
    </View>
  );

  const stage = (
    <View style={{ flex: 1, minHeight: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.md, paddingVertical: space.xs }}>
      <View style={{ width: frameW, height: frameH }}>
        <VideoEditCanvas
          player={player}
          edit={edit}
          clipTime={clipTime}
          naturalRatio={naturalRatio}
          interactive
          selectedId={selectedId}
          onSelect={setSelectedId}
          onMoveCaption={(id, x, y) => update(
            { ...edit, captions: edit.captions.map((c) => (c.id === id ? { ...c, x, y } : c)) },
            `caption-move-${id}`,
          )}
          onMoveSticker={(id, x, y) => update(
            { ...edit, stickers: edit.stickers.map((s) => (s.id === id ? { ...s, x, y } : s)) },
            `sticker-move-${id}`,
          )}
          style={{ width: frameW, height: frameH, borderRadius: radius.md }}
        />
        {/* A small play affordance appears only while paused. It never blankets
            the canvas, so caption/sticker handles remain directly draggable. */}
        {!playing && sourceUri ? (
          <Pressable
            onPress={togglePlay}
            accessibilityRole="button"
            accessibilityLabel="Play preview"
            style={{ position: 'absolute', left: '50%', top: '50%', width: 54, height: 54, marginLeft: -27, marginTop: -27, borderRadius: 27, backgroundColor: 'rgba(8,8,10,0.55)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' }}
          >
            <Ionicons name="play" size={24} color="#fff" style={{ marginLeft: 3 }} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  const toolRail = <EditorToolRail vertical={isWide} value={tool} onChange={setTool} />;

  return (
    <Modal visible={visible} animationType={modalAnimation} onRequestClose={() => { player?.pause(); musicPlayer?.pause(); setPlaying(false); onCancel(); }} statusBarTranslucent>
      <View style={{ flex: 1, minHeight: 0, backgroundColor: colors.bg }}>
        <View style={{ minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: insets.top + 4, paddingHorizontal: space.md, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <IconButton icon="close" label="Discard edits" variant="plain" color={colors.text} onPress={() => { player?.pause(); musicPlayer?.pause(); setPlaying(false); onCancel(); }} />
          <View style={{ flex: 1, minWidth: 0, paddingHorizontal: 4 }}>
            <Txt variant="subheading" style={{ color: colors.text }} accessibilityRole="header" numberOfLines={1}>
              {CATEGORY_LABEL[category]} editor
            </Txt>
            <Txt variant="caption" style={{ color: colors.textSecondary }} numberOfLines={1}>
              {`${formatTime(clipTime / edit.speed)} / ${formatTime(playbackLength(edit))}  ·  Clip ${Math.max(1, activePieceIndex + 1)} of ${pieceCount}`}
            </Txt>
          </View>
          <IconButton
            icon="arrow-undo"
            label={`Undo${canUndo(history) ? `, ${depth(history).undo} step${depth(history).undo === 1 ? '' : 's'}` : ''}`}
            variant="plain"
            color={canUndo(history) ? colors.text : colors.textMuted}
            disabled={!canUndo(history)}
            onPress={() => canUndo(history) && stepBack()}
          />
          <IconButton
            icon="arrow-redo"
            label={`Redo${canRedo(history) ? `, ${depth(history).redo} step${depth(history).redo === 1 ? '' : 's'}` : ''}`}
            variant="plain"
            color={canRedo(history) ? colors.text : colors.textMuted}
            disabled={!canRedo(history)}
            onPress={() => canRedo(history) && stepForward()}
          />
          <Button
            title="Save"
            size="sm"
            variant="primary"
            disabled={!sourceUri}
            onPress={() => {
              if (!sourceUri) return;
              player?.pause();
              musicPlayer?.pause();
              setPlaying(false);
              haptic.success();
              onDone(exportEdit(sourceUri, edit, category));
            }}
            accessibilityLabel="Save edit and return to composer"
            accessibilityHint="Saves the edit recipe with your clip. This does not render a new video file."
          />
        </View>

        {isWide ? (
          <View style={{ flex: 1, minHeight: 0, flexDirection: 'row' }}>
            {toolRail}
            <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
              <View style={{ flex: 1, minHeight: 0, flexDirection: 'row' }}>
                {stage}
                {toolPanel}
              </View>
              {transport}
              {timelineCommands}
              <Timeline
                pieces={pieces}
                duration={length}
                playhead={clipTime}
                overlays={timelineOverlays}
                selectedId={selectedId}
                onSeek={seek}
                onSelect={setSelectedId}
                onTrim={(id, start, end) => update(trimPiece(edit, id, start, end, category), 'trim')}
              />
            </View>
          </View>
        ) : (
          <View style={{ flex: 1, minHeight: 0 }}>
            {stage}
            {transport}
            {timelineCommands}
            <Timeline
              pieces={pieces}
              duration={length}
              playhead={clipTime}
              overlays={timelineOverlays}
              selectedId={selectedId}
              onSeek={seek}
              onSelect={setSelectedId}
              onTrim={(id, start, end) => update(trimPiece(edit, id, start, end, category), 'trim')}
            />
            {toolPanel}
            {toolRail}
          </View>
        )}
      </View>
    </Modal>
  );
}

/** Minutes and seconds for the transport and ruler. */
function clock(seconds: number): string {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function PanelNote({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <Txt variant="small" style={{ color: colors.textSecondary }}>
      {children}
    </Txt>
  );
}

function TimelineCommand({
  icon,
  label,
  onPress,
  disabled = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <IconButton
      icon={icon}
      label={label}
      size={40}
      variant="plain"
      disabled={disabled}
      color={disabled ? colors.textMuted : colors.textSecondary}
      style={{ backgroundColor: disabled ? 'transparent' : colors.elevated, borderRadius: radius.sm }}
      onPress={onPress}
    />
  );
}

function EditorToolRail({
  vertical,
  value,
  onChange,
}: {
  vertical: boolean;
  value: ToolId | null;
  onChange: (tool: ToolId | null) => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        { backgroundColor: colors.bgSecondary, borderColor: colors.border },
        vertical
          ? { width: 72, borderRightWidth: 1, flexShrink: 0 }
          : { borderTopWidth: 1, flexShrink: 0 },
      ]}
    >
      <ScrollView
        horizontal={!vertical}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          { alignItems: 'center', gap: 6 },
          vertical
            ? { paddingVertical: space.sm, width: 72 }
            : { paddingHorizontal: space.sm, paddingTop: 6, paddingBottom: Math.max(insets.bottom, 6) },
        ]}
      >
        {TOOLS.map((item) => {
          const active = value === item.id;
          return (
            <Pressable
              key={item.id}
              onPress={() => {
                haptic.tap();
                onChange(active ? null : item.id);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${item.label}${active ? ' panel open' : ''}`}
              accessibilityState={{ selected: active }}
              style={{
                width: vertical ? 58 : 64,
                height: 58,
                borderRadius: radius.sm,
                backgroundColor: active ? colors.goldSoft : 'transparent',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
              }}
            >
              <Ionicons name={item.icon} size={19} color={active ? colors.gold : colors.textSecondary} />
              <Txt variant="caption" style={{ color: active ? colors.gold : colors.textSecondary }} maxFontSizeMultiplier={1.1}>
                {item.label}
              </Txt>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function PanelSlide({ children, wide }: { children: React.ReactNode; wide: boolean }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 200,
      easing: EASE_OUT,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [progress, wide]);

  const travel = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [TRAVEL.panel, 0],
  });
  return (
    <Animated.View
      style={[
        { flex: 1, minHeight: 0, opacity: progress },
        { transform: wide ? [{ translateX: travel }] : [{ translateY: travel }] },
      ]}
    >
      {children}
    </Animated.View>
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
  playhead,
  onSelect,
  update,
  colors,
  category,
}: {
  edit: VideoEdit;
  caption: VideoEdit['captions'][number] | null;
  playhead: number;
  onSelect: (id: string | null) => void;
  update: (e: VideoEdit, mergeKey?: string | null) => void;
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
        full={false}
        onPress={() => {
          const c = newCaption(edit, playhead);
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
              }, `caption-text-${caption.id}`)
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
              update({ ...edit, captions: edit.captions.map((c) => (c.id === caption.id ? { ...c, size: v } : c)) }, `caption-size-${caption.id}`)
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
              }, `caption-time-${caption.id}`)
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
      <PanelNote>
        Tap a look. These sit over the clip, so they never damage the picture underneath.
      </PanelNote>
      {Platform.OS === 'web' ? null : (
        <PanelNote>On-device preview uses a tint approximation; this editor does not bake the filter into a new video file.</PanelNote>
      )}
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

function AdjustPanel({ edit, update }: { edit: VideoEdit; update: (e: VideoEdit, mergeKey?: string | null) => void }) {
  return (
    <>
      <PanelNote>
        {Platform.OS === 'web'
          ? 'Brightness, contrast and saturation are previewed as real grades.'
          : 'Brightness uses a light overlay here. Contrast and saturation are unavailable because this device preview cannot render them accurately.'}
      </PanelNote>
      <RangeSlider
        min={-1}
        max={1}
        low={edit.brightness}
        step={0.02}
        onChange={(v) => update({ ...edit, brightness: v }, 'brightness')}
        label="Brightness"
        formatValue={(v) => `${Math.round(v * 100)}`}
      />
      {Platform.OS === 'web' ? (
        <>
          <RangeSlider
            min={-1}
            max={1}
            low={edit.contrast}
            step={0.02}
            onChange={(v) => update({ ...edit, contrast: v }, 'contrast')}
            label="Contrast"
            formatValue={(v) => `${Math.round(v * 100)}`}
          />
          <RangeSlider
            min={-1}
            max={1}
            low={edit.saturation}
            step={0.02}
            onChange={(v) => update({ ...edit, saturation: v }, 'saturation')}
            label="Saturation"
            formatValue={(v) => `${Math.round(v * 100)}`}
          />
        </>
      ) : null}
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
  playhead,
  onSelect,
  update,
  category,
}: {
  edit: VideoEdit;
  sticker: VideoEdit['stickers'][number] | null;
  playhead: number;
  onSelect: (id: string | null) => void;
  update: (e: VideoEdit, mergeKey?: string | null) => void;
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
              const s = newSticker(edit, g, playhead);
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
              update({ ...edit, stickers: edit.stickers.map((s) => (s.id === sticker.id ? { ...s, scale: v } : s)) }, `sticker-size-${sticker.id}`)
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
              update({ ...edit, stickers: edit.stickers.map((s) => (s.id === sticker.id ? { ...s, rotation: v } : s)) }, `sticker-rotation-${sticker.id}`)
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
              }, `sticker-time-${sticker.id}`)
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
  update: (e: VideoEdit, mergeKey?: string | null) => void;
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
            onChange={(v) => update({ ...edit, music: { ...edit.music!, volume: v } }, 'music-volume')}
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
        onChange={(v) => update({ ...edit, clipVolume: v }, 'clip-volume')}
        label="Clip's own sound"
        formatValue={(v) => (v === 0 ? 'Muted' : `${Math.round(v * 100)}%`)}
      />
      <PanelNote>
        Music you add plays over the clip. Only add sound you have the right to use.
      </PanelNote>
    </>
  );
}
