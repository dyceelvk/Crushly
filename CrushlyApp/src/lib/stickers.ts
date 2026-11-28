/**
 * The sticker shelf.
 *
 * Stickers on holUpp are ours, not the members': there is no upload path, no
 * custom pack, no way to smuggle an image into a comment — a sticker is one of
 * these codes, and a comment carrying one is written as `sticker:<code>` so it
 * travels through the same text pipeline everything else uses.
 */

export type Sticker = { code: string; glyph: string; name: string };

export const STICKERS: Sticker[] = [
  { code: 'fire', glyph: '🔥', name: 'Fire' },
  { code: 'joy', glyph: '😂', name: 'Joy' },
  { code: 'heart', glyph: '❤️', name: 'Heart' },
  { code: 'sob', glyph: '😭', name: 'Sob' },
  { code: 'sparkles', glyph: '✨', name: 'Sparkles' },
  { code: 'adore', glyph: '😍', name: 'Adore' },
  { code: 'skull', glyph: '💀', name: 'Skull' },
  { code: 'party', glyph: '🎉', name: 'Party' },
  { code: 'eyes', glyph: '👀', name: 'Eyes' },
  { code: 'plead', glyph: '🥹', name: 'Plead' },
  { code: 'hundred', glyph: '💯', name: 'Hundred' },
  { code: 'chef', glyph: '🤌', name: 'Chef’s kiss' },
  { code: 'melts', glyph: '🫠', name: 'Melts' },
  { code: 'wave', glyph: '👋', name: 'Wave' },
  { code: 'pray', glyph: '🙏', name: 'Pray' },
  { code: 'sprout', glyph: '🌱', name: 'Sprout' },
];

const PREFIX = 'sticker:';
const BY_CODE = new Map(STICKERS.map((s) => [s.code, s]));

/** The body a sticker comment carries. */
export function stickerBody(code: string): string {
  return `${PREFIX}${code}`;
}

/**
 * The glyph for a sticker body — but only for codes on our shelf. Anything
 * else that wears the prefix is just text; a member cannot invent a sticker
 * by typing one.
 */
export function stickerGlyph(body: string | null | undefined): string | null {
  if (!body || !body.startsWith(PREFIX)) return null;
  return BY_CODE.get(body.slice(PREFIX.length))?.glyph ?? null;
}
