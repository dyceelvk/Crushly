/**
 * What the caret is inside of.
 *
 * Typing `@` in a post is not punctuation — it is the beginning of a person, and
 * the app should start offering the people it knows. The same is true of `#` and
 * the Flows that already carry that tag. Both are the same question asked twice:
 * *what word is being built right now, and of which kind?*
 *
 * This is the part that decides, and it is pure: give it the text and where the
 * caret is, and it says whether a mention or a tag is being typed, what has been
 * typed of it so far, and where it starts. Everything else — the list, the
 * request, the insertion — reads that answer.
 */

export type ActiveToken =
  | { kind: 'mention'; query: string; start: number; end: number }
  | { kind: 'tag'; query: string; start: number; end: number }
  | null;

/** A handle is letters, digits, dot and underscore — what a username can be. */
const HANDLE_CHAR = /^[a-z0-9._]$/i;
/** A tag is looser, because a hashtag is a word rather than an identifier. */
const TAG_CHAR = /^[a-z0-9_]$/i;
/** What may sit immediately before a sigil for it to count as one. */
const BEFORE_SIGIL = /[\s(\[{,'"“]/;

/**
 * The token around the caret.
 *
 * Walks back from the caret to the nearest `@` or `#`, and gives up if it meets
 * a space or another `@`/`#` on the way — because "hello @ada and @ng" is two
 * mentions, not one long one. A token only counts while the caret is still
 * inside it: moving the caret past the end of a handle means you are no longer
 * choosing that person.
 */
export function activeToken(text: string, caret?: number | null): ActiveToken {
  const body = typeof text === 'string' ? text : '';
  const at = Math.max(0, Math.min(caret ?? body.length, body.length));
  if (!body) return null;

  // A fresh `@` on its own is the most common case: no query yet, but the list
  // should already be open.
  let i = at - 1;
  let query = '';
  while (i >= 0) {
    const ch = body[i];
    if (ch === '@' || ch === '#') {
      const isMention = ch === '@';
      const allowed = isMention ? HANDLE_CHAR : TAG_CHAR;
      // Everything between the sigil and the caret has to be part of the token.
      if ([...query].some((c) => !allowed.test(c))) return null;
      // A sigil glued to a word — an email address, a URL fragment — is not a
      // mention. A tag inside a word is fair game ("#film" after "on").
      const before = i > 0 ? body[i - 1] : null;
      if (isMention && before !== null && !BEFORE_SIGIL.test(before)) return null;
      if (!isMention && before !== null && !BEFORE_SIGIL.test(before) && !/[a-zA-Z0-9]/.test(before)) return null;
      return { kind: isMention ? 'mention' : 'tag', query, start: i, end: at };
    }
    if (ch === ' ' || ch === '\n' || ch === '\t') return null;
    // Any other punctuation ends the token too: "@ada, hello" is not "@ada,".
    if (!HANDLE_CHAR.test(ch)) return null;
    query = ch + query;
    i -= 1;
  }
  return null;
}

/**
 * Swapping the typed fragment for the finished one.
 *
 * Returns the new text and where the caret should sit — after the inserted
 * handle, with a space, so the next word starts cleanly.
 */
export function applyToken(
  text: string,
  token: NonNullable<ActiveToken>,
  choice: string,
): { text: string; caret: number } {
  const before = text.slice(0, token.start);
  const after = text.slice(token.end);
  const insert = `${token.kind === 'mention' ? '@' : '#'}${choice.replace(/^[@#]/, '')}`;
  // Do not double the space if one is already there.
  const tail = after.startsWith(' ') || after.startsWith('\n') ? after : ` ${after}`;
  return { text: `${before}${insert}${tail}`, caret: before.length + insert.length + 1 };
}

/** Cheap and stable: the string the suggestion query is keyed on. */
export function tokenKey(token: ActiveToken): string {
  return token ? `${token.kind}:${token.query.toLowerCase()}` : '';
}
