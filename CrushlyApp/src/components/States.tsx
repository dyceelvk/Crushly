import React, { useEffect, useRef } from 'react';
import { Animated, Platform, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Txt } from './Txt';
import { Button } from './Button';
import { CrushIcon } from './Logo';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';

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
    <View style={[{ alignItems: 'center', paddingVertical: space.xxxl, paddingHorizontal: space.xl }, style]}>
      <View style={{ width: 96, height: 96, alignItems: 'center', justifyContent: 'center', marginBottom: space.lg }}>
        <LinearGradient
          colors={[colors.goldSoft, 'transparent']}
          style={{ position: 'absolute', width: 96, height: 96, borderRadius: 48 }}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
        />
        <View
          style={{
            width: 64, height: 64, borderRadius: 32, borderWidth: 1, borderColor: colors.goldLine,
            alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card,
          }}
        >
          {icon === 'crush' ? <CrushIcon size={28} color={colors.gold} /> : <Ionicons name={icon} size={26} color={colors.gold} />}
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
        <View style={{ marginTop: space.xl, alignSelf: 'stretch', maxWidth: 320, width: '100%', marginHorizontal: 'auto' }}>
          <Button title={action.label} onPress={action.onPress} variant={action.variant || 'primary'} size="md" />
        </View>
      ) : null}
      {secondary ? (
        <View style={{ marginTop: space.xs, alignSelf: 'stretch', maxWidth: 320, width: '100%' }}>
          <Button title={secondary.label} onPress={secondary.onPress} variant="ghost" size="md" />
        </View>
      ) : null}
    </View>
  );
}

export function ErrorState({ message, onRetry, style }: { message?: string; onRetry?: () => void; style?: StyleProp<ViewStyle> }) {
  return (
    <EmptyState
      icon="cloud-offline-outline"
      title="We lost the thread"
      message={message || 'Something interrupted the connection. Give it another try.'}
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
      <LinearGradient colors={[colors.goldBright, colors.gold]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: `${pct * 100}%`, height: '100%' }} />
    </View>
  );
}
