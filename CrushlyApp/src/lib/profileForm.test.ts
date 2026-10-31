import { test } from 'node:test';
import assert from 'node:assert/strict';
import { birthdayLabel, capMessage, formAfterSave, formFromMe, formKey, isDirty } from './profileForm';
import { PRONOUNS } from './catalog';
import type { Me } from '../api/types';

const me = (over: Partial<Me['profile']> = {}, lifestyle: Record<string, unknown> = {}): Me =>
  ({
    id: 1,
    email: 'a@b.c',
    status: 'active',
    createdAt: 0,
    onboarded: true,
    profile: {
      name: 'Ada',
      username: 'ada',
      birthdate: '1998-04-11',
      age: 28,
      pronouns: 'she/her',
      bio: 'Designer.',
      city: 'Port Harcourt',
      hasLocation: true,
      intentions: ['dating'],
      interests: ['Music'],
      languages: ['English'],
      relationshipIntention: 'Long-term partner',
      lifestyle,
      photos: [],
      ...over,
    },
    verification: { status: 'none', pose: null },
    completion: { percent: 80, missing: [] },
    preferences: { ageMin: 24, ageMax: 38, maxDistance: 50, intentions: [], interests: [], verifiedOnly: false },
    privacy: {
      showDistance: true, showOnline: true, readReceipts: true, discoverable: true,
      profileVisibility: 'everyone', whoCanMessage: 'crushes', whoCanCrush: 'everyone',
      showAge: true, showCity: true, incognito: false,
    },
    notifications: { messages: true, crushes: true, moments: true, recommendations: false },
    plus: { active: false, interested: false, deepCrushesLeft: 3, deepCrushesPerDay: 3 },
  }) as Me;

test('she/her is a pronoun the chips can express', () => {
  // The regression: 'she/her' was absent from PRONOUNS, so the screen treated a
  // saved she/her as free text and showed no chip selected.
  assert.ok(PRONOUNS.includes('she/her'));
  assert.ok(PRONOUNS.includes('he/him'));
  assert.ok(PRONOUNS.includes('they/them'));
});

test('a pronoun outside the list survives the round trip as free text', () => {
  const f = formFromMe(me({ pronouns: 'ze/hir' }));
  assert.equal(f.pronouns, 'ze/hir');
  assert.equal(PRONOUNS.includes(f.pronouns), false);
});

test('height is held as text in the form and as a number on the server', () => {
  assert.equal(formFromMe(me({}, { height: 180 })).heightText, '180');
  assert.equal(formFromMe(me({}, {})).heightText, '');
  assert.equal(formFromMe(me({}, { height: 0 })).heightText, '');
});

test('a freshly loaded form is not dirty', () => {
  const f = formFromMe(me());
  assert.equal(isDirty(f, formKey(f)), false);
});

test('a change makes it dirty, and undoing the change makes it clean again', () => {
  const base = formFromMe(me({}, { workout: 'Often' }));
  const dirty = { ...base, name: 'Ada N' };
  assert.equal(isDirty(dirty, formKey(base)), true);
  assert.equal(isDirty(base, formKey(base)), false);

  // Picking a lifestyle chip and unpicking it must not leave a change behind:
  // the value is set to undefined, which JSON drops.
  const picked = { ...base, lifestyle: { ...base.lifestyle, drinking: 'Never' as string | undefined } };
  assert.equal(isDirty(picked, formKey(base)), true);
  const unpicked = { ...base, lifestyle: { ...base.lifestyle, drinking: undefined } };
  assert.equal(isDirty(unpicked, formKey(base)), false);
});

test('saving a new handle leaves the screen clean, not dirty', () => {
  // The bug: the profile write came back first, the handle write landed after,
  // and the form was re-seeded from the profile write — so it held the old
  // handle while the screen held the new one. "Save changes" stayed in the
  // footer of a screen with nothing left to save.
  const before = formFromMe(me({ username: 'ada' }));
  const after = formAfterSave(me({ username: 'ada' }), 'ada_n');
  assert.equal(after.username, 'ada_n');

  // What the screen is compared against after saving: the server's copy plus the
  // handle the database confirmed. Same form, so, clean.
  assert.equal(isDirty(after, formKey(after)), false);

  // And the stale version — the one that used to be re-seeded — reads as dirty,
  // which is exactly the symptom.
  assert.equal(isDirty(formFromMe(me({ username: 'ada' })), formKey(after)), true);
});

test('a birthday names its month instead of relying on the reader’s locale', () => {
  assert.equal(birthdayLabel('1998-04-11'), '11 April 1998');
  assert.equal(birthdayLabel('2001-12-01'), '1 December 2001');
  assert.equal(birthdayLabel(''), 'not set');
  assert.equal(birthdayLabel(null), 'not set');
  assert.equal(birthdayLabel('11/04/1998'), 'not set');
  assert.equal(birthdayLabel('1998-13-40'), 'not set');
});

test('hitting a cap says so rather than swallowing the tap', () => {
  const msg = capMessage('interests', 10);
  assert.match(msg.title, /10/);
  assert.match(msg.message, /swap/i);
});
