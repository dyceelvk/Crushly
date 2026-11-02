/**
 * The timeline.
 *
 * This is the piece of an editor that everything else hangs off, so it is
 * drawn as what it is rather than as a decoration: two lanes, the clip on the
 * bottom and whatever is written over it on top, one playhead across both.
 *
 * The width of the lane is the *kept* sequence, not the file. Once you have cut
 * something out, the timeline gets shorter — the way it does in every editor
 * people already know — and the ruler underneath reports cut time, because that
 * is the time you are working in.
 *
 * There is no zoom wheel. A phone editor that fits the whole clip on screen is
 * easier to use than one where you can be lost inside minute six of your own
 * fifteen-second video; the handles are given a generous grab radius instead.
 */

import React, { useRef, useState } from 'react';
import { PanResponder, View } from 'react-native';
import { Txt } from './Txt';
import { useTheme } from '../theme/ThemeProvider';
import { space } from '../theme/tokens';

import { MIN_SEGMENT, Segment, lengthOf, snap } from '../lib/timeline';

export type TimelineOverlay = {
  id: string;
  kind: 'caption' | 'sticker';
  start: number;
  end: number;
  label: string;
};

const LANE_HEIGHT = 40;
const RAIL_HEIGHT = 18;
const GRAB = 16;
const GAP = 2;

export function Timeline({
  pieces,
  duration,
  playhead,
  overlays,
  selectedId,
  onSeek,
  onSelect,
  onTrim,
}: {
  pieces: Segment[];
  /** Length of the kept sequence, in cut seconds. */
  duration: number;
  /** Playhead, in cut seconds. */
  playhead: number;
  overlays: TimelineOverlay[];
  selectedId: string | null;
  onSeek: (cutTime: number) => void;
  onSelect: (id: string | null) => void;
  onTrim: (id: string, start: number, end: number) => void;
}) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);

  // PanResponder closes over its props once, so the handlers read through a ref
  // that is refreshed on every render. Everything the gesture needs is here.
  const live = useRef({ pieces, duration, width, onSeek, onSelect, onTrim });
  live.current = { pieces, duration, width, onSeek, onSelect, onTrim };

  const grab = useRef<
    | { kind: 'scrub' }
    | { kind: 'left' | 'right'; id: string; startX: number; from: number; to: number; targets: number[] }
    | null
  >(null);

  const secondsPerPx = () => {
    const { duration: d, width: w } = live.current;
    return w > 0 ? d / w : 0;
  };
  const cutTimeAtX = (x: number) => Math.max(0, Math.min(live.current.duration, x * secondsPerPx()));

  /** Where a piece begins, in cut seconds. */
  const offsetOf = (id: string) => {
    let walked = 0;
    for (const p of live.current.pieces) {
      if (p.id === id) return walked;
      walked += lengthOf(p);
    }
    return 0;
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e: { nativeEvent: { locationX: number; locationY: number } }) => {
        const { pieces: ps, width: w, onSelect: select } = live.current;
        const x = e.nativeEvent.locationX;

        // A drag on the rail scrubs; the lanes are where the editing happens.
        if (e.nativeEvent.locationY < RAIL_HEIGHT) {
          grab.current = { kind: 'scrub' };
          live.current.onSeek(cutTimeAtX(x));
          return;
        }

        // Which piece is under the finger, and is the finger on one of its ends?
        let walked = 0;
        for (const p of ps) {
          const left = (walked / Math.max(0.001, live.current.duration)) * w;
          const right = ((walked + lengthOf(p)) / Math.max(0.001, live.current.duration)) * w;
          if (x >= left - GRAB && x <= right + GRAB) {
            const nearLeft = Math.abs(x - left) <= GRAB && lengthOf(p) > MIN_SEGMENT * 2;
            const nearRight = Math.abs(x - right) <= GRAB && lengthOf(p) > MIN_SEGMENT * 2;
            select(p.id);
            if (nearLeft || nearRight) {
              const targets = ps.flatMap((q) => [q.start, q.end]);
              grab.current = {
                kind: nearLeft ? 'left' : 'right',
                id: p.id,
                startX: x,
                from: p.start,
                to: p.end,
                targets,
              };
            } else {
              grab.current = { kind: 'scrub' };
              live.current.onSeek(cutTimeAtX(x));
            }
            return;
          }
          walked += lengthOf(p);
        }
        select(null);
        grab.current = { kind: 'scrub' };
        live.current.onSeek(cutTimeAtX(x));
      },
      onPanResponderMove: (e: { nativeEvent: { locationX: number } }) => {
        const g = grab.current;
        if (!g) return;
        const x = e.nativeEvent.locationX;
        if (g.kind === 'scrub') {
          live.current.onSeek(cutTimeAtX(x));
          return;
        }
        // A tenth of a second is the smallest change worth making, and snapping
        // to the edges of the other pieces is what makes a join look intended.
        const dx = (x - g.startX) * secondsPerPx();
        const tolerance = secondsPerPx() * 8;
        if (g.kind === 'left') {
          const next = snap(Math.round((g.from + dx) * 10) / 10, g.targets, tolerance);
          const start = Math.min(Math.max(0, next), g.to - MIN_SEGMENT);
          live.current.onTrim(g.id, start, g.to);
        } else {
          const next = snap(Math.round((g.to + dx) * 10) / 10, g.targets, tolerance);
          const end = Math.max(next, g.from + MIN_SEGMENT);
          live.current.onTrim(g.id, g.from, end);
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

  // Minutes and seconds on the ruler — a centisecond on a five-label rail is
  // three characters of noise — and one decimal on a piece, because the length
  // of a piece is the thing you are choosing.
  const mmss = (t: number) => {
    const s = Math.max(0, t);
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  };

  const safeWidth = Math.max(1, width);
  const xOfCut = (t: number) => (t / Math.max(0.001, duration)) * safeWidth;
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <View style={{ paddingHorizontal: space.md, paddingTop: space.xs }} accessibilityLabel="Timeline">
      <View
        {...responder.panHandlers}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        accessibilityLabel="Timeline. Drag the rail to scrub, drag a piece's ends to trim it, tap a piece to select it."
        style={{ gap: GAP }}
      >
        {/* The rail: cut time, left to right. */}
        <View style={{ height: RAIL_HEIGHT }}>
          {width > 0
            ? ticks.map((f, i) => (
                <Txt
                  key={i}
                  variant="caption"
                  style={{
                    position: 'absolute',
                    left: Math.min(Math.max(0, f * width - 14), width - 30),
                    fontSize: 10,
                    color: '#63636d',
                  }}
                >
                  {mmss(duration * f)}
                </Txt>
              ))
            : null}
        </View>

        {/* Lane one: the picture. */}
        <View style={{ height: LANE_HEIGHT }}>
          {width > 0 ? (
            <>
              {(() => {
                let walked = 0;
                return pieces.map((p, i) => {
                  const left = xOfCut(walked);
                  const w = Math.max(6, xOfCut(walked + lengthOf(p)) - left);
                  walked += lengthOf(p);
                  const selected = p.id === selectedId;
                  return (
                    <View
                      key={p.id}
                      pointerEvents="none"
                      style={{
                        position: 'absolute',
                        left,
                        width: Math.max(4, w - GAP),
                        height: LANE_HEIGHT,
                        borderRadius: 4,
                        backgroundColor: selected ? colors.goldSoft : '#2a2a33',
                        borderWidth: selected ? 2 : 1,
                        borderColor: selected ? colors.gold : '#3a3a45',
                        justifyContent: 'center',
                        // Room for the grab handle at either end, so the first
                        // piece's number is not printed underneath it.
                        paddingHorizontal: 13,
                        overflow: 'hidden',
                      }}
                    >
                      <Txt variant="caption" style={{ fontSize: 9, color: selected ? '#fff' : '#8b8b95' }} numberOfLines={1}>
                        {`${i + 1} · ${lengthOf(p).toFixed(1)}s`}
                      </Txt>
                    </View>
                  );
                });
              })()}
              {/* The ends of the selected piece, which is what a finger grabs. */}
              {pieces
                .filter((p) => p.id === selectedId)
                .map((p) => {
                  const left = xOfCut(offsetOf(p.id));
                  const right = xOfCut(offsetOf(p.id) + lengthOf(p));
                  return [left, right].map((x, i) => (
                    <View
                      key={`${p.id}-${i}`}
                      pointerEvents="none"
                      style={{
                        position: 'absolute',
                        left: Math.min(Math.max(0, x - 5), safeWidth - 10),
                        width: 10,
                        height: LANE_HEIGHT + 8,
                        top: -4,
                        borderRadius: 3,
                        backgroundColor: colors.gold,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <View style={{ width: 1.5, height: 14, backgroundColor: 'rgba(0,0,0,0.4)' }} />
                    </View>
                  ));
                })}
            </>
          ) : null}
        </View>

        {/* Lane two: what is written over it. Empty is a real state, and saying
            so is better than a lane that silently appears. */}
        <View style={{ height: LANE_HEIGHT, borderRadius: 4, backgroundColor: '#141418' }}>
          {width > 0 && overlays.length
            ? overlays.map((o) => {
                const left = xOfCut(Math.max(0, o.start));
                const w = Math.max(8, xOfCut(Math.min(duration, o.end)) - left);
                return (
                  <View
                    key={o.id}
                    pointerEvents="none"
                    style={{
                      position: 'absolute',
                      left,
                      width: w,
                      height: LANE_HEIGHT,
                      borderRadius: 4,
                      backgroundColor: o.kind === 'caption' ? 'rgba(255,209,102,0.28)' : 'rgba(126,224,196,0.26)',
                      borderWidth: 1,
                      borderColor: o.kind === 'caption' ? 'rgba(255,209,102,0.7)' : 'rgba(126,224,196,0.7)',
                      justifyContent: 'center',
                      paddingHorizontal: 4,
                      overflow: 'hidden',
                    }}
                  >
                    <Txt variant="caption" style={{ fontSize: 9, color: '#e9e9ef' }} numberOfLines={1}>
                      {o.label}
                    </Txt>
                  </View>
                );
              })
            : width > 0 && (
                <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 6 }}>
                  <Txt variant="caption" style={{ fontSize: 9, color: '#4a4a55' }}>
                    Text and stickers land here
                  </Txt>
                </View>
              )}
        </View>

        {/* The playhead, across both lanes. */}
        {width > 0 ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: Math.min(Math.max(0, xOfCut(playhead) - 1), safeWidth - 2),
              top: RAIL_HEIGHT,
              bottom: 0,
              width: 2,
              backgroundColor: '#ffffff',
              borderRadius: 1,
            }}
          />
        ) : null}
      </View>
    </View>
  );
}
