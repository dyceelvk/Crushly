#!/usr/bin/env node
/**
 * Write the numbers of the build that was just published into the download
 * page, so the page a non-JavaScript reader keeps is never one release old.
 *
 * `public/download/index.html` rewrites itself from the Worker when its script
 * runs, but the HTML carries a filename, a byte count and a fingerprint for
 * the case where the request is slow, blocked, or cached. Those baked-in
 * values are what `check-download-page.mjs` compares against the published
 * build, and they were being updated by hand — which is the same shape of
 * mistake as the one that left the page offering 1.0.2 for two releases.
 *
 * The Android workflow calls this with the size and SHA-256 of the file it
 * actually put on the release, and commits the result beside `release.json`.
 * Neither value is typed by a person, so neither can be typed wrong.
 *
 * Usage:
 *   node scripts/write-download-page.mjs --version 1.0.11 \
 *     --bytes 92994875 --sha256 cb55b5…
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const pagePath = path.join(appRoot, 'public/download/index.html');

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  args.set(a.slice(2), process.argv[i + 1]);
  i += 1;
}

const version = args.get('version');
const bytesOf = args.get('bytes');
const sha256 = args.get('sha256');

if (!version || !bytesOf || !sha256) {
  console.error('write-download-page: --version, --bytes and --sha256 are all required.');
  process.exit(1);
}
if (!/^[0-9a-f]{64}$/.test(sha256)) {
  console.error(`write-download-page: "${sha256}" is not a sha256 in lowercase hex.`);
  process.exit(1);
}
const bytes = Number(bytesOf);
if (!Number.isInteger(bytes) || bytes <= 0) {
  console.error(`write-download-page: "${bytesOf}" is not a byte count.`);
  process.exit(1);
}

const before = fs.readFileSync(pagePath, 'utf8');
let after = before;

const swap = (id, value, html) => {
  const re = new RegExp(`(id="${id}"[^>]*>)([^<]*)(<)`);
  if (!re.test(html)) throw new Error(`the page has no element with id="${id}"`);
  return html.replace(re, `$1${value}$3`);
};

after = swap('filename', `Crushly-${version}-Android9plus.apk`, after);
after = swap('bytes', bytes.toLocaleString('en-US'), after);
after = swap('sha', sha256, after);
// The two size lines read "94.43 MB download (some phones display 90.05 MB)":
// MiB for the first, MB for the second, because phones disagree about which
// one they print and a member measuring the file should find their number.
after = swap(
  'size',
  `${(bytes / 1048576).toFixed(2)} MB download (some phones display ${(bytes / 1e6).toFixed(2)} MB)`,
  after,
);

if (after === before) {
  console.log(`Download page already describes ${version}.`);
} else {
  fs.writeFileSync(pagePath, after);
  console.log(`Download page now describes ${version}: ${bytes.toLocaleString('en-US')} bytes, ${sha256.slice(0, 8)}…`);
}
