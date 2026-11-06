import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUESTION_TIMEOUT_MS, UPLOAD_TIMEOUT_MS, budgetFor, fetchWithDeadline, timeoutMessage } from './requestClock';

/* Behaves like fetch on a half-open socket: it does not answer, and it only
   settles when the signal aborts — which is exactly the case that used to leave
   a screen on its skeleton forever. */
const hangs = (_input: RequestInfo | URL, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });
const ok = async () => new Response('{}', { status: 200 });
const fast = { budget: () => 25 };

test('a question gets a short deadline and a body gets a long one', () => {
  assert.equal(budgetFor('https://x.supabase.co/rest/v1/rpc/crush_posts_feed'), QUESTION_TIMEOUT_MS);
  assert.equal(budgetFor('https://x.supabase.co/auth/v1/token?grant_type=password'), QUESTION_TIMEOUT_MS);
  assert.equal(budgetFor('https://x.supabase.co/storage/v1/object/media/photos/1/a.jpg'), UPLOAD_TIMEOUT_MS);
  // A read of a private file through the Worker is a question, not an upload.
  assert.equal(budgetFor('https://media.crushly.app/media/photos/1/a.jpg'), QUESTION_TIMEOUT_MS);
});

test('a request that is never answered fails at the deadline instead of hanging forever', async () => {
  const fetch = fetchWithDeadline(hangs, fast);
  await assert.rejects(
    () => fetch('https://x.supabase.co/rest/v1/rpc/anything', { method: 'POST' }),
    (e: Error) => (e as Error & { code?: string }).code === 'REQUEST_TIMEOUT' && /took longer than/.test(e.message),
  );
});

test('it aborts the request it gave up on, so the socket is released', async () => {
  const seen: { signal: AbortSignal | null } = { signal: null };
  const fetch = fetchWithDeadline(
    (_input, init) => {
      seen.signal = init?.signal ?? null;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    },
    fast,
  );
  await assert.rejects(() => fetch('https://x.supabase.co/rest/v1/rpc/anything'));
  assert.equal(seen.signal?.aborted, true);
});

test('an answer is passed straight through', async () => {
  const fetch = fetchWithDeadline(ok, fast);
  const response = await fetch('https://x.supabase.co/rest/v1/rpc/anything');
  assert.equal(response.status, 200);
});

test('the caller’s own abort is not reported as our deadline', async () => {
  const controller = new AbortController();
  const fetch = fetchWithDeadline(
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }),
    { budget: () => 60_000 },
  );
  const p = fetch('https://x.supabase.co/rest/v1/rpc/anything', { signal: controller.signal });
  controller.abort();
  await assert.rejects(p, (e: Error) => e.name === 'AbortError');
});

test('a caller who was already aborted is not waited for', async () => {
  const controller = new AbortController();
  controller.abort();
  const fetch = fetchWithDeadline(
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        if (init?.signal?.aborted) reject(new DOMException('Aborted', 'AbortError'));
      }),
    { budget: () => 60_000 },
  );
  await assert.rejects(() => fetch('https://x.supabase.co/rest/v1/rpc/x', { signal: controller.signal }), (e: Error) => e.name === 'AbortError');
});

test('the message never claims a timeout that did not happen', () => {
  assert.match(timeoutMessage(15_000), /took longer than 15 seconds/);
  assert.match(timeoutMessage(300_000), /took longer than 5 minutes/);
  assert.doesNotMatch(timeoutMessage(15_000), /offline/i);
});
