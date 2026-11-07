import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, StyleProp, ViewStyle } from 'react-native';
import { View } from 'react-native';
import { FOCUS_LINE, activeIdAt, type CardBox } from '../../lib/viewability';

/**
 * One clip in the feed plays: the one in front of you.
 *
 * Every `PostCard` used to default to `active`, which meant every clip the list
 * had mounted started itself the moment it appeared — five, six, ten players
 * decoding at once, all fighting over the one thing `playerFocus` gives away.
 * The symptom was exactly what it looks like: the feed felt like it was wading
 * through mud on a phone, and the clip you were looking at often sat still
 * because the card below it had just grabbed the sound and paused it.
 *
 * So the list tells each card whether it is the one being read, and the answer
 * comes from `lib/viewability`: a focus line a little above centre, because a
 * feed is read top-down.
 *
 * ## Why the offsets are added up rather than reported
 *
 * The first version asked each row for its `onLayout` box and used that `y`
 * directly. Inside a `FlatList` that number is useless: every row is wrapped in
 * the list's own cell container, so each one honestly reports `y: 0`, and the
 * focus line therefore matched whichever card happened to be measured first.
 * The first card in the list played and nothing else ever did.
 *
 * A row cannot see where it sits in the content, but it does know how tall it
 * is. So rows report height by index and the offsets are summed here. Rows keep
 * their height after they are recycled, because the sum has to survive a row
 * leaving the window; a row that has never been rendered borrows the average
 * height, which is only ever wrong below the fold.
 *
 * A row can also report a height without being a candidate — the Flow tab puts
 * a highlights card between posts, and it takes up space without being a clip
 * the reader can be "on".
 */
export function useFeedFocus() {
  /** Heights by list index. Kept after unmount: the sum needs them. */
  const heights = useRef<Map<number, number>>(new Map());
  /** Post id by list index. Absent means "this row is not a clip". */
  const ids = useRef<Map<number, number>>(new Map());
  const scrollY = useRef(0);
  const viewportH = useRef(0);
  const [activeId, setActiveId] = useState<number | null>(null);

  const buildBoxes = useCallback((): CardBox[] => {
    const indices = [...heights.current.keys()].sort((a, b) => a - b);
    if (indices.length === 0) return [];
    const values = [...heights.current.values()].filter((h) => h > 0);
    const fallback = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 420;

    const out: CardBox[] = [];
    let y = 0;
    const last = indices[indices.length - 1];
    for (let i = 0; i <= last; i += 1) {
      const height = heights.current.get(i) ?? fallback;
      const id = ids.current.get(i);
      if (id !== undefined && height > 0) out.push({ id, y, height });
      y += height;
    }
    return out;
  }, []);

  const recompute = useCallback(() => {
    const next = activeIdAt(buildBoxes(), scrollY.current, viewportH.current);
    // Same card: no render. This runs several times a second while scrolling.
    setActiveId((prev) => (prev === next ? prev : next));
  }, [buildBoxes]);

  /**
   * A row reporting where it stands. `id` is the post it holds, or null for a
   * row that only takes up space.
   */
  const report = useCallback(
    (index: number, id: number | null, height: number) => {
      const previous = heights.current.get(index);
      const changed = previous === undefined || Math.abs(previous - height) > 0.5;
      if (changed) heights.current.set(index, height);
      if (id === null) ids.current.delete(index);
      else if (ids.current.get(index) !== id) ids.current.set(index, id);
      if (changed) recompute();
    },
    [recompute],
  );

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollY.current = e.nativeEvent.contentOffset.y;
      recompute();
    },
    [recompute],
  );

  const onViewportLayout = useCallback(
    (e: LayoutChangeEvent) => {
      viewportH.current = e.nativeEvent.layout.height;
      recompute();
    },
    [recompute],
  );

  /** Spread onto a FlatList or ScrollView — the same two events serve both. */
  const listProps = { onScroll, onLayout: onViewportLayout, scrollEventThrottle: 32 };

  return { activeId, listProps, report, focusLine: FOCUS_LINE };
}

/** A row that reports its height, and the post it holds when it holds one. */
export function Measured({
  id,
  index,
  onReport,
  style,
  children,
}: {
  /** The post in this row, or null for a row that is not a clip. */
  id?: number | null;
  /** Where the row sits in the list. Offsets are summed by this. */
  index: number;
  onReport: (index: number, id: number | null, height: number) => void;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const handle = useCallback(
    (e: LayoutChangeEvent) => {
      const { height } = e.nativeEvent.layout;
      onReport(index, id ?? null, height);
    },
    [index, id, onReport],
  );
  useEffect(() => {
    // A row that scrolls out keeps nothing on screen, but its height stays in
    // the sum — hence no cleanup that forgets it.
    return undefined;
  }, []);
  return (
    <View style={style} onLayout={handle}>
      {children}
    </View>
  );
}
