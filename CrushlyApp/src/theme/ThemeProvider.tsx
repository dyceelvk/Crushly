import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, useColorScheme } from 'react-native';
import { palettes, type Palette } from './tokens';
import { storage } from '../lib/storage';

export type Appearance = 'dark' | 'light' | 'system';

type ThemeContextValue = {
  colors: Palette;
  appearance: Appearance;
  setAppearance: (a: Appearance) => void;
  reduceMotion: boolean;
};

const ThemeContext = createContext<ThemeContextValue>({
  colors: palettes.dark,
  appearance: 'dark',
  setAppearance: () => {},
  reduceMotion: false,
});

const APPEARANCE_KEY = 'crushly.appearance';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [appearance, setAppearanceState] = useState<Appearance>('dark');
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    storage.get(APPEARANCE_KEY).then((v) => {
      if (v === 'dark' || v === 'light' || v === 'system') setAppearanceState(v);
    });
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const scheme = appearance === 'system' ? (system === 'light' ? 'light' : 'dark') : appearance;
    return {
      colors: palettes[scheme],
      appearance,
      reduceMotion,
      setAppearance: (a) => {
        setAppearanceState(a);
        storage.set(APPEARANCE_KEY, a);
      },
    };
  }, [appearance, system, reduceMotion]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

/**
 * Memoized, theme-aware style factory:
 *   const styles = useStyles((c) => ({ box: { backgroundColor: c.card } }));
 */
export function useStyles<T>(factory: (c: Palette) => T): T {
  const { colors } = useTheme();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => factory(colors), [colors]);
}
