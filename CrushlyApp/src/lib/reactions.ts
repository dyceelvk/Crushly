/**
 * The seven reactions, as data.
 *
 * Kept apart from the component that draws them so the rules can be tested
 * without a renderer: what the row offers, in what order, and how an old row
 * written before this set existed should still be drawn.
 *
 * A tap on a heart is one bit, so five kinds behind one tap is five kinds nobody
 * could reach. Press and hold opens the row; these are the seven it opens.
 *
 * `clap` is deliberately absent from the offers and present in the legacy map.
 * Rows written before today carry it, and a kind nobody can choose but everybody
 * can still see is the honest way to retire it.
 */
import type { ReactionKind } from '../api/types';

/** Everything except `clap`, which can no longer be given. */
export type ShownReaction = Exclude<ReactionKind, 'clap'>;

/**
 * A reaction as it is drawn.
 *
 * `mark` means: this one is not an emoji, it is holUpp's own two-circle mark.
 * Crush is the app's own word and its own symbol — a red heart is somebody
 * else's vocabulary, and the owner asked for the two circles instead. Everything
 * else stays an emoji, because those are universal and the mark is not.
 */
export type ReactionSpec = { kind: ShownReaction; emoji?: string; mark?: true; word: string; tint: string };

/** The row, in the order a hand reads it: warm, loud, surprised, then the rest. */
export const REACTION_ROW: ReactionSpec[] = [
  { kind: 'crush', mark: true, word: 'Crush', tint: '#FF4081' },
  { kind: 'laugh', emoji: '😂', word: 'Laugh', tint: '#FFC940' },
  { kind: 'wow', emoji: '😲', word: 'Wow', tint: '#A040FF' },
  { kind: 'fire', emoji: '🔥', word: 'Fire', tint: '#FF8A3D' },
  { kind: 'sad', emoji: '😢', word: 'Sad', tint: '#4FA8FF' },
  { kind: 'angry', emoji: '😡', word: 'Angry', tint: '#FF5C67' },
  { kind: 'tired', emoji: '😓', word: 'Tired', tint: '#8FA0B8' },
];

const BY_KIND = new Map(REACTION_ROW.map((r) => [r.kind, r]));

/** What a row that predates this set should draw. */
const LEGACY: Record<string, { emoji: string; word: string; tint: string }> = {
  clap: { emoji: '👏', word: 'Clap', tint: '#00C6FF' },
};

/** The emoji, word and colour for a reaction — or null when there is none. */
export type ReactionLook = { emoji?: string; mark?: true; word: string; tint: string };

export function reactionLook(kind?: ReactionKind | null): ReactionLook | null {
  if (!kind) return null;
  return BY_KIND.get(kind as ShownReaction) ?? LEGACY[kind] ?? null;
}
