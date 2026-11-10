#!/usr/bin/env node
/**
 * Fails the build if a native-only module reached the web bundle.
 *
 * Written after a white screen reached production. `expo-media-library` has no
 * web implementation and throws **while being imported** — so a single top-level
 * `import` in a component the web app loads at startup took the whole site down,
 * with a 200 response and nothing in the HTML to say why. Typecheck passed.
 * `expo export` passed. The unit tests passed. None of them load the bundle.
 *
 * Metro's platform extensions (`.native.ts` vs `.ts`) are the fix; this check is
 * what keeps the fix honest, because the failure mode is silent.
 *
 *   node scripts/check-web-bundle.mjs [dist]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = process.argv[2] ?? 'dist';

/** Native modules that crash on import in a browser, and what to do instead. */
const FORBIDDEN = [
  { marker: 'ExpoMediaLibraryNext', module: 'expo-media-library', instead: 'a .native.ts twin + a platform-free wrapper' },
  { marker: 'ExpoIntentLauncher', module: 'expo-intent-launcher', instead: 'a .native.ts twin' },
  { marker: 'ExpoSecureStore', module: 'expo-secure-store', instead: 'the browser storage path' },
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (path.endsWith('.js') || path.endsWith('.hbc')) yield path;
  }
}

let files;
try {
  files = [...walk(DIST)];
} catch {
  console.error(`check-web-bundle: ${DIST} not found. Run the web export first.`);
  process.exit(1);
}
if (files.length === 0) {
  console.error(`check-web-bundle: ${DIST} contains no JavaScript.`);
  process.exit(1);
}

const hits = [];
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  for (const rule of FORBIDDEN) {
    if (source.includes(rule.marker)) hits.push({ file, ...rule });
  }
}

if (hits.length > 0) {
  const seen = new Set();
  for (const hit of hits) {
    if (seen.has(hit.module)) continue;
    seen.add(hit.module);
    console.error(`check-web-bundle: ${hit.module} is in the web bundle (${hit.file}).`);
    console.error(`  It throws on import in a browser and blanks the whole app.`);
    console.error(`  Fix: ${hit.instead}.`);
  }
  process.exit(1);
}

console.log(`check-web-bundle: ${files.length} files, no native-only modules.`);
