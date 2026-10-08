/**
 * Minimal typing for the one react-native-web export the app uses directly.
 * (react-native-web 0.21 ships without bundled declarations; everything else
 * comes through the 'react-native' alias.)
 */
declare module 'react-native-web' {
  import type { ReactElement } from 'react';
  export function unstable_createElement(type: string, props?: Record<string, unknown>): ReactElement;
}
