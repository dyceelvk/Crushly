import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, View } from 'react-native';
import { keyboardOverlap } from './keyboardOverlap';

/** Measure the actual root: Android keyboards can overlay OR resize the window. */
export function useAndroidKeyboardOverlap() {
  const root = useRef<View>(null);
  const keyboardTop = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [overlap, setOverlap] = useState(0);
  const measure = useCallback(() => {
    if (Platform.OS !== 'android' || keyboardTop.current == null) return;
    root.current?.measureInWindow((_x, y, _w, h) => {
      if (keyboardTop.current != null) setOverlap(keyboardOverlap(y, h, keyboardTop.current));
    });
  }, []);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      keyboardTop.current = event.endCoordinates.screenY;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(measure, 50);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      keyboardTop.current = null;
      if (timer.current) clearTimeout(timer.current);
      setOverlap(0);
    });
    return () => { show.remove(); hide.remove(); if (timer.current) clearTimeout(timer.current); };
  }, [measure]);
  return { root, overlap, measure };
}
