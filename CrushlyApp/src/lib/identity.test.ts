import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVELOPING_LABEL,
  IDENTITIES,
  describeChange,
  identityLine,
  publicIdentityLine,
  resolveIdentities,
} from './identity';

describe('the five identities', () => {
  it('are exactly five, with the specified names', () => {
    assert.deepEqual(Object.keys(IDENTITIES).sort(), ['explorer', 'fun', 'introvert', 'pen', 'talkative']);
    assert.equal(IDENTITIES.introvert.title, 'Introvert Crush');
    assert.equal(IDENTITIES.introvert.epithet, 'The Quiet Observer');
    assert.equal(IDENTITIES.pen.title, 'Pen Crusher');
    assert.equal(IDENTITIES.pen.epithet, 'The Wordsmith');
    assert.equal(IDENTITIES.talkative.title, 'Talkative Crush');
    assert.equal(IDENTITIES.talkative.epithet, 'The Conversationalist');
    assert.equal(IDENTITIES.explorer.title, 'Excrusher');
    assert.equal(IDENTITIES.explorer.epithet, 'The Curious Mind');
    assert.equal(IDENTITIES.fun.title, 'Fun Crusher');
    assert.equal(IDENTITIES.fun.epithet, 'The Entertainer');
  });

  it('have their specified emoji', () => {
    assert.equal(IDENTITIES.introvert.emoji, '🌙');
    assert.equal(IDENTITIES.pen.emoji, '✍️');
    assert.equal(IDENTITIES.talkative.emoji, '💬');
    assert.equal(IDENTITIES.explorer.emoji, '🔎');
    assert.equal(IDENTITIES.fun.emoji, '😂');
  });
});

describe('resolveIdentities', () => {
  it('keeps order and dedupes', () => {
    assert.deepEqual(
      resolveIdentities(['introvert', 'talkative', 'introvert']).map((i) => i.key),
      ['introvert', 'talkative'],
    );
  });

  it('drops unknowns instead of printing a sixth identity', () => {
    assert.deepEqual(
      resolveIdentities(['introvert', 'philosopher', 42, null]).map((i) => i.key),
      ['introvert'],
    );
  });

  it('treats nothing as nothing', () => {
    assert.deepEqual(resolveIdentities(null), []);
    assert.deepEqual(resolveIdentities(undefined), []);
    assert.deepEqual(resolveIdentities([]), []);
  });
});

describe('identityLine', () => {
  it('shows the developing sentence, not a placeholder identity', () => {
    const line = identityLine([]);
    assert.equal(line.developing, true);
    assert.equal(line.heading, 'YOUR HOLUPP IDENTITY');
    assert.equal(line.title, DEVELOPING_LABEL);
    assert.equal(line.title, 'Your identity is still developing');
  });

  it('shows a single identity with its epithet', () => {
    const line = identityLine(['pen']);
    assert.equal(line.title, 'Pen Crusher');
    assert.equal(line.epithet, 'The Wordsmith');
    assert.equal(line.developing, false);
  });

  it('shows both co-primaries rather than picking one', () => {
    const line = identityLine(['introvert', 'talkative']);
    assert.equal(line.title, 'Introvert Crush · Talkative Crush');
    assert.equal(line.epithet, 'The Quiet Observer · The Conversationalist');
  });
});

describe('publicIdentityLine', () => {
  it('shows nothing when the member hid it', () => {
    assert.equal(publicIdentityLine(['pen'], false), null);
  });

  it('shows nothing while developing, rather than "unknown"', () => {
    assert.equal(publicIdentityLine([], true), null);
  });

  it('shows the identity when visible', () => {
    assert.equal(publicIdentityLine(['fun'], true)?.title, 'Fun Crusher');
  });
});

describe('describeChange', () => {
  it('reads as a sentence', () => {
    assert.equal(describeChange({ from: 'introvert', to: 'talkative', at: 0 }), 'Introvert Crush → Talkative Crush');
    assert.equal(describeChange({ from: null, to: 'pen', at: 0 }), 'Became Pen Crusher');
  });

  it('does not print an unknown code', () => {
    assert.equal(describeChange({ from: 'pen', to: 'mystery', at: 0 }), 'Identity updated');
  });
});
