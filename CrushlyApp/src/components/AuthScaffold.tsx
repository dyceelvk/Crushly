import React from 'react';
import { Pressable, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Screen } from './Layout';
import { Glow } from './Ambient';
import { IconButton } from './IconButton';
import { Logo } from './Logo';
import { Txt } from './Txt';
import { useTheme } from '../theme/ThemeProvider';
import { HIT, rhythm, space, stroke } from '../theme/tokens';

type Props = {
  /** The screen's headline. One per screen, and it is the accessibility header. */
  title: string;
  /** One or two sentences of orientation. Never instructions for the fields below. */
  lede?: React.ReactNode;
  /** Optional small label above the headline — "Step 1 of 2", "Account". */
  eyebrow?: string;
  children?: React.ReactNode;
  /** The primary action. Lives in the pinned footer so it never scrolls away. */
  cta?: React.ReactNode;
  /**
   * Quiet rows that belong with the action: switch account, back to sign in,
   * legal notes. Rendered directly above the primary button rather than after
   * the last field, so the screen reads as two anchored groups — the fields at
   * the top, the way out at the bottom — instead of a short form that runs out
   * of content two-thirds of the way down.
   */
  footnote?: React.ReactNode;
  onBack?: () => void;
  hideBack?: boolean;
};

/**
 * The frame every account screen shares.
 *
 * Before this existed, SignIn, SignUp, Forgot and SetPassword each opened with a
 * floating 44pt mark, then a headline at an arbitrary offset, then fields — which
 * meant four screens that were meant to feel like one flow each looked slightly
 * different, and none of them looked like the Welcome screen that led into them.
 *
 * The frame is a top bar (back + wordmark lockup, hairlined off the page), a
 * headline block, the fields, and quiet footnotes. All four screens now differ
 * only in their words and which fields they show — which is the point.
 *
 * Spacing comes from `rhythm`, not from ad-hoc numbers: the top bar, the
 * headline block and the fields sit a `section` apart, and things inside the
 * fields sit a `group` apart.
 */
export function AuthScaffold({ title, lede, eyebrow, children, cta, footnote, onBack, hideBack }: Props) {
  const { colors } = useTheme();
  const navigation = useNavigation();

  return (
    <Screen
      keyboard
      footer={
        cta || footnote ? (
          <>
            {footnote ? <View style={{ marginBottom: space.sm }}>{footnote}</View> : null}
            {cta}
          </>
        ) : undefined
      }
    >
      {/* A single soft light in the empty lower half. A two-field form leaves a
          lot of navy on a tall phone, and flat navy reads as "nothing loaded";
          depth is cheaper than filling that space with elements. */}
      <Glow size={560} color={colors.crush} opacity={0.42} style={{ position: 'absolute', top: 300, left: -240 }} />

      {/* App bar. A back control and the wordmark, both at 44pt, so the mark
          stops being a sticker floating above the headline and becomes part of
          the chrome — the same reason a browser has one toolbar, not two. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: space.sm }}>
        {hideBack ? (
          <View style={{ width: HIT, height: HIT }} />
        ) : (
          <IconButton
            icon="chevron-back"
            label="Go back"
            variant="plain"
            onPress={onBack || (() => navigation.goBack())}
          />
        )}
        <View style={{ flex: 1, alignItems: 'center' }} accessible accessibilityLabel="Crushly">
          <Logo size={22} />
        </View>
        <View style={{ width: HIT, height: HIT }} />
      </View>
      <View style={{ height: stroke.hairline, backgroundColor: colors.border, marginTop: space.sm }} />

      {/* Headline block. */}
      <View style={{ marginTop: rhythm.section }}>
        {eyebrow ? (
          <Txt variant="label" color="primary" style={{ marginBottom: rhythm.tight }}>
            {eyebrow}
          </Txt>
        ) : null}
        <Txt variant="title" accessibilityRole="header">
          {title}
        </Txt>
        {lede ? (
          <Txt variant="body" color="textSecondary" style={{ marginTop: space.xs, maxWidth: 340 }}>
            {lede}
          </Txt>
        ) : null}
      </View>

      {children ? <View style={{ marginTop: rhythm.section }}>{children}</View> : null}
    </Screen>
  );
}

/**
 * "New here? Create an account" — the quiet switch at the bottom of an account
 * screen. Full 44pt tall so it is a real target, but visually just two words.
 */
export function AuthSwitch({
  lead,
  action,
  onPress,
  hint,
}: {
  lead: string;
  action: string;
  onPress: () => void;
  hint?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={hint || action}
      hitSlop={HIT / 2}
      style={({ pressed }) => ({
        minHeight: HIT,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Txt variant="small" color="textSecondary" align="center">
        {lead} <Txt variant="smallStrong" color="gold">{action}</Txt>
      </Txt>
    </Pressable>
  );
}
