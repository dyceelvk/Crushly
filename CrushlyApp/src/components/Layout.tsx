import React from 'react';
import {
  KeyboardAvoidingView, Platform, RefreshControl, ScrollView, View, useWindowDimensions,
  type ScrollViewProps, type StyleProp, type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Txt } from './Txt';
import { IconButton } from './IconButton';
import { useTheme } from '../theme/ThemeProvider';
import { space } from '../theme/tokens';

/** Responsive metrics shared by every screen. */
export function useLayout() {
  const { width, height } = useWindowDimensions();
  const isTablet = width >= 700;
  const contentWidth = Math.min(width, isTablet ? 720 : width);
  const gutter = width < 360 ? 16 : 20;
  const columns = width >= 1000 ? 4 : width >= 700 ? 3 : 2;
  return { width, height, isTablet, contentWidth, gutter, columns, compact: width < 360 || height < 680 };
}

type ScreenProps = {
  children: React.ReactNode;
  scroll?: boolean;
  edges?: Edge[];
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  keyboard?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  footer?: React.ReactNode;
  scrollProps?: ScrollViewProps;
  padded?: boolean;
};

/**
 * Screen shell: safe areas, background, centered max-width column on tablets,
 * optional scrolling, keyboard avoidance and pull-to-refresh.
 */
export function Screen({
  children, scroll = true, edges = ['top'], style, contentStyle, keyboard, refreshing, onRefresh, footer, scrollProps, padded = true,
}: ScreenProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { contentWidth, gutter } = useLayout();
  const pad = {
    paddingTop: edges.includes('top') ? insets.top : 0,
    paddingBottom: edges.includes('bottom') ? insets.bottom : 0,
  };
  const column: ViewStyle = { width: '100%', maxWidth: contentWidth, alignSelf: 'center', paddingHorizontal: padded ? gutter : 0 };

  const body = scroll ? (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={[column, { paddingBottom: space.xxxl }, contentStyle]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      showsVerticalScrollIndicator={false}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.gold} colors={[colors.gold]} /> : undefined}
      {...scrollProps}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1 }, column, contentStyle]}>{children}</View>
  );

  const inner = (
    <View style={[{ flex: 1, backgroundColor: colors.bg }, pad, style]}>
      {body}
      {footer ? <View style={[column, { paddingTop: space.sm, paddingBottom: Math.max(insets.bottom, space.md) }]}>{footer}</View> : null}
    </View>
  );

  if (!keyboard) return inner;
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {inner}
    </KeyboardAvoidingView>
  );
}

type HeaderProps = {
  title?: string;
  subtitle?: string;
  back?: boolean;
  onBack?: () => void;
  right?: React.ReactNode;
  large?: boolean;
  center?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Header({ title, subtitle, back, onBack, right, large = true, center, style }: HeaderProps) {
  const navigation = useNavigation();
  const showBack = back ?? false;
  return (
    <View style={[{ paddingTop: space.sm, paddingBottom: large ? space.lg : space.sm }, style]}>
      {showBack || (!large && title) || (!large && right) ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, marginBottom: large && title ? space.sm : 0 }}>
          {showBack ? (
            <IconButton icon="chevron-back" label="Go back" onPress={onBack || (() => navigation.goBack())} />
          ) : (
            <View style={{ width: 44 }} />
          )}
          <View style={{ flex: 1, alignItems: center || !large ? 'center' : 'flex-start', paddingHorizontal: 8 }}>
            {!large && title ? (
              <Txt variant="subheading" numberOfLines={1} accessibilityRole="header">
                {title}
              </Txt>
            ) : null}
          </View>
          <View style={{ minWidth: 44, alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>{!large || showBack ? right : null}</View>
        </View>
      ) : null}
      {large && title ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Txt variant="display" accessibilityRole="header">
              {title}
            </Txt>
            {subtitle ? (
              <Txt variant="body" color="textSecondary" style={{ marginTop: 4 }}>
                {subtitle}
              </Txt>
            ) : null}
          </View>
          {!showBack && right ? <View style={{ flexDirection: 'row', gap: 8, paddingTop: 2 }}>{right}</View> : null}
        </View>
      ) : null}
      {!large && subtitle ? (
        <Txt variant="small" color="textSecondary" align="center">
          {subtitle}
        </Txt>
      ) : null}
    </View>
  );
}

export function SectionTitle({ title, action, style }: { title: string; action?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.sm }, style]}>
      <Txt variant="label" color="textSecondary" accessibilityRole="header">
        {title}
      </Txt>
      {action}
    </View>
  );
}

export function Card({ children, style, elevated }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; elevated?: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        { backgroundColor: elevated ? colors.elevated : colors.card, borderRadius: 22, borderWidth: 1, borderColor: colors.border, padding: space.md },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export const Spacer = ({ h = 16, w }: { h?: number; w?: number }) => <View style={{ height: h, width: w }} />;
