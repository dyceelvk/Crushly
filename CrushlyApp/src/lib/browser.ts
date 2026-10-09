/** React Native defines window = global, but it is not a browser. */
export type BrowserLocation = { pathname?: string; search?: string; hash?: string; origin?: string };
export function browserLocation(platform: string, candidate: { location?: BrowserLocation } | undefined): BrowserLocation | undefined {
  return platform === 'web' ? candidate?.location : undefined;
}
