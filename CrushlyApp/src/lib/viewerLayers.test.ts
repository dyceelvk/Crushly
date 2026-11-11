/**
 * The rule that broke the Moments viewer, kept broken-proof.
 *
 * A full-screen gesture surface that sits above the controls does not look like a
 * bug — the screen draws perfectly, the buttons are all there, and every tap lands
 * on the gesture layer instead. It was found by driving the real screen in a
 * browser and asking which element was on top of the reply field:
 *
 *     button[Moments player]
 *
 * These tests are the cheap version of that measurement, plus a source-level guard
 * that the screen keeps using named layers instead of literals nobody can order.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VIEWER_LAYERS, PRESSABLE_LAYERS, isPressableLayer } from './viewerLayers';

test('the gesture surface is the lowest layer on a viewer', () => {
  assert.equal(VIEWER_LAYERS.pager, 0);
  for (const layer of PRESSABLE_LAYERS) {
    assert.ok(
      VIEWER_LAYERS[layer] > VIEWER_LAYERS.pager,
      `${layer} (${VIEWER_LAYERS[layer]}) must sit above the pager (${VIEWER_LAYERS.pager}) or it cannot be pressed`,
    );
  }
});

test('the chrome — header and bottom bar — is above everything it contains', () => {
  assert.ok(VIEWER_LAYERS.chrome > VIEWER_LAYERS.content);
  assert.ok(VIEWER_LAYERS.chrome > VIEWER_LAYERS.card);
});

test('only the pager passes a finger through', () => {
  assert.equal(isPressableLayer('pager'), false);
  for (const layer of PRESSABLE_LAYERS) assert.equal(isPressableLayer(layer), true, layer);
});

/* ------------------------------------------------------- source-level guards */

const viewer = readFileSync(new URL('../screens/moments/MomentViewer.tsx', import.meta.url), 'utf8');

test('the Moments viewer names its layers instead of numbering them', () => {
  const zIndexes = [...viewer.matchAll(/zIndex:\s*([A-Za-z0-9_.]+)/g)].map((m) => m[1]);
  assert.ok(zIndexes.length > 0, 'the viewer sets no zIndex at all — did it stop stacking deliberately?');
  for (const value of zIndexes) {
    assert.ok(
      value.startsWith('VIEWER_LAYERS.'),
      `a raw zIndex (${value}) is back in MomentViewer; layers are ordered in one place (lib/viewerLayers)`,
    );
  }
});

test('the gesture surface carries the pager layer and nothing higher', () => {
  const surface = viewer.match(/position:\s*'absolute',\s*top:\s*0,\s*bottom:\s*0,\s*left:\s*0,\s*right:\s*0,\s*zIndex:\s*([A-Za-z0-9_.]+)/);
  assert.ok(surface, 'the full-screen gesture surface is missing');
  assert.equal(surface[1], 'VIEWER_LAYERS.pager');
});

test('the header and the bottom bar are the chrome layer', () => {
  const chrome = [...viewer.matchAll(/zIndex:\s*VIEWER_LAYERS\.(\w+)/g)].map((m) => m[1]);
  assert.ok(chrome.includes('chrome'), 'nothing is on the chrome layer — the Close and reply controls would be dead');
  assert.equal(chrome.filter((l) => l === 'chrome').length, 2, 'both the header and the bottom bar must be chrome');
});
