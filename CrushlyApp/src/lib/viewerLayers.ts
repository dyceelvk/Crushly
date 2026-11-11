/**
 * Who owns the finger, on a full-screen viewer.
 *
 * The Flow and the Moments viewer both fill the screen with a surface whose job
 * is to read gestures: tap for the next one, hold to pause, swipe to leave. That
 * surface has to be *under* every control, or the controls are decoration — a
 * reply box you can tap all day and nothing happens, a Close button that closes
 * nothing, because the gesture surface is what actually receives the touch.
 *
 * It was the other way round. The tap surface carried `zIndex: 1` and the header
 * and the reply bar carried none, so on both platforms the surface painted over
 * them: measured on the Moments viewer, the element on top of the reply field was
 * `button[Moments player]`. Every control in the bottom half of that screen was
 * dead, which reads as "you can't do anything" rather than as a stacking bug.
 *
 * The order below is the whole rule, and it is in one place so it can be tested
 * without a phone. Higher is nearer the finger.
 *
 *   0  pager    the gesture surface — the biggest thing, the lowest
 *   2  card     a shared post's card; above the pager so tapping it opens it
 *   3  content  words and captions, where links live
 *   6  chrome   the header and the bar at the bottom: anything you can press
 *
 * Anything you can press must be > pager. Anything that is only looked at may
 * sit at pager level, where a tap falls through to the gesture.
 */
export const VIEWER_LAYERS = {
  pager: 0,
  card: 2,
  content: 3,
  chrome: 6,
} as const;

export type ViewerLayer = keyof typeof VIEWER_LAYERS;

/**
 * Every layer that must answer a finger, in the order a finger meets them.
 * Used by the tests to prove the ordering rule rather than restate it.
 */
export const PRESSABLE_LAYERS: ViewerLayer[] = ['card', 'content', 'chrome'];

/** True when `layer` answers a finger rather than passing it through. */
export function isPressableLayer(layer: ViewerLayer): boolean {
  return VIEWER_LAYERS[layer] > VIEWER_LAYERS.pager;
}
