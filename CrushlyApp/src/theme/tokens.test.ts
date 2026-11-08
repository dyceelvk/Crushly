import test from 'node:test';
import assert from 'node:assert/strict';
import { palettes } from './tokens';

test('dark appearance uses official Hollop plum surfaces', () => {
  assert.equal(palettes.dark.bg, '#2A0F2B');
  assert.equal(palettes.dark.bgSecondary, '#35143A');
  assert.equal(palettes.dark.card, '#35143A');
  assert.equal(palettes.dark.elevated, '#461A48');
  assert.equal(palettes.dark.text, '#FFF8F8');
});

test('light appearance uses the warm Hollop reading surfaces', () => {
  assert.equal(palettes.light.bg, '#FFF8F8');
  assert.equal(palettes.light.bgSecondary, '#FCEFF1');
  assert.equal(palettes.light.card, '#FFF8F8');
  assert.equal(palettes.light.elevated, '#F8E5EA');
  assert.equal(palettes.light.text, '#2A0F2B');
});

test('appearance keeps Hollop brand accents stable across both schemes', () => {
  assert.equal(palettes.dark.primary, '#FF8788');
  assert.equal(palettes.dark.crush, '#ED59AF');
  assert.equal(palettes.dark.primary, palettes.light.primary);
  assert.equal(palettes.dark.crush, palettes.light.crush);
  assert.equal(palettes.dark.gold, palettes.light.gold);
});
