import React, { useEffect, useRef } from 'react';
import { Animated, Platform, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Txt } from './Txt';
import { Button } from './Button';
import { CrushIcon } from './Logo';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import { errorLine } from '../lib/errors';

type EmptyProps = {
  icon?: keyof typeof Ionicons.glyphMap | 'crush';
  title: string;
  message?: string;
  action?: { label: string; onPress: () => void; variant?: 'primary' | 'crush' | 'secondary' };
  secondary?: { label: string; onPress: () => void };
  style?: StyleProp<ViewStyle>;
};

/** Empty states invite the next action instead of apologizing. */
export function EmptyState({ icon = 'sparkles-outline', title, message, action, secondary, style }: EmptyProps) {
  const { colors } = useTheme();
  return (
    /* A notice, not a poster.
       The empty state used to be a 96 px halo around a 64 px disc with an xl
       button under it — half a screen, in the middle of a page, to say that one
       tab in particular had nothing in it yet. On a Space that page also has a
       cover, a face, a name and four tabs above it, so the notice pushed
       everything else out of reach and read as though the Space itself were
       empty. Smaller halo, smaller disc, a small button: enough to be seen,
       never enough to take the page. */
    <View style={[{ alignItems: 'center', paddingVertical: space.xxl, paddingHorizontal: space.lg }, style]}>
      <View style={{ width: 76, height: 76, alignItems: 'center', justifyContent: 'center', marginBottom: space.md }}>
        <LinearGradient
          colors={[colors.primarySoft, 'transparent']}
          style={{ position: 'absolute', width: 76, height: 76, borderRadius: 38 }}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
        />
        <View
          style={{
            width: 50, height: 50, borderRadius: 25, borderWidth: 1, borderColor: colors.primaryLine,
            alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card,
          }}
        >
          {icon === 'crush' ? <CrushIcon size={22} color={colors.primary} /> : <Ionicons name={icon} size={21} color={colors.primary} />}
        </View>
      </View>
      <Txt variant="title" align="center" accessibilityRole="header">
        {title}
      </Txt>
      {message ? (
        <Txt variant="body" color="textSecondary" align="center" style={{ marginTop: space.xs, maxWidth: 320 }}>
          {message}
        </Txt>
      ) : null}
      {action ? (
        <View style={{ marginTop: space.lg, alignSelf: 'stretch', maxWidth: 300, width: '100%', marginHorizontal: 'auto' }}>
          <Button title={action.label} onPress={action.onPress} variant={action.variant || 'primary'} size="sm" />
        </View>
      ) : null}
      {secondary ? (
        <View style={{ marginTop: space.xs, alignSelf: 'stretch', maxWidth: 320, width: '100%' }}>
          <Button title={secondary.label} onPress={secondary.onPress} variant="ghost" size="sm" />
        </View>
      ) : null}
    </View>
  );
}

/**
 * The one error state in the app.
 *
 * It takes the raw error rather than a string, and decides what a member may read
 * — see `lib/errors.ts`. Fourteen screens were passing `(err as Error).message`
 * straight in, so the app was printing `TypeError: Failed to fetch` and Postgres
 * constraint names at people. Sanitising here fixes every one of them, including
 * the ones written next month.
 *
 * The title is a prop because the same failure reads differently in different
 * places: "We lost the thread" is right in a conversation and odd on a profile.
 */
export function ErrorState({
  error,
  message,
  title = 'That didn’t load',
  onRetry,
  style,
}: {
  /** The error itself, if the caller still has it. Preferred over `message`. */
  error?: unknown;
  /** A message the caller wrote itself, or one that has already been vetted. */
  message?: string;
  title?: string;
  onRetry?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <EmptyState
      icon="cloud-offline-outline"
      title={title}
      message={errorLine(error ?? message, message)}
      action={onRetry ? { label: 'Try again', onPress: onRetry, variant: 'secondary' } : undefined}
      style={style}
    />
  );
}

/** Shimmering placeholder block. Static when Reduce Motion is on. */
export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const { colors, reduceMotion } = useTheme();
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(pulse, { toValue: 0, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { backgroundColor: colors.skeleton, borderRadius: radius.md, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }) },
        style,
      ]}
    />
  );
}

export function LoadingBlock({ label = 'Loading' }: { label?: string }) {
  return (
    <View accessible accessibilityLabel={label} accessibilityRole="progressbar" style={{ gap: 12, paddingTop: space.md }}>
      <Skeleton style={{ height: 22, width: '55%' }} />
      <Skeleton style={{ height: 14, width: '80%' }} />
      <Skeleton style={{ height: 160, borderRadius: radius.lg, marginTop: 8 }} />
      <Skeleton style={{ height: 14, width: '70%' }} />
      <Skeleton style={{ height: 14, width: '40%' }} />
    </View>
  );
}

export function ProgressBar({ value, style, label }: { value: number; style?: StyleProp<ViewStyle>; label?: string }) {
  const { colors } = useTheme();
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
      style={[{ height: 4, borderRadius: 2, backgroundColor: colors.elevated, overflow: 'hidden' }, style]}
    >
      <LinearGradient colors={[colors.primary, colors.primaryDeep, colors.crush]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: `${pct * 100}%`, height: '100%' }} />
    </View>
  );
}
