import assert from 'node:assert/strict';
import test from 'node:test';
import { LEAVE_ALONE_BYTES, PICK_LIMIT_BYTES, UPLOAD_TARGET_BYTES, mustStopAfterFailedCompression, planUpload } from './uploadPlan';

const MB = 1024 * 1024;

test('a clip past the pick limit is refused before anything is read', () => {
  const plan = planUpload(301 * MB, true);
  assert.equal(plan.action, 'refuse');
});

test('a phone clip is compressed from its path before a byte reaches memory', () => {
  // The report: posting a 200-300 MB video restarted the app. Both sizes are
  // compressed first, and neither is ever handed to `uriToBlob` at full size.
  for (const mb of [200, 300]) {
    const plan = planUpload(mb * MB, true);
    assert.deepEqual(plan, { action: 'compress-first', targetBytes: UPLOAD_TARGET_BYTES });
  }
});

test('a small phone clip is uploaded as it is — re-encoding would only lose quality', () => {
  assert.equal(planUpload(LEAVE_ALONE_BYTES, true).action, 'use-as-is');
  assert.equal(planUpload(2 * MB, true).action, 'use-as-is');
});

test('the web keeps its existing order: the blob is already in memory', () => {
  assert.equal(planUpload(200 * MB, false).action, 'use-as-is');
});

test('a size that cannot be measured is not a reason to refuse anything', () => {
  assert.equal(planUpload(null, true).action, 'use-as-is');
  assert.equal(planUpload(PICK_LIMIT_BYTES, true).action, 'compress-first');
});

test('a failed phone transcode never loads a source larger than the upload ceiling into memory', () => {
  const uploadMax = 120 * MB;
  assert.equal(mustStopAfterFailedCompression(200 * MB, uploadMax), true);
  assert.equal(mustStopAfterFailedCompression(300 * MB, uploadMax), true);
  assert.equal(mustStopAfterFailedCompression(uploadMax, uploadMax), false);
  assert.equal(mustStopAfterFailedCompression(null, uploadMax), false);
});
