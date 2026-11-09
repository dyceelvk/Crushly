/**
 * Finding the pressable things in a post.
 *
 * Kept apart from the component that draws them so it can be tested without a
 * renderer — and because the rules about what is *not* a mention (an email
 * address, a colour) are worth writing down once and asserting, rather than
 * trusting a regex to be right by inspection.
 */

const URL_RE = /https?:\/\/[^\s<>"']+/gi;

/**
 * A handle, and a hashtag.
 *
 * Both are only ever a mention or a tag when they start a word: `mail@host` is
 * an address, not a person, and `C#5` is a note. The look-behind keeps the
 * matcher honest without needing to parse the sentence around it.
 *
 * A handle may carry a dot — `@ada.ng` is one member, not `@ada` followed by a
 * full stop — so the middle of the matcher accepts one while the last character
 * may not be one. That single character was the whole bug behind a tag that
 * "did nothing" after posting: the suggestion list offered `ada.ng`, the post
 * stored `@ada.ng`, and this matcher handed the lookup the handle `ada`.
 */
const MENTION_RE = /(?<![\w@/])@([A-Za-z0-9_][A-Za-z0-9_.]{0,28}[A-Za-z0-9_])/g;
const TAG_RE = /(?<![\w#/])#([A-Za-z0-9_]{2,40})\b/g;

/** Only two schemes are ever allowed through: a page that isn't http(s) isn't a page. */
type Token = { kind: 'url' | 'mention' | 'tag'; text: string; value: string };

/**
 * Split text into plain chunks and the three kinds of thing that can be pressed.
 *
 * They are collected in one pass rather than three, because a body can hold all
 * three at once — "shot by @ada at the pier #lagos https://…" — and three
 * sequential splits would nest one matcher's output inside another's.
 */
export function tokenize(text: string): { parts: string[]; matches: Token[] } {
  const found: (Token & { start: number; end: number })[] = [];
  const take = (re: RegExp, kind: Token['kind'], valueGroup: number) => {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const start = m.index;
      let matched = m[0];
      if (kind === 'url') {
        // Sentence punctuation belongs to the surrounding text, not the URL.
        matched = matched.replace(/[.,!?;:]+$/, '');
        while (matched.endsWith(')') && (matched.match(/\)/g)?.length ?? 0) > (matched.match(/\(/g)?.length ?? 0)) matched = matched.slice(0, -1);
      }
      const end = start + matched.length;
      // Whatever came first owns the characters; later matchers skip overlaps.
      if (!matched || found.some((f) => start < f.end && end > f.start)) continue;
      found.push({ kind, text: matched, value: kind === 'url' ? matched : (m[valueGroup] ?? matched), start, end });
    }
  };
  take(URL_RE, 'url', 0);
  take(MENTION_RE, 'mention', 1);
  take(TAG_RE, 'tag', 1);
  found.sort((a, b) => a.start - b.start);

  const parts: string[] = [];
  const matches: Token[] = [];
  let at = 0;
  for (const f of found) {
    parts.push(text.slice(at, f.start));
    matches.push({ kind: f.kind, text: f.text, value: f.value });
    at = f.end;
  }
  parts.push(text.slice(at));
  return { parts, matches };
}
