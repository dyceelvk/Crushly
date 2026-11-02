import { useState } from 'react';
import { activeToken, applyToken } from '../lib/mentions';

/**
 * The caret-and-suggestion half of an input with `@` and `#`.
 *
 * Every place that takes words from a member — a Flow, a comment, the search
 * box — should answer the same two gestures the same way: `@` offers people,
 * `#` offers tags, and picking one finishes the word and puts the caret after
 * it. This is that behaviour in one place, so the three inputs cannot drift.
 */
export function useMentionInput(value: string, onChange: (next: string) => void) {
  const [caret, setCaret] = useState<number | null>(null);
  const token = activeToken(value, caret);

  return {
    token,
    /** Feed this to the TextInput's onSelectionChange. */
    onSelectionChange: (e: { nativeEvent: { selection: { end: number } } }) => setCaret(e.nativeEvent.selection.end),
    /** …and this to its onChangeText. */
    onChangeText: (next: string) => {
      onChange(next);
      setCaret(next.length);
    },
    /** Choosing somebody or something from the list. */
    pick: (choice: string) => {
      if (!token) return;
      const next = applyToken(value, token, choice);
      onChange(next.text);
      setCaret(next.caret);
    },
  };
}
