import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { recordPostView } from '../api/service';

/** A genuine view: a focused post held on screen for at least 1.5 seconds. */
export function useTrackPostView(postId: number | null, active: boolean, mine: boolean) {
  const focused = useIsFocused();
  useEffect(() => {
    if (!postId || !active || mine || !focused) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let sent = false;
    const cancel = () => { if (timer) clearTimeout(timer); timer = null; };
    const start = () => {
      cancel();
      if (sent || AppState.currentState !== 'active') return;
      timer = setTimeout(() => {
        sent = true;
        void recordPostView(postId, 1600, false, null).catch(() => undefined);
      }, 1600);
    };
    start();
    const sub = AppState.addEventListener('change', (state) => state === 'active' ? start() : cancel());
    return () => { cancel(); sub.remove(); };
  }, [postId, active, mine, focused]);
}
