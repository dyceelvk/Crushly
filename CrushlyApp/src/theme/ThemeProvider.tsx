import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, useColorScheme } from 'react-native';
import { palettes, type Palette } from './tokens';
import { storage } from '../lib/storage';

export type Appearance = 'dark' | 'light' | 'system';

type ThemeContextValue = {
  colors: Palette;
  appearance: Appearance;
  ready: boolean;
  setAppearance: (a: Appearance) => void;
  reduceMotion: boolean;
};

const ThemeContext = createContext<ThemeContextValue>({
  colors: palettes.dark,
  appearance: 'dark',
  ready: false,
  setAppearance: () => {},
  reduceMotion: false,
});

const APPEARANCE_KEY = 'crushly.appearance';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [appearance, setAppearanceState] = useState<Appearance>('dark');
  const [ready, setReady] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    storage.get(APPEARANCE_KEY).then((v) => {
      if (v === 'dark' || v === 'light' || v === 'system') setAppearanceState(v);
    }).catch(() => {}).finally(() => setReady(true));
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const scheme = appearance === 'system' ? (system === 'light' ? 'light' : 'dark') : appearance;
    return {
      colors: palettes[scheme],
      appearance,
      ready,
      reduceMotion,
      setAppearance: (a) => {
        setAppearanceState(a);
        storage.set(APPEARANCE_KEY, a);
      },
    };
  }, [appearance, ready, system, reduceMotion]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

/**
 * A noir island.
 *
 * The feed, the players and everything that sits on media are always black,
 * whichever appearance the member chose for the rest of the app — a white feed
 * behind a photograph is a photo with a border on it, and every phone in the
 * reference category behaves the same way. This overrides the palette for a
 * subtree instead of forking the components, so a screen opts in with one
 * wrapper and none of its children know the difference.
 */
export function NoirScope({ children }: { children: React.ReactNode }) {
  const { reduceMotion } = useTheme();
  const value = useMemo<ThemeContextValue>(
    () => ({ colors: palettes.dark, appearance: 'dark', ready: true, setAppearance: () => {}, reduceMotion }),
    [reduceMotion],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Memoized, theme-aware style factory:
 *   const styles = useStyles((c) => ({ box: { backgroundColor: c.card } }));
 */
export function useStyles<T>(factory: (c: Palette) => T): T {
  const { colors } = useTheme();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => factory(colors), [colors]);
}
