import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { androidUpdateStatus } from './updateDisplay';
test('Android update status never labels unknown or failed checks as current', () => {
  assert.equal(androidUpdateStatus({ loading: true, error: false, hasData: false, available: false }), 'checking');
  assert.equal(androidUpdateStatus({ loading: false, error: true, hasData: false, available: false }), 'error');
  assert.equal(androidUpdateStatus({ loading: false, error: true, hasData: true, available: false }), 'error');
  assert.equal(androidUpdateStatus({ loading: false, error: false, hasData: false, available: false }), 'error');
  assert.equal(androidUpdateStatus({ loading: false, error: false, hasData: true, available: true }), 'available');
  assert.equal(androidUpdateStatus({ loading: false, error: false, hasData: true, available: false }), 'current');
});
