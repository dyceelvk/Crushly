#!/usr/bin/env node
/**
 * The download page is read by people whose phone will not run its script.
 *
 * `public/download/index.html` asks the media Worker what the current build is
 * and rewrites itself when the answer arrives. Behind that, the HTML already
 * carries a version, a filename, a byte count and a fingerprint, so the page
 * still says something true if the request is slow, blocked, or served from a
 * cache. Those baked-in values are the ones a non-JavaScript reader keeps, and
 * every release makes them one build older unless somebody remembers.
 *
 * They were forgotten once: the page offered 1.0.2 for two releases and the
 * file behind it had since been removed. This check makes forgetting loud. It
 * runs with the rest of the tests, so a release that bumps `app.json` without
 * bringing the page along fails the build instead of shipping.
 *
 * `release.json` is written by the Android workflow *after* the APK exists,
 * from measurements of the real file, so it is the authority on size and
 * checksum. Until a build has published, its version may sit behind app.json;
 * that is expected and the page is allowed to match it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const repoRoot = path.resolve(appRoot, '..');

const page = fs.readFileSync(path.join(appRoot, 'public/download/index.html'), 'utf8');
const app = JSON.parse(fs.readFileSync(path.join(appRoot, 'app.json'), 'utf8'));
const release = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'cloudflare/media-worker/src/release.json'), 'utf8'),
);

const problems = [];
const text = (id) => {
  const m = page.match(new RegExp(`id="${id}"[^>]*>([^<]*)<`));
  return m ? m[1].trim() : null;
};

// The link must survive a release, so it points at the Worker's stable alias
// rather than at a filename that is fixed when the page is written.
const href = (page.match(/id="dl"[^>]*href="([^"]*)"/) || [])[1] || '';
if (!href.endsWith('/apk/latest')) {
  problems.push(
    `the download link is "${href}" — it must point at /apk/latest, because a ` +
      'named file is a 404 the morning after the next release',
  );
}

// Whichever build the Worker is currently serving is the one the page should
// describe. Between a version bump and the build that publishes it, the two
// legitimately differ, so accept either and name the one to update.
const served = release.version === app.expo.version ? release : null;

const shownFile = text('filename');
if (shownFile && served && shownFile !== served.file) {
  problems.push(`the page names "${shownFile}" but the served build is "${served.file}"`);
}

const shownBytes = text('bytes');
if (shownBytes && served) {
  const digits = shownBytes.replace(/[^0-9]/g, '');
  if (digits !== String(served.bytes)) {
    problems.push(`the page says ${shownBytes} bytes but the served build is ${served.bytes}`);
  }
}

const shownSha = text('sha');
if (shownSha && served && shownSha !== served.sha256) {
  problems.push('the page prints a different sha256 from the one published for this build');
}

if (problems.length) {
  console.error('The download page disagrees with the build it offers:');
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    `\nHighest version in play: ${app.expo.version} (from app.json). ` +
      'Update CrushlyApp/public/download/index.html, or let the Android build publish first.',
  );
  process.exit(1);
}

console.log(
  `Download page agrees with the build it offers${served ? ` (${served.version})` : ''}.`,
);
