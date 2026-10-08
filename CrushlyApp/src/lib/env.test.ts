import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cleanEnvValue, looksLikeSecretKey, normalizeProjectUrl } from './env';

test('cleanEnvValue strips whitespace and stray quotes', () => {
  assert.equal(cleanEnvValue('  "abc"  '), 'abc');
  assert.equal(cleanEnvValue("'abc'"), 'abc');
  assert.equal(cleanEnvValue(''), '');
  assert.equal(cleanEnvValue(undefined), '');
  assert.equal(cleanEnvValue('a"b'), 'a"b'); // inner quotes untouched
});

test('bare project URLs pass through (minus slash noise)', () => {
  assert.equal(normalizeProjectUrl('https://abc.supabase.co'), 'https://abc.supabase.co');
  assert.equal(normalizeProjectUrl('https://abc.supabase.co/'), 'https://abc.supabase.co');
  assert.equal(normalizeProjectUrl(' abc.supabase.co '), 'https://abc.supabase.co');
});

test('the /rest/v1 paste trap is reduced to the origin', () => {
  // The Supabase Data API page shows exactly this — the bug behind
  // "Invalid path specified in request URL".
  assert.equal(normalizeProjectUrl('https://abc.supabase.co/rest/v1/'), 'https://abc.supabase.co');
  assert.equal(normalizeProjectUrl('https://abc.supabase.co/rest/v1'), 'https://abc.supabase.co');
  assert.equal(normalizeProjectUrl('https://abc.supabase.co/auth/v1'), 'https://abc.supabase.co');
  assert.equal(normalizeProjectUrl('https://abc.supabase.co/storage/v1/whatever'), 'https://abc.supabase.co');
});

test('dashboard links and bare refs resolve to the project host', () => {
  assert.equal(normalizeProjectUrl('https://supabase.com/dashboard/project/xyz-123'), 'https://xyz-123.supabase.co');
  assert.equal(normalizeProjectUrl('xyz-123'), 'https://xyz-123.supabase.co');
});

test('local dev URLs keep their port, drop their path', () => {
  assert.equal(normalizeProjectUrl('http://127.0.0.1:54321/auth/v1'), 'http://127.0.0.1:54321');
  assert.equal(normalizeProjectUrl('http://localhost:54321'), 'http://localhost:54321');
});

test('connection strings derive the host or are rejected', () => {
  assert.equal(normalizeProjectUrl('postgresql://db.abc.supabase.co:5432/postgres'), 'https://abc.supabase.co');
  assert.equal(normalizeProjectUrl('postgres://db.abc.supabase.co:6543/postgres'), 'https://abc.supabase.co');
  assert.equal(normalizeProjectUrl('postgresql://db.internal:5432/postgres'), '');
});

test('unusable values normalize to empty', () => {
  assert.equal(normalizeProjectUrl(''), '');
  assert.equal(normalizeProjectUrl(null), '');
  assert.equal(normalizeProjectUrl('not a url'), '');
  assert.equal(normalizeProjectUrl('just some words'), '');
});

test('secret keys are detected and never pass as client keys', () => {
  const jwt = (role: string) => {
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${enc({ alg: 'HS256' })}.${enc({ iss: 'supabase', role, iat: 1 })}.sig`;
  };
  assert.equal(looksLikeSecretKey('sb_secret_abc123'), true);
  assert.equal(looksLikeSecretKey('"sb_secret_abc123"'), true);
  assert.equal(looksLikeSecretKey(jwt('service_role')), true);
  // Safe client keys pass.
  assert.equal(looksLikeSecretKey('sb_publishable_abc123'), false);
  assert.equal(looksLikeSecretKey(jwt('anon')), false);
  assert.equal(looksLikeSecretKey(''), false);
  assert.equal(looksLikeSecretKey(undefined), false);
});
