import test from 'node:test';
import assert from 'node:assert/strict';
import { DELETE_COPY, deleteDetail, deleteErrorTitle, deleteOutcome, deleteSuccessTitle } from './deleteCopy';

test('the question is the same everywhere', () => {
  assert.equal(DELETE_COPY.title, 'Delete this item?');
  assert.equal(DELETE_COPY.message, 'Are you sure you want to delete this? This action cannot be undone.');
  assert.equal(DELETE_COPY.confirmLabel, 'Delete');
  assert.equal(DELETE_COPY.cancelLabel, 'Cancel');
});

test('a quiet default for both outcomes', () => {
  assert.equal(deleteSuccessTitle(), 'Deleted');
  assert.equal(deleteErrorTitle(), 'Not deleted');
  assert.equal(deleteSuccessTitle({}), 'Deleted');
  assert.equal(deleteErrorTitle({}), 'Not deleted');
});

test('a caller may name what happened, but blank is not a name', () => {
  assert.equal(deleteSuccessTitle({ successTitle: 'Moment deleted' }), 'Moment deleted');
  assert.equal(deleteErrorTitle({ errorTitle: 'Not removed' }), 'Not removed');
  assert.equal(deleteSuccessTitle({ successTitle: '   ' }), 'Deleted');
  assert.equal(deleteErrorTitle({ errorTitle: '' }), 'Not deleted');
});

test('the small print is optional and never a stray gap', () => {
  assert.equal(deleteDetail(undefined), null);
  assert.equal(deleteDetail(''), null);
  assert.equal(deleteDetail('   '), null);
  assert.equal(deleteDetail(' It is gone for both of you. '), 'It is gone for both of you.');
});

test('a failure keeps the dialog open; only success closes it', () => {
  assert.deepEqual(deleteOutcome(true), { close: true, kind: 'success' });
  assert.deepEqual(deleteOutcome(false), { close: false, kind: 'error' });
});

test('a thrown delete is never reported as a success', () => {
  /* The component turns a throw into `ok = false`; this is that mapping, so a
     rejected promise can never be toasted as "Deleted" with the item still
     there. */
  const thrown = (() => {
    try {
      throw new Error('network');
    } catch {
      return false;
    }
  })();
  assert.equal(deleteOutcome(thrown).kind, 'error');
  assert.equal(deleteOutcome(thrown).close, false);
});
