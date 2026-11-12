/**
 * Starting the marking job from the Worker.
 *
 * The job lives in Actions because it needs ffmpeg. What went wrong was the
 * trigger: GitHub's five-minute schedule fires a few times a day on a quiet
 * repo (and a literal five-minute cron in a comment ends the comment), so
 * the gap between posting a clip and having a copy to save was measured in
 * hours. The Worker's own cron is not throttled, so it dispatches the job.
 *
 * These tests stand in for GitHub. No network.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { dispatchMarking } from './index';

const env = (over: Record<string, unknown> = {}) =>
  ({ MARK_DISPATCH_TOKEN: 'ghp_test', ...over }) as never;

test('a configured Worker starts the job, with no member data in the request', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: init as RequestInit });
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  try {
    assert.equal(await dispatchMarking(env(), () => 1000), 'started');
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      'https://api.github.com/repos/dyceelvk/Crushly/actions/workflows/mark-clips.yml/dispatches',
    );
    assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer ghp_test');
    const body = JSON.parse(String(calls[0].init.body));
    assert.equal(body.ref, 'main');
    // The job asks the database what is missing; the Worker names no post.
    assert.equal(body.inputs.post_ids, '');
  } finally {
    globalThis.fetch = original;
  }
});

test('without a token the tick does nothing at all', async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => { called = true; return new Response(null, { status: 204 }); }) as typeof fetch;
  try {
    assert.equal(await dispatchMarking(env({ MARK_DISPATCH_TOKEN: undefined })), 'skipped');
    assert.equal(called, false, 'no request is made without a token');
  } finally {
    globalThis.fetch = original;
  }
});

test('a refused or broken dispatch is reported, never thrown', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response('nope', { status: 401 })) as typeof fetch;
    assert.equal(await dispatchMarking(env()), 'skipped');
    globalThis.fetch = (async () => { throw new Error('offline'); }) as typeof fetch;
    assert.equal(await dispatchMarking(env()), 'skipped');
  } finally {
    globalThis.fetch = original;
  }
});

test('the repository can be pointed elsewhere without touching code', async () => {
  const original = globalThis.fetch;
  let seen = '';
  globalThis.fetch = (async (url: unknown) => {
    seen = String(url);
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  try {
    await dispatchMarking(env({ MARK_REPO: 'someone/fork' }), () => 1);
    assert.ok(seen.includes('/repos/someone/fork/'));
  } finally {
    globalThis.fetch = original;
  }
});
