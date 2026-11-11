import { useEffect, type RefObject } from 'react';
import { Platform } from 'react-native';

/**
 * Snapping a list on the web, the way a phone already does.
 *
 * `snapToInterval`, `snapToAlignment` and `decelerationRate` are React Native
 * props that react-native-web simply does not implement. On a phone a rail of
 * Crushes comes to rest on a tile; in a browser the same rail slides freely and
 * a hard swipe throws it past four tiles, so the app does not feel like itself
 * from one device to the other. The browser has snap of its own, and it is the
 * *same* snap the phone has — one line of CSS per axis — so the fix is to turn it
 * on rather than to write a gesture engine.
 *
 * Two things need care, and both have bitten before:
 *
 *  · **Finding the scroller.** `getScrollableNode()` on react-native-web hands
 *    back a node that is not the element the browser scrolls, so the element is
 *    found by walking outwards from it until one is bigger than its viewport.
 *  · **Cells arrive later.** A list that pages in more rows creates new children,
 *    and a snap position that was not there on mount never gets one — so the
 *    styles are re-applied whenever the content's children change.
 *
 * Everything is removed on unmount: a snap left behind on a shared node would
 * make some other screen's list jump.
 */

type Scrollable = {
  getScrollableNode?: () => HTMLElement;
  /* A FlatList also exposes this; a ScrollView does not. Both are optional. */
};

/** The element the browser is actually scrolling, given a list's ref. */
export function scrollerFrom(ref: RefObject<unknown>): HTMLElement | null {
  const base = ref.current as Scrollable | null;
  const node = base?.getScrollableNode?.() ?? null;
  if (!node) return null;
  const scrolls = (el: HTMLElement | null): boolean =>
    !!el && (el.scrollHeight > el.clientHeight + 40 || el.scrollWidth > el.clientWidth + 40);
  if (scrolls(node)) return node;
  for (const el of Array.from(node.querySelectorAll<HTMLElement>('div'))) {
    if (scrolls(el)) return el;
  }
  let up: HTMLElement | null = node.parentElement;
  while (up && up !== document.body) {
    if (scrolls(up)) return up;
    up = up.parentElement;
  }
  return null;
}

/**
 * Turn on the browser's own snap for a list, and keep it on.
 *
 * `axis` is 'y' for a pager and 'x' for a rail. Pass `enabled: false` while the
 * list is not on screen — snap is enforced by the browser on scroll, and there
 * is no scroll to enforce while a sheet is closed.
 */
export function useWebSnap(ref: RefObject<unknown>, axis: 'x' | 'y', enabled = true): void {
  useEffect(() => {
    if (Platform.OS !== 'web' || !enabled) return;

    const scroller = scrollerFrom(ref);
    if (!scroller) return;

    const pagesOf = (): HTMLElement[] => {
      const content = (scroller.firstElementChild as HTMLElement | null) ?? null;
      return content ? (Array.from(content.children) as HTMLElement[]) : [];
    };

    const snapOn = () => {
      scroller.style.scrollSnapType = `${axis} mandatory`;
      scroller.style[axis === 'y' ? 'overscrollBehaviorY' : 'overscrollBehaviorX'] = 'contain';
      for (const page of pagesOf()) {
        page.style.scrollSnapAlign = axis === 'y' ? 'start' : 'start';
        // `always` is what stops one flick sailing past three pages: the browser
        // must come to rest on the next snap point before it may carry on.
        page.style.scrollSnapStop = 'always';
      }
    };

    snapOn();
    const content = scroller.firstElementChild;
    const observer = typeof MutationObserver !== 'undefined' && content
      ? new MutationObserver(() => snapOn())
      : null;
    observer?.observe(content as HTMLElement, { childList: true, subtree: false });

    return () => {
      observer?.disconnect();
      scroller.style.scrollSnapType = '';
      scroller.style.overscrollBehaviorY = '';
      scroller.style.overscrollBehaviorX = '';
      for (const page of pagesOf()) {
        page.style.scrollSnapAlign = '';
        page.style.scrollSnapStop = '';
      }
    };
  }, [ref, axis, enabled]);
}
