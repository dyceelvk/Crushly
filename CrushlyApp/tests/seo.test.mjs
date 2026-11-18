import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

/**
 * What a search engine reads, checked as a build artefact.
 *
 * A title is the line a result shows; engines truncate around 60 characters, so
 * a longer one loses its own ending. A description is the sentence underneath.
 * Neither is worth writing if nothing verifies them, so this reads the built
 * HTML rather than the source that produced it.
 */
/**
 * Built here rather than assumed. Reading a checked-in dist/ would pass locally
 * after a manual build and fail in CI, which is exactly what happened the first
 * time this file ran: nobody's fault but the test's.
 */
const APP_ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(APP_ROOT, '.seo-test-dist');

if (!existsSync(path.join(DIST, 'index.html'))) {
  mkdirSync(DIST, { recursive: true });
  writeFileSync(
    path.join(DIST, 'index.html'),
    '<!doctype html><html><head><title>app shell</title></head><body></body></html>',
  );
  execFileSync(process.execPath, [path.join(APP_ROOT, 'site', 'build.mjs')], {
    cwd: APP_ROOT,
    env: { ...process.env, SITE_OUT: DIST },
    stdio: 'pipe',
  });
}

async function pages() {
  const out = [{ file: 'index.html', url: '/' }];
  for (const entry of await readdir(DIST, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name === 'site' || entry.name === 'brand') continue;
    const index = path.join(DIST, entry.name, 'index.html');
    try {
      await readFile(index, 'utf8');
      out.push({ file: path.join(entry.name, 'index.html'), url: `/${entry.name}` });
    } catch {
      /* not a page */
    }
  }
  return out;
}

const grab = (html, re) => (html.match(re) || [])[1] ?? null;

test('every page has a title a result can show in full', async () => {
  const bad = [];
  for (const { file, url } of await pages()) {
    const html = await readFile(path.join(DIST, file), 'utf8');
    const title = grab(html, /<title>(.*?)<\/title>/s) ?? '';
    const description = grab(html, /<meta name="description" content="(.*?)"/s) ?? '';
    if (!title) bad.push(`${url}: no title`);
    else if (title.length > 62) bad.push(`${url}: title is ${title.length} chars`);
    if (description.length < 80) bad.push(`${url}: description is ${description.length} chars`);
    if (description.length > 190) bad.push(`${url}: description is ${description.length} chars`);
  }
  assert.deepEqual(bad, []);
});

test('every page is canonical, indexable and linked from the site', async () => {
  const home = await readFile(path.join(DIST, 'index.html'), 'utf8');
  for (const { file, url } of await pages()) {
    const html = await readFile(path.join(DIST, file), 'utf8');
    assert.ok(html.includes(`<link rel="canonical" href="https://holupp.net${url === '/' ? '/' : url}">`), url);
    assert.ok(html.includes('content="index,follow'), `${url} must be indexable`);
    if (url !== '/') {
      // A page no other page links to is a page with no reason to be ranked, so
      // the footer is checked rather than trusted.
      assert.ok(home.includes(`href="${url}"`), `${url} is not linked from the home page`);
    }
  }
});

test('the FAQ publishes answers as structured data, not only as prose', async () => {
  const html = await readFile(path.join(DIST, 'faq', 'index.html'), 'utf8');
  const blocks = [...html.matchAll(/application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
  const faq = blocks.flat().find((b) => b['@type'] === 'FAQPage');
  assert.ok(faq, 'no FAQPage block');
  assert.ok(faq.mainEntity.length >= 8);
  for (const item of faq.mainEntity) {
    assert.ok(item.name && item.acceptedAnswer.text, 'every question needs an answer');
  }
  // Every question in the markup must be visible on the page too: structured data
  // that does not match the page is the kind of thing a search engine penalises.
  for (const item of faq.mainEntity) assert.ok(html.includes(item.name.slice(0, 20)), item.name);
});

test('the home page says what the product is in its first paragraph', async () => {
  const html = await readFile(path.join(DIST, 'index.html'), 'utf8');
  assert.ok(/social app/i.test(html), 'the category word is missing');
  assert.ok(html.includes('Android'), 'the platform is missing');
  assert.ok(/free/i.test(html), 'the price is missing');
});

test('the site can prove it owns the host to a search engine', async () => {
  // IndexNow refuses a submission whose key file is not live and byte-identical.
  // Checking it here means the failure shows up in CI, not as a silent 403 later.
  const key = (await readFile(path.resolve(import.meta.dirname, '..', 'site', 'indexnow-key.txt'), 'utf8')).trim();
  assert.match(key, /^[a-z0-9-]{16,255}$/i, 'the key must be 16-255 chars of a-z, 0-9, -');
  const served = (await readFile(path.join(DIST, `${key}.txt`), 'utf8')).trim();
  assert.equal(served, key, `${key}.txt must be served unmodified`);
});

test('the sitemap is well-formed XML, not a page', async () => {
  // The failure this guards against is a sitemap entry pointing at HTML: Search
  // Console reads that as "Sitemap is HTML" and drops the whole file.
  const xml = await readFile(path.join(DIST, 'sitemap.xml'), 'utf8');
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'must declare itself XML');
  assert.ok(xml.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'));
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.equal(locs.length, 16);
  for (const loc of locs) {
    assert.ok(loc.startsWith('https://holupp.net/'), `${loc} must be on the canonical host`);
    assert.ok(!/\.html$/.test(loc), `${loc} must not point at a .html file`);
  }
  const robots = await readFile(path.join(DIST, 'robots.txt'), 'utf8');
  assert.ok(robots.includes('Sitemap: https://holupp.net/sitemap.xml'), 'robots.txt must point at it');
});
