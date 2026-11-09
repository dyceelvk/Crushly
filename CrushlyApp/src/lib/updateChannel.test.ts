import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { updateVersionPath } from './updateChannel';
test('secure or unidentified Android builds never query the legacy debug-signed channel', () => {
  assert.equal(updateVersionPath('android', 'secure', 'app.holup.mobile'), '/secure/version');
  assert.equal(updateVersionPath('android', undefined, 'app.holup.mobile'), '/secure/version');
  assert.equal(updateVersionPath('android', undefined, undefined), '/secure/version');
  assert.equal(updateVersionPath('android', undefined, 'app.crushly'), '/version');
  assert.equal(updateVersionPath('android', 'secure', 'app.crushly'), '/secure/version');
  assert.equal(updateVersionPath('web', 'secure', 'app.holup.mobile'), '/version');
});
