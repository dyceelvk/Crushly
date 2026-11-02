import test from 'node:test';
import assert from 'node:assert/strict';
import { palettes } from './tokens';

test('dark appearance uses a true black canvas and neutral dark surfaces', () => {
  assert.equal(palettes.dark.bg, '#000000');
  assert.equal(palettes.dark.bgSecondary, '#121212');
  assert.equal(palettes.dark.card, '#121212');
  assert.equal(palettes.dark.elevated, '#1E1E1E');
  assert.equal(palettes.dark.text, '#FFFFFF');
});

test('light appearance uses a true white canvas and light neutral surfaces', () => {
  assert.equal(palettes.light.bg, '#FFFFFF');
  assert.equal(palettes.light.bgSecondary, '#F8F8F8');
  assert.equal(palettes.light.card, '#FFFFFF');
  assert.equal(palettes.light.elevated, '#F5F5F5');
  assert.equal(palettes.light.text, '#111113');
});

test('appearance keeps Crushly brand accents stable across both schemes', () => {
  assert.equal(palettes.dark.primary, palettes.light.primary);
  assert.equal(palettes.dark.crush, palettes.light.crush);
  assert.equal(palettes.dark.gold, palettes.light.gold);
});
