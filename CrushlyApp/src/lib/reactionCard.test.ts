import assert from 'node:assert/strict';
import test from 'node:test';
import { insideReactionUI, REACTION_UI_SELECTOR } from './reactionCard';

const node = (hit: string | null) => ({ closest: (sel: string) => (hit && sel.includes(hit) ? {} : null) });

test('a press on the faces, the actions, or the control itself belongs to the card', () => {
  assert.equal(insideReactionUI(node('reaction-row')), true);
  assert.equal(insideReactionUI(node('reaction-card')), true);
  assert.equal(insideReactionUI(node('reaction-control')), true);
});

test('a press anywhere else closes it', () => {
  assert.equal(insideReactionUI(node(null)), false);
  assert.equal(insideReactionUI(null), false);
  assert.equal(insideReactionUI({}), false);
});

test('the selector names every part of the card', () => {
  for (const id of ['reaction-row', 'reaction-card', 'reaction-control']) {
    assert.ok(REACTION_UI_SELECTOR.includes(id), id);
  }
});
