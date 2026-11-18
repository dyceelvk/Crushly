import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * The retired hostname must not come back.
 *
 * `holupapp.vercel.app` belongs to no project, so any page, email, deep-link or
 * card that names it sends people to Vercel's "deployment not found". It is easy
 * to reintroduce by pasting an old URL, so this reads the files that become
 * public and fails the suite if it appears.
 *
 * The hostname is allowed in exactly two places, both deliberate: the source
 * that documents and retires it, and the robots files that ask for its removal.
 */
const RETIRED = 'holupapp.vercel.app';
const ALLOWED = new Set([
  'src/lib/publicSite.ts',      // the RETIRED_HOSTS list itself
  'src/lib/publicSite.test.ts', // the assertion that it stays retired
  'src/lib/profileShare.test.ts', // asserts a retired link is refused
  'tests/post-share.test.mjs',  // asserts a card never advertises it
  'tests/profile-share.test.mjs',
  'tests/no-retired-host.test.mjs',
  'site/build.mjs',             // the removal file it writes
]);

const ROOT = path.resolve(import.meta.dirname, '..');
const WALK = ['api', 'src', 'site', 'tests', 'public'];
const SKIP = new Set(['node_modules', 'dist', '.expo', 'web-build']);

async function* files(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else if (/\.(mjs|js|jsx|ts|tsx|json|html|css|webmanifest)$/.test(entry.name)) yield full;
  }
}

test('no published file names the retired hostname', async () => {
  const offenders = [];
  for (const dir of WALK) {
    for await (const file of files(path.join(ROOT, dir))) {
      const rel = path.relative(ROOT, file);
      if (ALLOWED.has(rel)) continue;
      const text = await readFile(file, 'utf8');
      if (text.includes(RETIRED)) offenders.push(rel);
    }
  }
  assert.deepEqual(offenders, [], `retired hostname found in: ${offenders.join(', ')}`);
});

test('the mail templates point their logo at the domain that serves it', async () => {
  for (const name of ['recovery.html', 'confirm-signup.html']) {
    const file = path.join(ROOT, '..', 'supabase', 'email-templates', name);
    const html = await readFile(file, 'utf8');
    assert.ok(html.includes('https://holupp.net/brand/crushly-mark.png'), name);
  }
});
