import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profileCompletion } from './completion';

const full = {
  name: 'Ada',
  birthdate: '1998-04-11',
  bio: 'Designer. Long walks, longer playlists.',
  pronouns: 'she/her',
  city: 'Port Harcourt',
  intentions: ['dating', 'friends'],
  interests: ['Music', 'Design', 'Coffee'],
  languages: ['English'],
  relationshipIntention: 'Long-term partner',
  lifestyle: { workout: 'Often', drinking: 'Rarely' },
};

test('a filled Space is 100%', () => {
  const c = profileCompletion(full, 3);
  assert.equal(c.percent, 100);
  assert.deepEqual(c.missing, []);
});

test('two photos is the only thing missing', () => {
  const c = profileCompletion(full, 2);
  assert.equal(c.percent, 90);
  assert.deepEqual(c.missing, ['Add at least 3 photos']);
});

test('the number the screen used to sit on: 85, two photos and no lifestyle', () => {
  const c = profileCompletion({ ...full, lifestyle: {} }, 2);
  assert.equal(c.percent, 85);
  assert.deepEqual(c.missing, ['Add at least 3 photos', 'Lifestyle details']);
});

test('the weights still add up to a hundred', () => {
  // Every check done scores exactly 100, nothing more.
  assert.equal(profileCompletion(full, 6).percent, 100);
  // Nothing done scores zero, including a Space with no photos and no name.
  assert.equal(profileCompletion({}, 0).percent, 0);
});

test('the missing list is in the order the points are earned', () => {
  const c = profileCompletion({ ...full, bio: '' }, 3);
  assert.deepEqual(c.missing, ['Write a bio']);
});

test('an empty lifestyle value is not a lifestyle detail', () => {
  // The form keeps keys around as empty strings when a member clears one;
  // counting those would score a Space that says nothing.
  assert.equal(profileCompletion({ ...full, lifestyle: { workout: '', drinking: '' } }, 3).percent, 95);
  assert.equal(profileCompletion({ ...full, lifestyle: { workout: 'Often' } }, 3).percent, 95);
});

test('a short bio does not count as a bio', () => {
  assert.equal(profileCompletion({ ...full, bio: 'Hi' }, 3).percent, 85);
});

test('junk in place of a list does not throw', () => {
  const junk = { ...full, interests: null, languages: undefined, lifestyle: null } as any;
  const c = profileCompletion(junk, 3);
  assert.equal(c.percent, 80);
  assert.ok(c.missing.includes('Pick 3 interests'));
});
