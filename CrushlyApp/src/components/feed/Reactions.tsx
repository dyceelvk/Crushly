import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Platform, Pressable, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Txt } from '../Txt';
import { useTheme } from '../../theme/ThemeProvider';
import { haptic } from '../../lib/haptics';
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
 * One reaction control.
 *
 * `myReaction` is what this member has given, if anything. Tapping reacts with
 * the same kind again to take it back — the server treats a repeat as an undo,
 * so the control has no separate "remove".
 */
export function ReactionButton({
  myReaction,
  count,
  onReact,
  size = 24,
  disabled = false,
}: {
  myReaction?: ReactionKind | null;
  count?: number;
  onReact: (kind: ShownReaction) => void;
  size?: number;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [flying, setFlying] = useState<{ kind: ShownReaction; id: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const control = useRef<View>(null);
  const look = reactionLook(myReaction);

  /**
   * Where the control actually is.
   *
   * The row used to be positioned relative to the control and simply drawn to
   * the left of it, which on a control near the edge of the phone put most of
   * the row off-screen. It is a modal now, placed from the control's real
   * window coordinates, so it opens where the thumb is and stays inside the
   * screen wherever that is.
   */
  const place = useCallback(() => {
    const node = control.current as unknown as { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void };
    if (!node?.measureInWindow) return setAnchor(null);
    node.measureInWindow((x, y, w, h) => setAnchor({ x, y, w, h }));
  }, []);

  const close = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setOpen(false);
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const start = () => {
    held.current = false;
    if (disabled) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      held.current = true;
      haptic.tap();
      place();
      setOpen(true);
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
    haptic.tap();
    setFlying({ kind, id: Date.now() });
    onReact(kind);
  };

  return (
    <View ref={control} style={{ alignItems: 'center' }} collapsable={false}>
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
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
      >
        {look ? (
          <Txt style={{ fontSize: size }}>{look.emoji}</Txt>
        ) : (
          <Ionicons name="heart-outline" size={size} color={colors.textSecondary} />
        )}
        {count != null && count > 0 ? (
          <Txt variant="small" color="textSecondary">{formatCount(count)}</Txt>
        ) : null}
      </Pressable>

      {flying ? <Fly key={flying.id} emoji={reactionLook(flying.kind)?.emoji ?? '❤️'} onDone={() => setFlying(null)} /> : null}

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
 * The row itself.
 *
 * A scrim behind it so a tap anywhere else closes it, and the row above the
 * control, where a thumb is not covering it. Each emoji springs in a beat after
 * the one before — that stagger is most of what makes it feel like the big apps
 * rather than like a menu appearing.
 */
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
  const { colors } = useTheme();
  const { width } = useWindowDimensions();

  // Wide enough for seven emoji at 30 px plus their padding.
  const ROW_W = 7 * 40 + 16;
  const left = anchor
    ? Math.min(Math.max(anchor.x + anchor.w / 2 - ROW_W / 2, 8), Math.max(width - ROW_W - 8, 8))
    : Math.max((width - ROW_W) / 2, 8);
  // Above the control, unless there is no room there — then below it.
  const above = anchor ? anchor.y - 58 : 0;
  const top = anchor ? (above > 40 ? above : anchor.y + anchor.h + 10) : 0;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onDismiss}>
      {/* A real scrim: a tap anywhere closes the row, which is what a row of
          reactions that appeared out of nowhere owes the person who opened it. */}
      <Pressable
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel="Close reactions"
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.18)' }}
      >
        <View style={{ position: 'absolute', left, top }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 8,
              paddingVertical: 7,
              borderRadius: 26,
              backgroundColor: colors.elevated,
              borderWidth: 1,
              borderColor: colors.borderStrong,
              ...(Platform.OS === 'web' ? { boxShadow: '0 14px 30px rgba(0,0,0,0.5)' } : { elevation: 12 }),
            }}
          >
            {REACTION_ROW.map((r, i) => (
              <Pop
                key={r.kind}
                delay={i * 26}
                active={current === r.kind}
                onPress={() => onPick(r.kind)}
                emoji={r.emoji}
                word={r.word}
              />
            ))}
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

/** One emoji: springs up from nothing, a beat after the one before it. */
function Pop({
  emoji,
  word,
  delay,
  active,
  onPress,
}: {
  emoji: string;
  word: string;
  delay: number;
  active: boolean;
  onPress: () => void;
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
          paddingHorizontal: 5,
          paddingVertical: 2,
          borderRadius: 18,
          transform: [{ scale: pressed ? 1.25 : active ? 1.12 : 1 }],
        })}
      >
        <Txt style={{ fontSize: 26 }}>{emoji}</Txt>
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
function Fly({ emoji, onDone }: { emoji: string; onDone: () => void }) {
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
      <Txt style={{ fontSize: 24 }}>{emoji}</Txt>
    </Animated.View>
  );
}
