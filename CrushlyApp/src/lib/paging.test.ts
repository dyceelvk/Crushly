import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pagesToItems } from './paging';

const post = (id: number) => ({ id });

test('every page is kept, in order', () => {
  const pages = [{ items: [post(3), post(2)] }, { items: [post(1)] }];
  assert.deepEqual(pagesToItems(pages).map((p) => p.id), [3, 2, 1]);
});

test('a second page does not replace the first', () => {
  // The bug this exists to prevent: scrolling showed page two and nothing else.
  const pages = [{ items: [post(9), post(8)] }, { items: [post(7)] }];
  assert.equal(pagesToItems(pages).length, 3);
});

test('a row that arrives on two pages is drawn once', () => {
  // A post published mid-scroll shifts the boundary, so the last row of page one
  // is also the first row of page two.
  const pages = [{ items: [post(5), post(4)] }, { items: [post(4), post(3)] }];
  assert.deepEqual(pagesToItems(pages).map((p) => p.id), [5, 4, 3]);
});

test('no pages, empty pages, and a missing result are all just empty', () => {
  assert.deepEqual(pagesToItems(undefined), []);
  assert.deepEqual(pagesToItems(null), []);
  assert.deepEqual(pagesToItems([]), []);
  assert.deepEqual(pagesToItems([{ items: [] }]), []);
});
