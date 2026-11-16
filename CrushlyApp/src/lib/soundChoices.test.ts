import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { DEFAULT_SOUND, isSoundChoice, SOUND_CHOICES, soundById, soundName } from './soundChoices';

const here = dirname(fileURLToPath(import.meta.url));
const soundsDir = join(here, '..', '..', 'assets', 'sounds');

test('every choice has a file that actually ships', () => {
  // A picker entry with no asset is a row that plays nothing — the exact bug this
  // whole feature exists to fix, wearing a different hat.
  for (const choice of SOUND_CHOICES) {
    const file = join(soundsDir, `${choice.id}.wav`);
    assert.ok(existsSync(file), `missing ${choice.id}.wav`);
    assert.ok(readFileSync(file).length > 10_000, `${choice.id}.wav is suspiciously small`);
  }
});

test('six choices, each with a name and a line that says something', () => {
  assert.equal(SOUND_CHOICES.length, 6);
  for (const c of SOUND_CHOICES) {
    assert.ok(c.name.length > 2);
    assert.ok(c.blurb.length > 10);
  }
});

test('ids are unique, so the picker cannot select the wrong one', () => {
  const ids = SOUND_CHOICES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('the default exists and no member can end up with no sound at all', () => {
  assert.ok(isSoundChoice(DEFAULT_SOUND));
  assert.equal(soundById('nonsense').id, DEFAULT_SOUND);
  assert.equal(soundById(null).id, DEFAULT_SOUND);
  assert.equal(soundName('orbit'), 'Orbit');
});

test('the stored setting only accepts ids we still ship', () => {
  assert.equal(isSoundChoice('glass'), true);
  assert.equal(isSoundChoice('message'), false); // the old two-tone is retired
  assert.equal(isSoundChoice(''), false);
  assert.equal(isSoundChoice(null), false);
});
