import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The Flow may have exactly one web pager.
 *
 * Twice now two pager effects have been mounted at once — one setting the
 * browser's mandatory snap, one turning it off and driving the movement itself —
 * and the visible result was the bug the owner kept reporting: a free-scrolling
 * document that would not stick to a clip. Typecheck cannot see it (both effects
 * are valid TypeScript), the app does not crash, and a screen recording only
 * shows the symptom. So the source is checked.
 */
const source = readFileSync(
  fileURLToPath(new URL('../screens/flow/PostViewer.tsx', import.meta.url)),
  'utf8',
);

test('the Flow mounts one web pager, not two', () => {
  const wheelListeners = source.match(/addEventListener\('wheel'/g) ?? [];
  assert.equal(wheelListeners.length, 1, `found ${wheelListeners.length} wheel listeners; one gesture must have one owner`);
});

test('the pager never asks the browser to do the snapping', () => {
  // A programmatic smooth scroll is dropped by Chromium while mandatory snap is
  // on, so the movement has to be ours and the browser's snap has to stay off.
  const setToMandatory = source.match(/scrollSnapType = '(x|y) mandatory'/g) ?? [];
  assert.equal(setToMandatory.length, 0, 'mandatory snap cancels our animation');
  assert.match(source, /scrollSnapType = 'none'/);
});

test('the list is given its own height, or nothing scrolls it but the page', () => {
  // Measured before this: no inner scroller at all, document.scrollHeight 4220.
  assert.match(source, /style=\{\{ height \}\}/);
});
