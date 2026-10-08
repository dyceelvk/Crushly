import React, { useMemo, useRef, useState } from 'react';
import { AccessibilityActionEvent, PanResponder, View, type LayoutChangeEvent } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

const THUMB = 28;

type RangeProps = {
  min: number;
  max: number;
  low: number;
  high?: number;
  step?: number;
  onChange: (low: number, high: number) => void;
  label: string;
  /** Single-thumb mode when `high` is omitted. */
  formatValue?: (v: number) => string;
};

/**
 * Dependency-free slider (single or range) built on PanResponder so it works
 * identically on iOS, Android and web. Fully adjustable with screen readers.
 */
export function RangeSlider({ min, max, low, high, step = 1, onChange, label, formatValue = String }: RangeProps) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const range = high !== undefined;
  const state = useRef({ low, high: high ?? max, startLow: low, startHigh: high ?? max });
  state.current.low = low;
  state.current.high = high ?? max;

  const usable = Math.max(1, width - THUMB);
  const toX = (v: number) => ((v - min) / (max - min)) * usable;
  const toValue = (x: number) => {
    const raw = min + (Math.min(Math.max(x, 0), usable) / usable) * (max - min);
    return Math.round(raw / step) * step;
  };

  const makeResponder = (which: 'low' | 'high') =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        state.current.startLow = state.current.low;
        state.current.startHigh = state.current.high;
      },
      onPanResponderMove: (_e, g) => {
        const s = state.current;
        if (which === 'low') {
          let v = toValue(toX(s.startLow) + g.dx);
          if (range) v = Math.min(v, s.high - step);
          if (v !== s.low) onChange(v, s.high);
        } else {
          const v = Math.max(toValue(toX(s.startHigh) + g.dx), s.low + step);
          if (v !== s.high) onChange(s.low, v);
        }
      },
    });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const lowResponder = useMemo(() => makeResponder('low'), [width, range, step, min, max]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const highResponder = useMemo(() => makeResponder('high'), [width, range, step, min, max]);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const a11y = (which: 'low' | 'high') => (e: AccessibilityActionEvent) => {
    const s = state.current;
    const delta = e.nativeEvent.actionName === 'increment' ? step : -step;
    if (which === 'low') {
      const v = Math.min(Math.max(s.low + delta, min), range ? s.high - step : max);
      onChange(v, s.high);
    } else {
      const v = Math.max(Math.min(s.high + delta, max), s.low + step);
      onChange(s.low, v);
    }
  };

  const lowX = toX(low);
  const highX = range ? toX(high!) : lowX;
  const thumbStyle = {
    position: 'absolute' as const, top: 0, width: THUMB, height: THUMB, borderRadius: THUMB / 2, backgroundColor: colors.text,
    borderWidth: 3, borderColor: colors.gold, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3,
  };

  return (
    <View style={{ height: 44, justifyContent: 'center' }} onLayout={onLayout}>
      <View style={{ height: THUMB, justifyContent: 'center' }}>
        <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.elevated, marginHorizontal: THUMB / 2 }} />
        {width > 0 ? (
          <>
            <View
              style={{
                position: 'absolute', height: 4, borderRadius: 2, backgroundColor: colors.gold,
                left: (range ? lowX : 0) + THUMB / 2, width: Math.max(0, (range ? highX - lowX : lowX)),
              }}
            />
            <View
              {...lowResponder.panHandlers}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessible
              accessibilityRole="adjustable"
              accessibilityLabel={range ? `${label}, minimum` : label}
              accessibilityValue={{ text: formatValue(low) }}
              accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
              onAccessibilityAction={a11y('low')}
              style={[thumbStyle, { left: lowX }]}
            />
            {range ? (
              <View
                {...highResponder.panHandlers}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessible
                accessibilityRole="adjustable"
                accessibilityLabel={`${label}, maximum`}
                accessibilityValue={{ text: formatValue(high!) }}
                accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
                onAccessibilityAction={a11y('high')}
                style={[thumbStyle, { left: highX }]}
              />
            ) : null}
          </>
        ) : null}
      </View>
    </View>
  );
}
