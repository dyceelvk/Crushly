import assert from 'node:assert/strict';
import test from 'node:test';
import { clampMemberAge, isMemberAgeEligible, memberAgeLabel, MINIMUM_MEMBER_AGE } from './minimumAge';

test('Holup has one 16+ minimum age, not a separate account type', () => {
  assert.equal(MINIMUM_MEMBER_AGE, 16);
  assert.equal(memberAgeLabel(), '16+');
  assert.equal(isMemberAgeEligible(15), false);
  assert.equal(isMemberAgeEligible(16), true);
  assert.equal(isMemberAgeEligible(null), false);
  assert.equal(clampMemberAge(9), 16);
  assert.equal(clampMemberAge(101), 99);
});
