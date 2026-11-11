import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Txt } from '../Txt';
import { useTheme } from '../../theme/ThemeProvider';
import { haptic } from '../../lib/haptics';
import { CrushIcon } from '../Logo';
import { formatCount } from '../../lib/counts';
import type { ReactionKind } from '../../api/types';
import { REACTION_ROW, reactionLook, type ShownReaction } from '../../lib/reactions';

/**
 * The seven reactions, and the gesture that reaches them.
 *
 * A single tap on a heart is one bit, so five kinds behind one tap is five kinds
 * nobody could reach — which is why the app only ever sent `crush`. Press and
 * hold opens the row; a tap gives your current reaction, or a crush if you have
 * none. That is the gesture everybody already knows from Facebook, and it is
 * what was asked for.
 *
 * The animation is drawn rather than shipped: each emoji pops in on a spring,
 * slightly after the one beside it, and the chosen one flies up and fades. No
 * Lottie file per reaction, nothing to download, and it reads the same on a
 * phone and in a browser.
 *
 * `clap` is in the type and not in the row. Rows written before today carry it,
 * and a kind that nobody can reach but everybody can still see is the honest
 * way to retire it.
 */

export type { ShownReaction } from '../../lib/reactions';
export { REACTION_ROW, reactionLook } from '../../lib/reactions';

/** How long a press has to last before the row opens instead of reacting. */
const HOLD_MS = 260;

/**
 * Only one row of reactions is open at a time.
 *
 * Without a backdrop there is nothing stopping two posts from each holding an
 * open row, and two rows of faces floating over a feed is not a pop-up, it is a
 * mess. Opening one closes the last.
 */
let closeOpenRow: (() => void) | null = null;

/** One reaction control. */
export function ReactionButton({
  myReaction,
  count,
  onReact,
  size = 24,
  disabled = false,
  word,
}: {
  myReaction?: ReactionKind | null;
  count?: number;
  onReact: (kind: ShownReaction) => void;
  size?: number;
  disabled?: boolean;
  /**
   * Draw the control as the word "Crush" instead of a face.
   *
   * A comment's actions are words — Reply is a word — and a row of emoji beside
   * it made the two things look like they came from different apps. The gesture
   * is identical: tap is a crush, hold opens the seven.
   */
  word?: boolean;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [flying, setFlying] = useState<{ kind: ShownReaction; id: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const control = useRef<View>(null);
  const look = reactionLook(myReaction);

  /** Where the control sits, in window coordinates — used to keep the row on screen. */
  const place = useCallback(() => {
    const node = control.current as unknown as {
      measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void;
    };
    if (!node?.measureInWindow) return setAnchor(null);
    node.measureInWindow((x, y, w, h) => setAnchor({ x, y, w, h }));
  }, []);

  const close = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (idle.current) { clearTimeout(idle.current); idle.current = null; }
    setOpen(false);
    if (closeOpenRow === close) closeOpenRow = null;
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (idle.current) clearTimeout(idle.current);
    if (closeOpenRow === close) closeOpenRow = null;
  }, [close]);

  const start = () => {
    held.current = false;
    if (disabled) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      held.current = true;
      haptic.tap();
      place();
      closeOpenRow?.();
      closeOpenRow = close;
      setOpen(true);
      // A row that appeared out of a hold should not sit there forever if the
      // hand wanders off; it goes on its own.
      if (idle.current) clearTimeout(idle.current);
      idle.current = setTimeout(() => setOpen(false), 6000);
    }, HOLD_MS);
  };

  const end = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    // A hold already answered the question; the release must not also react.
    if (held.current) { held.current = false; return; }
    setOpen(false);
    if (disabled) return;
    onReact((look ? (myReaction as ShownReaction) : 'crush'));
  };

  const choose = (kind: ShownReaction) => {
    setOpen(false);
    if (idle.current) { clearTimeout(idle.current); idle.current = null; }
    haptic.tap();
    setFlying({ kind, id: Date.now() });
    onReact(kind);
  };

  return (
    <View ref={control} style={{ alignItems: 'center', overflow: 'visible' }} collapsable={false}>
      <Pressable
        onPressIn={start}
        onPressOut={end}
        delayLongPress={HOLD_MS}
        accessibilityRole="button"
        accessibilityLabel={
          look
            ? `${look.word}, ${count ?? 0}. Hold for more reactions.`
            : `React. Hold for seven reactions.`
        }
        hitSlop={10}
        testID="reaction-control"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
      >
        {/* Given, the control wears holUpp's own mark in the Crush colour;
            not yet, it is an outline heart, which is a shape and not a brand. */}
        {word ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {look ? <CrushIcon size={Math.max(size - 4, 10)} color={look.tint} filled /> : null}
            <Txt
              variant="small"
              style={{ fontWeight: '700', color: look ? look.tint : colors.textSecondary }}
            >
              Crush
            </Txt>
          </View>
        ) : look?.mark ? (
          <CrushIcon size={size} color={look.tint} filled />
        ) : look?.emoji ? (
          <Txt style={{ fontSize: size }}>{look.emoji}</Txt>
        ) : (
          <Ionicons name="heart-outline" size={size} color={colors.textSecondary} />
        )}
        {count != null && count > 0 ? (
          <Txt variant="small" color="textSecondary">{formatCount(count)}</Txt>
        ) : null}
      </Pressable>

      {flying ? <Fly key={flying.id} kind={flying.kind} onDone={() => setFlying(null)} /> : null}

      <ReactionRow
        visible={open}
        anchor={anchor}
        current={myReaction}
        onPick={choose}
        onDismiss={close}
      />
    </View>
  );
}

/**
 * The row of faces: a pop-up beside the control, on the screen the control is on.
 *
 * Three rules in here, each of which was a complaint first:
 *
 *  · **It never leaves its own screen.** It used to be a `Modal`, and a modal on
 *    a phone owns the whole app: the row could sit above a different screen or be
 *    caught sliding away after the page had already changed. This is a plain view
 *    inside the same wrapper as the control, so it is bound to that page by
 *    construction — it cannot be on any other one.
 *  · **No background.** No scrim, no dimming, no film over the app. The only
 *    thing that appears is seven faces. A press anywhere else closes it (caught
 *    at the document on web, and by a six-second idle timer everywhere), so
 *    nothing has to be painted to make it dismissible.
 *  · **Small.** Seven faces at 30 px with 40 px of padding each made a bar that
 *    spanned the phone. 22 px in a 30 px slot is a pop-up you can see the screen
 *    around.
 */
const ROW_EMOJI = 22;
const SLOT = 30;
const PILL_PAD = 5;
const ROW_H = ROW_EMOJI + PILL_PAD * 2 + 8;

/** The seven faces, in a pill. Placement is the caller's problem. */
function ReactionPill({
  current,
  onPick,
}: {
  current?: ReactionKind | null;
  onPick: (kind: ShownReaction) => void;
}) {
  const { colors } = useTheme();
  return (
    <View
      testID="reaction-row"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: PILL_PAD,
        paddingVertical: PILL_PAD,
        borderRadius: 18,
        backgroundColor: colors.elevated,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.borderStrong,
        ...(Platform.OS === 'web' ? { boxShadow: '0 8px 20px rgba(0,0,0,0.42)' } : { elevation: 8 }),
      }}
    >
      {REACTION_ROW.map((r, i) => (
        <Pop
          key={r.kind}
          delay={i * 22}
          active={current === r.kind}
          onPress={() => onPick(r.kind)}
          emoji={r.emoji}
          mark={r.mark}
          tint={r.tint}
          word={r.word}
          size={ROW_EMOJI}
          slot={SLOT}
        />
      ))}
    </View>
  );
}

/**
 * The same pill, as a screen-level pop-up at a point the caller supplies.
 *
 * Whispers use this: a long press on a Whisper opens the seven faces beside the
 * bubble at the point that was pressed, not a sheet sliding up from the bottom of
 * the screen. It carries no backdrop — the tap-catcher below is transparent, so
 * nothing is painted over the conversation; the next tap anywhere simply closes
 * the row.
 */
export function ReactionPopup({
  visible,
  at,
  current,
  onPick,
  onDismiss,
  children,
}: {
  visible: boolean;
  at: { x: number; y: number } | null;
  current?: ReactionKind | null;
  onPick: (kind: ShownReaction) => void;
  onDismiss: () => void;
  /** Extra rows under the faces — copy, flag — on the same floating card. */
  children?: React.ReactNode;
}) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const ROW_W = REACTION_ROW.length * SLOT + PILL_PAD * 2;

  useEffect(() => {
    if (!visible || Platform.OS !== 'web') return;
    const onDown = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-testid="reaction-row"]')) return;
      onDismiss();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [visible, onDismiss]);

  if (!visible || !at) return null;

  const left = Math.min(Math.max(at.x - ROW_W / 2, 6), Math.max(width - ROW_W - 6, 6));
  const above = at.y - ROW_H - 12;
  const top = above > 6 ? above : at.y + 12;

  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 300 }]}>
      {/* Invisible, and only there to close the row on the next tap. */}
      <Pressable
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel="Close reactions"
        style={StyleSheet.absoluteFill}
      />
      <View
        style={{
          position: 'absolute',
          left,
          top,
          borderRadius: 18,
          overflow: 'hidden',
          backgroundColor: children ? colors.elevated : 'transparent',
          ...(children && Platform.OS === 'web' ? { boxShadow: '0 8px 20px rgba(0,0,0,0.42)' } : null),
        }}
      >
        <ReactionPill current={current} onPick={onPick} />
        {children ? <View style={{ paddingVertical: 2 }}>{children}</View> : null}
      </View>
    </View>
  );
}

function ReactionRow({
  visible,
  anchor,
  current,
  onPick,
  onDismiss,
}: {
  visible: boolean;
  anchor: { x: number; y: number; w: number; h: number } | null;
  current?: ReactionKind | null;
  onPick: (kind: ShownReaction) => void;
  onDismiss: () => void;
}) {
  const { width } = useWindowDimensions();
  const ROW_W = REACTION_ROW.length * SLOT + PILL_PAD * 2;

  /*
   * Drawn inside the control's own wrapper, so its offsets are relative to the
   * control — but clamped against window coordinates, which is the only way to
   * know it will not run off the edge of the screen.
   */
  /*
   * Anchored to the control's own left edge, not centred on it.
   *
   * Centred, the pill sat over the middle of the post and read as a bar laid
   * across the words. Growing from the button's edge instead is what makes it
   * read as a pop-up belonging to that button — and it leaves the words either
   * side of it readable.
   */
  const left = anchor
    ? Math.min(Math.max(anchor.x - 4, 6), Math.max(width - ROW_W - 6, 6)) - anchor.x
    : -(ROW_W / 2);
  const top = anchor && anchor.y < ROW_H + 30 ? anchor.h + 8 : -(ROW_H + 10);

  useEffect(() => {
    if (!visible || Platform.OS !== 'web') return;
    const onDown = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-testid="reaction-row"]')) return;
      // A press on any reaction control is that control opening its own row.
      if (target.closest('[data-testid="reaction-control"]')) return;
      onDismiss();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [visible, onDismiss]);

  if (!visible) return null;

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left, top, zIndex: 50 }}>
      <ReactionPill current={current} onPick={onPick} />
    </View>
  );
}

/** One emoji: springs up from nothing, a beat after the one before it. */
function Pop({
  emoji,
  mark,
  tint,
  word,
  delay,
  active,
  onPress,
  size,
  slot,
}: {
  emoji?: string;
  mark?: true;
  tint: string;
  word: string;
  delay: number;
  active: boolean;
  onPress: () => void;
  size: number;
  slot: number;
}) {
  const scale = useRef(new Animated.Value(0.2)).current;
  const lift = useRef(new Animated.Value(10)).current;
  useEffect(() => {
    const a = Animated.parallel([
      Animated.timing(scale, { toValue: 1, duration: 220, delay, easing: Easing.out(Easing.back(2.4)), useNativeDriver: true }),
      Animated.timing(lift, { toValue: 0, duration: 200, delay, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]);
    a.start();
    return () => a.stop();
  }, [scale, lift, delay]);
  return (
    <Animated.View style={{ transform: [{ scale }, { translateY: lift }] }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={word}
        hitSlop={4}
        style={({ pressed }) => ({
          width: slot,
          height: slot,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: slot / 2,
          transform: [{ scale: pressed ? 1.3 : active ? 1.12 : 1 }],
        })}
      >
        {mark ? <CrushIcon size={size} color={tint} filled /> : <Txt style={{ fontSize: size }}>{emoji}</Txt>}
      </Pressable>
    </Animated.View>
  );
}

/**
 * The reaction you just chose, flying up and out.
 *
 * This is the part that makes a tap feel like it did something: it leaves the
 * control, grows slightly, and fades — then unmounts itself so nothing is left
 * animating behind a scroll.
 */
function Fly({ kind, onDone }: { kind: ShownReaction; onDone: () => void }) {
  const look = reactionLook(kind);
  const rise = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const grow = useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    const a = Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 120, useNativeDriver: true }),
      Animated.timing(rise, { toValue: -52, duration: 720, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.sequence([
        Animated.timing(grow, { toValue: 1.5, duration: 260, easing: Easing.out(Easing.back(3)), useNativeDriver: true }),
        Animated.timing(grow, { toValue: 1.1, duration: 460, useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.delay(430),
        Animated.timing(fade, { toValue: 0, duration: 290, useNativeDriver: true }),
      ]),
    ]);
    a.start(({ finished }) => { if (finished) onDone(); });
    return () => a.stop();
  }, [rise, fade, grow, onDone]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        bottom: 18,
        opacity: fade,
        transform: [{ translateY: rise }, { scale: grow }],
      }}
    >
      {look?.mark ? <CrushIcon size={22} color={look.tint} filled /> : <Txt style={{ fontSize: 22 }}>{look?.emoji}</Txt>}
    </Animated.View>
  );
}
