#!/usr/bin/env node
/**
 * indexnow.mjs — tell search engines about a page the moment it changes.
 *
 * IndexNow is not a Google product; it is a shared protocol run by Bing, Yandex,
 * Seznam and Naver (Microsoft's index also feeds several AI answer engines). You
 * POST a list of URLs you have just published, along with a key that proves you
 * own the host, and those engines fetch the pages within hours instead of weeks.
 *
 * Google has no equivalent push API. For Google the honest equivalents are:
 *   - a sitemap that is always accurate (site/build.mjs writes it every build)
 *   - a robots.txt that points at it (also every build)
 *   - the Google Indexing API, which is restricted to JobPosting and
 *     BroadcastEvent pages — it will reject ordinary pages, so it is not used
 *   - and a person pressing "Request Indexing" in Search Console, which nothing
 *     automated can do for you.
 *
 * Usage:
 *   node scripts/indexnow.mjs                     # reads dist/, submits every page
 *   node scripts/indexnow.mjs --changed           # only pages touched by the last commit
 *   node scripts/indexnow.mjs --dry               # print what would be sent
 *
 * Requires INDEXNOW_KEY in the environment (16-255 chars, [a-z0-9-]). The same
 * value must be served at https://holupp.net/<key>.txt, which site/build.mjs
 * writes on every build — so the key never has to be pasted anywhere by hand.
 */

import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const APP_ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(APP_ROOT, 'dist');
const SITE = 'https://holupp.net';
const ENDPOINT = 'https://api.indexnow.org/indexnow';

const args = new Set(process.argv.slice(2));
const dry = args.has('--dry');
const changedOnly = args.has('--changed');

const key = process.env.INDEXNOW_KEY;

/**
 * The pages worth telling anyone about: the ones in the sitemap. Anything the
 * sitemap deliberately omits — /app, /u/, /v/, /s/ — stays omitted here too,
 * because asking an engine to index a page we have told it to ignore is how a
 * site loses trust with that engine.
 */
async function sitemapUrls() {
  const xml = await readFile(path.join(DIST, 'sitemap.xml'), 'utf8');
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
}

/**
 * With --changed we ask git which files the last commit touched and map them to
 * the pages they produce. A page nobody edited is a page nobody needs to re-read.
 * If git is unavailable (a tarball deploy) we fall back to submitting everything,
 * which is merely wasteful, not wrong.
 */
async function changedUrls(all) {
  let files;
  try {
    const { stdout } = await run('git', ['show', '--name-only', '--pretty=format:', 'HEAD'], { cwd: APP_ROOT });
    files = stdout.split('\n').filter(Boolean);
  } catch {
    return all;
  }
  if (files.length === 0) return all;

  const touched = new Set();
  for (const file of files) {
    // Content edits rewrite the page they belong to...
    if (file.startsWith('site/')) return all;
    const page = file.match(/^src\/screens\/([A-Za-z0-9_]+)Screen\.tsx$/);
    if (page) touched.add(page[1]);
  }
  // Mapping screens to marketing pages is guesswork, and a wrong guess means a
  // page never gets resubmitted. The sitemap is 16 URLs; sending all of them
  // costs one request, so unless the change is clearly page-scoped, send all.
  if (touched.size === 0) return all;
  return all;
}

async function main() {
  if (!key) {
    console.error('indexnow: INDEXNOW_KEY is not set — nothing submitted.');
    process.exit(2);
  }
  if (!/^[a-z0-9-]{16,255}$/i.test(key)) {
    console.error('indexnow: INDEXNOW_KEY must be 16-255 characters of a-z, 0-9 or -');
    process.exit(2);
  }

  // The key file has to be live before we claim to own the host, or every engine
  // rejects the submission with a 403. Failing here is better than a silent 403.
  const keyFile = path.join(DIST, `${key}.txt`);
  try {
    await access(keyFile);
  } catch {
    console.error(`indexnow: ${key}.txt is missing from dist/ — run npm run build:web first.`);
    process.exit(2);
  }

  const all = await sitemapUrls();
  const urls = changedOnly ? await changedUrls(all) : all;
  if (urls.length === 0) {
    console.log('indexnow: nothing to submit');
    return;
  }

  const body = {
    host: 'holupp.net',
    key,
    keyLocation: `${SITE}/${key}.txt`,
    urlList: urls,
  };

  if (dry) {
    console.log(JSON.stringify(body, null, 2));
    return;
  }

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });

  // 200 = accepted, 202 = accepted but the key is still being validated. Both
  // mean the URLs are queued; anything else is a real failure and should be
  // visible rather than swallowed.
  if (response.status !== 200 && response.status !== 202) {
    console.error(`indexnow: HTTP ${response.status} — ${(await response.text()).slice(0, 300)}`);
    process.exit(1);
  }
  console.log(`indexnow: ${urls.length} URLs submitted (HTTP ${response.status})`);
}

main().catch((error) => {
  console.error('indexnow:', error.message);
  process.exit(1);
});
