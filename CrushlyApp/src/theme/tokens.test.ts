import test from 'node:test';
import assert from 'node:assert/strict';
import { palettes } from './tokens';

test('dark appearance is black first, with the brand only as a trace', () => {
  assert.equal(palettes.dark.bg, '#0B070C');
  assert.equal(palettes.dark.bgSecondary, '#120D13');
  assert.equal(palettes.dark.card, '#141016');
  assert.equal(palettes.dark.elevated, '#1C1720');
  assert.equal(palettes.dark.text, '#FFF8F8');
});

test('dark surfaces are near-black, not a dye', () => {
  // Every rung of the dark ladder sits at or below 20% luminance; the page
  // behind a photograph must not tint it.
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  };
  for (const key of ['bg', 'bgSecondary', 'card', 'elevated'] as const) {
    assert.ok(lum(palettes.dark[key]) < 0.12, `${key} is too light: ${palettes.dark[key]}`);
  }
});

test('light appearance uses the warm holUpp reading surfaces', () => {
  assert.equal(palettes.light.bg, '#FFF8F8');
  assert.equal(palettes.light.bgSecondary, '#FCEFF1');
  assert.equal(palettes.light.card, '#FFF8F8');
  assert.equal(palettes.light.elevated, '#F8E5EA');
  assert.equal(palettes.light.text, '#2A0F2B');
});

test('appearance keeps holUpp brand accents stable across both schemes', () => {
  assert.equal(palettes.dark.primary, '#FF8788');
  assert.equal(palettes.dark.crush, '#ED59AF');
  assert.equal(palettes.dark.primary, palettes.light.primary);
  assert.equal(palettes.dark.crush, palettes.light.crush);
  assert.equal(palettes.dark.gold, palettes.light.gold);
});
