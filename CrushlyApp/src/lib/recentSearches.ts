/**
 * What you looked for, kept until you say otherwise.
 *
 * The feed app everyone knows shows your recent searches the moment the box
 * takes focus, and it is the single cheapest thing on that screen: it means the
 * second search of a session is one tap. The rule that makes it good rather
 * than creepy is that it is local, short, and yours to clear — eight words, on
 * this device, gone when you press the button.
 */

export const RECENT_LIMIT = 8;

/**
 * Add a word to the front of the list.
 *
 * Case is ignored for the comparison but kept for display, because someone who
 * typed a capital meant it. A repeat moves to the front rather than appearing
 * twice.
 */
export function pushRecent(list: string[], word: string, limit: number = RECENT_LIMIT): string[] {
  const clean = word.trim().replace(/\s+/g, ' ');
  if (clean.length < 2) return list;
  const key = clean.toLowerCase();
  const without = list.filter((w) => w.trim().toLowerCase() !== key);
  return [clean, ...without].slice(0, limit);
}

export function removeRecent(list: string[], word: string): string[] {
  const key = word.trim().toLowerCase();
  return list.filter((w) => w.toLowerCase() !== key);
}

/** Read a stored list without trusting it: anything unreadable reads as empty. */
export function parseRecents(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim())
      .filter((v) => v.length >= 2)
      .slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

export function serializeRecents(list: string[]): string {
  return JSON.stringify(list.slice(0, RECENT_LIMIT));
}

export const RECENT_KEY = 'crushly.search.recents.v1';
