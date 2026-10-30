/** Explicit dimensions matter on web: HTML video is a replaced element and
 * keeps its intrinsic pixel width even when left and right are both zero. */
export const VIDEO_FRAME_FILL = {
  position: 'absolute' as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: '100%' as const,
  height: '100%' as const,
};
