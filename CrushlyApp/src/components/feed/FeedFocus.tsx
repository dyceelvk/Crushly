import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, StyleProp, ViewStyle } from 'react-native';
import { View } from 'react-native';
import { FOCUS_LINE, activeIdAt, type CardBox } from '../../lib/viewability';

/**
 * One clip in the feed plays: the one in front of you.
 *
 * Every `PostCard` used to default to `active`, which meant every clip that the
 * list had mounted started itself the moment it appeared — five, six, ten
 * players decoding at once, all fighting over the one thing `playerFocus` gives
 * away. The symptom was exactly what it looks like: the feed felt like it was
 * wading through mud on a phone, and the clip you were looking at often sat
 * still because the card below it had just grabbed the sound and paused it.
 *
 * So the list tells each card whether it is the one being read, and the answer
 * comes from `lib/viewability`: a focus line a little above centre, because a
 * feed is read top-down. The chosen card changes at most once per card crossed,
 * and never for a scroll that stays inside the same card.
 *
 * `Measured` is the other half: a card reports its box, and forgets it on
 * unmount so a recycled row cannot leave a phantom behind at an old offset.
 */
export function useFeedFocus() {
  const boxes = useRef<CardBox[]>([]);
  const scrollY = useRef(0);
  const viewportH = useRef(0);
  const [activeId, setActiveId] = useState<number | null>(null);

  const recompute = useCallback(() => {
    const next = activeIdAt(boxes.current, scrollY.current, viewportH.current);
    // Same card: no render. This runs several times a second while scrolling.
    setActiveId((prev) => (prev === next ? prev : next));
  }, []);

  const setBox = useCallback(
    (id: number, y: number, height: number) => {
      const rest = boxes.current.filter((b) => b.id !== id);
      rest.push({ id, y, height });
      rest.sort((a, b) => a.y - b.y);
      boxes.current = rest;
      recompute();
    },
    [recompute],
  );

  const dropBox = useCallback(
    (id: number) => {
      const next = boxes.current.filter((b) => b.id !== id);
      if (next.length === boxes.current.length) return;
      boxes.current = next;
      recompute();
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

  return { activeId, listProps, setBox, dropBox, focusLine: FOCUS_LINE };
}

/** A card that reports where it is, and stops mattering when it goes away. */
export function Measured({
  id,
  onBox,
  onDrop,
  style,
  children,
}: {
  id: number;
  onBox: (id: number, y: number, height: number) => void;
  onDrop: (id: number) => void;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const handle = useCallback(
    (e: LayoutChangeEvent) => {
      const { y, height } = e.nativeEvent.layout;
      onBox(id, y, height);
    },
    [id, onBox],
  );
  useEffect(() => () => onDrop(id), [id, onDrop]);
  return (
    <View style={style} onLayout={handle}>
      {children}
    </View>
  );
}
