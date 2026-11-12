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
import { insideReactionUI } from '../../lib/reactionCard';

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
  onDark = false,
  framed = false,
}: {
  myReaction?: ReactionKind | null;
  count?: number;
  /**
   * Give a reaction, or `null` to take yours back.
   *
   * A tap has to be able to undo itself. It could not: the control sent the same
   * kind again, and giving a reaction twice is not taking it back — so a Crush
   * you had given stayed given however many times you tapped it. Now the tap
   * says what it means: tapping a reaction you already have sends `null`.
   */
  onReact: (kind: ShownReaction | null) => void;
  size?: number;
  disabled?: boolean;
  /** Draw it for a picture: a clip's controls sit on the video, not on a card. */
  onDark?: boolean;
  /**
   * Put the control in the same glass circle as the rest of a rail.
   *
   * On the Flow rail the reaction sat as two bare rings beside buttons that were
   * all in circles, so it did not read as a button at all — it read as a stray
   * mark. Same circle, same weight, same reach.
   */
  framed?: boolean;
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
  /**
   * The reaction this control last showed, until the data catches up.
   *
   * A tap has to change the mark under the finger. Waiting for the network means
   * a Crush that arrives half a second late — or, on a list that hands its rows
   * the same objects until it refetches, one that never arrives at all. `null`
   * here means "nothing tapped yet, follow the props"; any other value is what
   * the reader just did, and it is dropped the moment the props agree with it or
   * change underneath it.
   */
  const [local, setLocal] = useState<ReactionKind | null | undefined>(undefined);
  const shown = local !== undefined ? local : (myReaction ?? null);
  useEffect(() => { setLocal(undefined); }, [myReaction]);
  const look = reactionLook(shown);

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

  /**
   * The tap.
   *
   * This is `onPress`, not `onPressOut`. The reaction used to fire on release,
   * and a quick tap — a tap the browser completes in under about 40 ms — never
   * produced a press-in/press-out pair at all, so nothing happened: the control
   * looked dead. `onPress` is the standard click path and fires for every tap
   * however short it is. Press-in still starts the hold timer, and a hold marks
   * itself so the click that follows it does not also react.
   */
  const end = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  };

  const press = () => {
    // A hold already answered the question; the release must not also react.
    if (held.current) { held.current = false; return; }
    setOpen(false);
    if (disabled) return;
    // Already yours? The tap takes it back. Nothing yet? A Crush.
    if (look && shown) { haptic.soft(); setLocal(null); onReact(null); return; }
    setLocal('crush');
    onReact('crush');
  };

  const choose = (kind: ShownReaction) => {
    setOpen(false);
    if (idle.current) { clearTimeout(idle.current); idle.current = null; }
    haptic.tap();
    // The face you already wear is an undo, the same as tapping the control.
    if (shown === kind) { setLocal(null); onReact(null); return; }
    setLocal(kind);
    setFlying({ kind, id: Date.now() });
    onReact(kind);
  };

  return (
    <View ref={control} style={{ alignItems: 'center', overflow: 'visible' }} collapsable={false}>
      <Pressable
        onPressIn={start}
        onPressOut={end}
        onPress={press}
        delayLongPress={HOLD_MS}
        accessibilityRole="button"
        accessibilityLabel={
          look
            ? `${look.word}, ${count ?? 0}. Hold for more reactions.`
            : `React. Hold for seven reactions.`
        }
        hitSlop={10}
        testID="reaction-control"
        style={[
          { flexDirection: 'row', alignItems: 'center', gap: 6 },
          framed
            ? {
                width: 46,
                height: 46,
                borderRadius: 23,
                justifyContent: 'center',
                backgroundColor: 'rgba(20,20,23,0.58)',
                borderWidth: 1,
                borderColor: colors.borderStrong,
              }
            : null,
        ]}
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
          /*
           * Nothing given yet: the holUpp mark, drawn in outline.
           *
           * It was a heart outline, which is somebody else's symbol and the one
           * thing the owner has now rejected three times. The control should look
           * like this app before you touch it and like this app after.
           */
          <CrushIcon size={size} color={onDark ? 'rgba(255,255,255,0.92)' : colors.textSecondary} />
        )}
        {!framed && count != null && count > 0 ? (
          <Txt variant="small" color={onDark ? undefined : 'textSecondary'} style={onDark ? { color: '#FFFFFF' } : undefined}>{formatCount(count)}</Txt>
        ) : null}
      </Pressable>

      {flying ? <Fly key={flying.id} kind={flying.kind} onDone={() => setFlying(null)} /> : null}

      <ReactionRow
        visible={open}
        anchor={anchor}
        current={shown}
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

  /*
   * A press inside the card must not close the card.
   *
   * This listener runs in the capture phase, so it fires before the button
   * under the finger does. It used to recognise only the row of faces, which
   * meant a press on Copy or Delete unmounted the card between pointerdown and
   * click and the button never ran — the reported "it doesn't tap". Everything
   * that belongs to the card is now recognised, by one shared rule.
   */
  useEffect(() => {
    if (!visible || Platform.OS !== 'web') return;
    const onDown = (event: Event) => {
      if (insideReactionUI(event.target as { closest?: unknown } | null)) return;
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
        testID="reaction-card"
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
      if (insideReactionUI(target)) return;
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
