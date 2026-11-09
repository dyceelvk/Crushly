import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RELATIONSHIP_CONTRACT_HEADER,
  RELATIONSHIP_CONTRACT_VERSION,
  relationshipContractHeaders,
} from './relationshipContract';

test('relationship cutover marker is explicit and public', () => {
  assert.equal(RELATIONSHIP_CONTRACT_HEADER, 'x-holup-contract');
  assert.equal(RELATIONSHIP_CONTRACT_VERSION, 'relationship-v2');
  assert.deepEqual(relationshipContractHeaders(), {
    'x-holup-contract': 'relationship-v2',
  });
});
