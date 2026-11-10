import assert from 'node:assert/strict';
import test from 'node:test';
import { clampMemberAge, isMemberAgeEligible, memberAgeLabel, MINIMUM_MEMBER_AGE } from './minimumAge';

test('Holup has an 18+ minimum age until protected teen mode is ready', () => {
  assert.equal(MINIMUM_MEMBER_AGE, 18);
  assert.equal(memberAgeLabel(), '18+');
  assert.equal(isMemberAgeEligible(17), false);
  assert.equal(isMemberAgeEligible(18), true);
  assert.equal(isMemberAgeEligible(null), false);
  assert.equal(clampMemberAge(9), 18);
  assert.equal(clampMemberAge(101), 99);
});
