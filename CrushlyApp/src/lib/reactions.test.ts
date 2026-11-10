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

test('every offered reaction has its own face and its own word', () => {
  // Six emoji, plus crush, which is drawn as holUpp's own mark rather than as
  // somebody else's red heart.
  const emoji = REACTION_ROW.filter((r) => !r.mark).map((r) => r.emoji);
  assert.equal(emoji.length, 6);
  assert.equal(new Set(emoji).size, 6);
  assert.equal(new Set(REACTION_ROW.map((r) => r.word)).size, 7);
});

test('crush is the holUpp mark, not an emoji', () => {
  const crush = reactionLook('crush');
  assert.equal(crush?.mark, true);
  assert.equal(crush?.emoji, undefined);
  assert.equal(crush?.word, 'Crush');
});

test('clap is retired but still drawn for rows that carry it', () => {
  assert.ok(!REACTION_ROW.some((r) => (r.kind as string) === 'clap'));
  assert.equal(reactionLook('clap')?.emoji, '👏');
});

test('no reaction and an unknown reaction draw nothing', () => {
  assert.equal(reactionLook(null), null);
  assert.equal(reactionLook(undefined), null);
});
