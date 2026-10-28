import React, { useMemo, useRef } from 'react';
import { LayoutChangeEvent, Platform, StyleProp, View, ViewStyle } from 'react-native';
import { VideoView } from 'expo-video';
import type { VideoPlayer } from 'expo-video';
import {
  Caption,
  Sticker,
  VideoEdit,
  animate,
  cssFilterFor,
  overlaysAt,
  tintFor,
} from '../lib/videoEdit';
import { Txt } from './Txt';

type Frame = { width: number; height: number };

/**
 * Draws one frame of an edit.
 *
 * This is the single place an edit becomes pixels, and both the editor preview
 * and the feed play through it — so what you see while editing is exactly what
 * everybody else sees. The video itself is never touched; everything here is
 * layered on top of it.
 */
export function VideoEditCanvas({
  player,
  edit,
  clipTime,
  style,
  naturalRatio = 9 / 16,
  interactive = false,
  selectedId = null,
  onSelect,
  onMoveCaption,
  onMoveSticker,
  onFrame,
  contentFit = 'contain',
}: {
  player: VideoPlayer;
  edit: VideoEdit;
  /** Seconds into the trimmed clip. */
  clipTime: number;
  style?: StyleProp<ViewStyle>;
  /** Width / height of the source video, used by the Original crop. */
  naturalRatio?: number;
  interactive?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onMoveCaption?: (id: string, x: number, y: number) => void;
  onMoveSticker?: (id: string, x: number, y: number) => void;
  onFrame?: (frame: Frame) => void;
  /** 'contain' shows the full video without cropping; 'cover' fills the frame. */
  contentFit?: 'contain' | 'cover';
}) {
  const frame = useRef<Frame>({ width: 0, height: 0 });
  const { captions, stickers } = overlaysAt(edit, clipTime);
  const tint = tintFor(edit);
  const css = cssFilterFor(edit);

  // On the web the browser grades the picture properly. On the phone we stack a
  // translucent colour over it instead — the only grading available without a
  // GPU pipeline.
  const videoStyle = useMemo(() => {
    const base: ViewStyle = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 };
    if (Platform.OS === 'web' && css !== 'none') {
      (base as unknown as Record<string, unknown>).filter = css;
    }
    return base;
  }, [css]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    frame.current = { width, height };
    onFrame?.({ width, height });
  };

  const beginDrag = (x: number, y: number) => ({
    startX: x,
    startY: y,
    w: frame.current.width || 1,
    h: frame.current.height || 1,
  });

  return (
    <View
      style={[{ overflow: 'hidden', backgroundColor: '#000' }, style]}
      onLayout={onLayout}
      collapsable={false}
    >
      <VideoView
        player={player}
        style={videoStyle}
        contentFit={contentFit}
        nativeControls={false}
        pointerEvents="none"
      />

      {tint ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: tint.color,
            opacity: tint.opacity,
          }}
        />
      ) : null}

      {stickers.map((s) => (
        <Draggable
          key={s.id}
          x={s.x}
          y={s.y}
          selected={interactive && selectedId === s.id}
          interactive={interactive}
          onSelect={() => onSelect?.(s.id)}
          onMove={(nx, ny) => onMoveSticker?.(s.id, nx, ny)}
          beginDrag={beginDrag}
          render={() => (
            <Txt
              style={{
                fontSize: 34 * s.scale,
                transform: [{ rotate: `${s.rotation}deg` }],
                textShadowColor: 'rgba(0,0,0,0.45)',
                textShadowRadius: 6,
              }}
            >
              {s.glyph}
            </Txt>
          )}
        />
      ))}

      {captions.map((c) => {
        const p = (clipTime - c.start) / Math.max(0.001, c.end - c.start);
        const a = animate(c.animation, p);
        return (
          <Draggable
            key={c.id}
            x={c.x}
            y={c.y}
            selected={interactive && selectedId === c.id}
            interactive={interactive}
            onSelect={() => onSelect?.(c.id)}
            onMove={(nx, ny) => onMoveCaption?.(c.id, nx, ny)}
            beginDrag={beginDrag}
            render={() => (
              <CaptionChip caption={c} opacity={a.opacity} scale={a.scale} frame={frame.current} />
            )}
          />
        );
      })}
    </View>
  );
}

function CaptionChip({
  caption: c,
  opacity,
  scale,
  frame,
}: {
  caption: Caption;
  opacity: number;
  scale: number;
  frame: Frame;
}) {
  const fontSize = (frame.height || 300) * c.size;
  const plate = c.style === 'box';
  return (
    <View
      style={{
        opacity,
        transform: [{ scale }],
        maxWidth: '88%',
        backgroundColor: plate ? 'rgba(0,0,0,0.55)' : undefined,
        borderRadius: plate ? 8 : undefined,
        paddingHorizontal: plate ? 10 : 0,
        paddingVertical: plate ? 5 : 0,
      }}
    >
      <Txt
        style={{
          fontSize,
          lineHeight: fontSize * 1.22,
          color: c.color,
          fontWeight: c.bold ? '800' : '500',
          textAlign: 'center',
          // The outline is four offset shadows: RN has no text stroke, and this
          // is how every sticker-style caption on mobile is drawn anyway.
          textShadowColor: c.style === 'outline' ? 'rgba(0,0,0,0.9)' : 'rgba(0,0,0,0.55)',
          textShadowRadius: c.style === 'outline' ? 0.5 : 5,
          textShadowOffset:
            c.style === 'outline'
              ? { width: Math.max(1, fontSize * 0.06), height: 0 }
              : { width: 0, height: 1 },
        }}
      >
        {c.text || 'Your words here'}
      </Txt>
    </View>
  );
}

/**
 * A positioned, optionally draggable overlay. Dragging is written by hand
 * against the pan gesture rather than a library, so it behaves the same in the
 * browser and on the phone.
 */
function Draggable({
  x,
  y,
  interactive,
  selected,
  onSelect,
  onMove,
  beginDrag,
  render,
}: {
  x: number;
  y: number;
  interactive: boolean;
  selected: boolean;
  onSelect: () => void;
  onMove: (x: number, y: number) => void;
  beginDrag: (x: number, y: number) => { startX: number; startY: number; w: number; h: number };
  render: () => React.ReactElement;
}) {
  const grab = useRef<{ startX: number; startY: number; w: number; h: number } | null>(null);

  const handlers = useMemo(() => {
    if (!interactive) return undefined;
    // PanResponder is imported lazily through React Native's own gesture system
    // so the web bundle does not pull it in when the canvas is read-only.
    const { PanResponder } = require('react-native') as typeof import('react-native');
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        onSelect();
        grab.current = beginDrag(x, y);
      },
      onPanResponderMove: (_e, g) => {
        const g0 = grab.current;
        if (!g0) return;
        onMove(
          Math.min(0.97, Math.max(0.03, g0.startX + g.dx / g0.w)),
          Math.min(0.97, Math.max(0.03, g0.startY + g.dy / g0.h)),
        );
      },
      onPanResponderRelease: () => {
        grab.current = null;
      },
    });
  }, [interactive, x, y, onSelect, onMove, beginDrag]);

  return (
    <View
      {...(handlers ? handlers.panHandlers : {})}
      pointerEvents={interactive ? 'auto' : 'none'}
      style={{
        position: 'absolute',
        left: `${x * 100}%`,
        top: `${y * 100}%`,
        transform: [{ translateX: '-50%' }, { translateY: '-50%' }],
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: selected ? 1 : 0,
        borderColor: 'rgba(255,255,255,0.85)',
        borderStyle: 'dashed',
        borderRadius: 6,
        padding: selected ? 4 : 0,
      }}
    >
      {render()}
    </View>
  );
}
