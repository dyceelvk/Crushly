import test from 'node:test';
import assert from 'node:assert/strict';
import { REACTION_ROW, reactionLook } from './reactions';

test('the row offers seven reactions', () => {
  assert.equal(REACTION_ROW.length, 7);
  assert.deepEqual(
    REACTION_ROW.map((r) => r.kind),
    ['crush', 'laugh', 'wow', 'fire', 'sad', 'angry', 'tired'],
  );
});

test('every offered reaction has its own emoji and word', () => {
  assert.equal(new Set(REACTION_ROW.map((r) => r.emoji)).size, 7);
  assert.equal(new Set(REACTION_ROW.map((r) => r.word)).size, 7);
});

test('clap is retired but still drawn for rows that carry it', () => {
  assert.ok(!REACTION_ROW.some((r) => (r.kind as string) === 'clap'));
  assert.equal(reactionLook('clap')?.emoji, '👏');
});

test('no reaction and an unknown reaction draw nothing', () => {
  assert.equal(reactionLook(null), null);
  assert.equal(reactionLook(undefined), null);
});
