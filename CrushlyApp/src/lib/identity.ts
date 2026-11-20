/**
 * HolUpp Identity — the five names, and nothing else.
 *
 * This file is deliberately dumb. It does not score anybody, it does not guess,
 * and it holds no thresholds: the backend decides who is what, and everything
 * here does is print the answer in the app's own type. If this file and the
 * database ever disagree, the database is right.
 *
 * The five are fixed. Not four, not six, not renamed, not localised into
 * something friendlier. `IDENTITIES` is exhaustive over `IdentityKey`, so adding
 * a sixth would fail the type-check where the mapping tables are written —
 * which is the point.
 */

export type IdentityKey = 'introvert' | 'pen' | 'talkative' | 'explorer' | 'fun';

export type Identity = {
  key: IdentityKey;
  /** The title, exactly as specified. Never reworded. */
  title: string;
  /** The line under it. */
  epithet: string;
  emoji: string;
};

export const IDENTITIES: Record<IdentityKey, Identity> = {
  introvert: { key: 'introvert', title: 'Introvert Crush', epithet: 'The Quiet Observer', emoji: '🌙' },
  pen: { key: 'pen', title: 'Pen Crusher', epithet: 'The Wordsmith', emoji: '✍️' },
  talkative: { key: 'talkative', title: 'Talkative Crush', epithet: 'The Conversationalist', emoji: '💬' },
  explorer: { key: 'explorer', title: 'Excrusher', epithet: 'The Curious Mind', emoji: '🔎' },
  fun: { key: 'fun', title: 'Fun Crusher', epithet: 'The Entertainer', emoji: '😂' },
};

/** Shown until there is enough evidence to say anything. */
export const DEVELOPING_LABEL = 'Your identity is still developing';

/**
 * The label, when the backend has not classified the member yet.
 *
 * "Still developing" is not an error state and must never read like one: a new
 * account is supposed to be here, and the brief is explicit that missing
 * activity is not evidence of a type. So there is no placeholder identity, no
 * "Introvert Crush (provisional)" — there is a sentence, and it is true.
 */
export function developingLine(): { heading: string; title: string } {
  return { heading: 'YOUR HOLUPP IDENTITY', title: DEVELOPING_LABEL };
}

const isKey = (value: unknown): value is IdentityKey =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(IDENTITIES, value);

/**
 * Resolve whatever the server sent into the five known identities.
 *
 * Unknown values are dropped rather than printed. A typo or a half-migrated row
 * must not put a sixth identity on somebody's Space.
 */
export function resolveIdentities(keys: readonly unknown[] | null | undefined): Identity[] {
  const seen = new Set<IdentityKey>();
  const out: Identity[] = [];
  for (const key of keys ?? []) {
    if (!isKey(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(IDENTITIES[key]);
  }
  return out;
}

/**
 * The one line the profile shows: title and epithet, with co-primaries joined.
 *
 *   Introvert Crush · Talkative Crush
 *   The Quiet Observer · The Conversationalist
 *
 * Co-primary is a real answer, not a failure to decide — two identities that are
 * genuinely level are both the truth, so both are printed rather than one being
 * picked by a coin-flip the member would experience as randomness.
 */
export function identityLine(keys: readonly unknown[] | null | undefined): {
  heading: string;
  title: string;
  epithet: string;
  emoji: string;
  /** Titles only, for a compact surface. */
  short: string;
  developing: boolean;
} {
  const list = resolveIdentities(keys);
  if (list.length === 0) {
    const d = developingLine();
    return { heading: d.heading, title: d.title, epithet: '', emoji: '', short: '', developing: true };
  }
  return {
    heading: 'YOUR HOLUPP IDENTITY',
    title: list.map((i) => i.title).join(' · '),
    epithet: list.map((i) => i.epithet).join(' · '),
    emoji: list.map((i) => i.emoji).join(''),
    short: list.map((i) => `${i.emoji} ${i.title}`).join(' · '),
    developing: false,
  };
}

/**
 * What a *visitor* may be told.
 *
 * Hiding is a public-only switch: the member still sees their own identity, the
 * engine still classifies them, and a visitor sees nothing — no title, no hint
 * that a title exists. Returning `null` rather than "Hidden" matters: "Hidden"
 * tells a stranger there is something to find.
 */
export function publicIdentityLine(
  keys: readonly unknown[] | null | undefined,
  visible: boolean,
): ReturnType<typeof identityLine> | null {
  if (!visible) return null;
  const line = identityLine(keys);
  if (line.developing) return null; // nothing to show, and nothing to apologise for
  return line;
}

/**
 * History entries, as the member reads them.
 *
 * Private: this never appears on anybody else's screen and there is no public
 * route that could serve it.
 */
export type IdentityChange = {
  from: string | null;
  to: string;
  at: number;
  confidence?: number;
  reason?: string;
};

export function describeChange(change: IdentityChange): string {
  const to = isKey(change.to) ? IDENTITIES[change.to].title : null;
  const from = change.from && isKey(change.from) ? IDENTITIES[change.from].title : null;
  if (!to) return 'Identity updated';
  if (!from) return `Became ${to}`;
  return `${from} → ${to}`;
}
