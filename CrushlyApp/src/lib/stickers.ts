/**
 * The sticker shelf — animated GIF stickers, ours and only ours.
 *
 * These are the platform's stickers: twelve looping GIFs drawn and shipped
 * with the app. There is no upload path, no custom pack, no way for a member
 * to put their own image in a comment — a sticker is one of these codes, and
 * a sticker comment carries `gif:<code>` through the same text pipeline
 * everything else uses.
 */

export type Sticker = { code: string; name: string; source: number };

export const STICKERS: Sticker[] = [
  { code: 'fire', name: 'Fire', source: require('../assets/stickers/fire.gif') },
  { code: 'heart', name: 'Heart', source: require('../assets/stickers/heart.gif') },
  { code: 'joy', name: 'Joy', source: require('../assets/stickers/joy.gif') },
  { code: 'sob', name: 'Sob', source: require('../assets/stickers/sob.gif') },
  { code: 'sparkles', name: 'Sparkles', source: require('../assets/stickers/sparkles.gif') },
  { code: 'adore', name: 'Adore', source: require('../assets/stickers/adore.gif') },
  { code: 'skull', name: 'Skull', source: require('../assets/stickers/skull.gif') },
  { code: 'party', name: 'Party', source: require('../assets/stickers/party.gif') },
  { code: 'eyes', name: 'Eyes', source: require('../assets/stickers/eyes.gif') },
  { code: 'hundred', name: 'Hundred', source: require('../assets/stickers/hundred.gif') },
  { code: 'melt', name: 'Melts', source: require('../assets/stickers/melt.gif') },
  { code: 'sprout', name: 'Sprout', source: require('../assets/stickers/sprout.gif') },
];

const PREFIX = 'gif:';
const LEGACY = 'sticker:';
const BY_CODE = new Map(STICKERS.map((s) => [s.code, s]));

/** The body a sticker comment carries. */
export function stickerBody(code: string): string {
  return `${PREFIX}${code}`;
}

/**
 * The image for a sticker body — but only for codes on our shelf. Anything
 * else wearing the prefix is plain text; a member cannot invent a sticker by
 * typing one.
 */
export function stickerSource(body: string | null | undefined): number | null {
  if (!body) return null;
  const raw = body.startsWith(PREFIX) ? body.slice(PREFIX.length) : body.startsWith(LEGACY) ? body.slice(LEGACY.length) : null;
  if (raw === null) return null;
  return BY_CODE.get(raw)?.source ?? null;
}
