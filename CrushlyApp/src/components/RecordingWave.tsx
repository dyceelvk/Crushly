import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

/**
 * The waveform you see while you are the one recording.
 *
 * Every bar is a real sample: `metering` from the recorder, in dBFS (roughly
 * −160 silent to 0 loud), pushed into a rolling buffer. Nothing here is
 * generated — if the platform reports no levels, the bars sit flat and low,
 * which is the honest picture of "we cannot hear a level", not a decoration
 * pretending to be your voice.
 *
 * The other side gets no waveform, because the other side has no meter. They get
 * a recording state and a timer; inventing a wave for them would be a lie about
 * data we do not have.
 */
export function RecordingWave({
  level,
  bars = 28,
  height = 20,
  color,
}: {
  /** dBFS from the recorder, or null/undefined when the platform has none. */
  level?: number | null;
  bars?: number;
  height?: number;
  color?: string;
}) {
  const { colors } = useTheme();
  const [history, setHistory] = useState<number[]>(() => new Array(bars).fill(0));
  const levelRef = useRef<number | null>(null);
  levelRef.current = level ?? null;

  useEffect(() => {
    const timer = setInterval(() => {
      const db = levelRef.current;
      // Map −60…0 dB to 0.08…1. Anything below the floor is the floor: a silent
      // room still draws a thin line rather than a hole.
      const next = db == null || !Number.isFinite(db) ? 0.08 : Math.max(0.08, Math.min(1, (db + 60) / 60));
      setHistory((prev) => [...prev.slice(-(bars - 1)), next]);
    }, 90);
    return () => clearInterval(timer);
  }, [bars]);

  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: 2, height, flex: 1 }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {history.map((v, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            height: Math.max(2, v * height),
            borderRadius: 2,
            backgroundColor: color ?? colors.crush,
            opacity: 0.35 + v * 0.65,
          }}
        />
      ))}
    </View>
  );
}
