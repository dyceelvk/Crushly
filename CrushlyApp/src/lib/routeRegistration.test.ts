import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/**
 * Every screen the app navigates to has to exist in a navigator.
 *
 * React Navigation does not throw when `navigate()` targets a screen nobody
 * registered. It reports an unhandled action, the call resolves, and whatever
 * the caller was doing — finishing onboarding, closing a modal, moving on to
 * the next step — just never happens. The button spins and nothing else.
 *
 * That is exactly how 1.0.107 broke onboarding for every new member: the last
 * step was imported, typed in `types.ts`, and navigated to, but the
 * `<Stack.Screen>` line was never added. Nothing caught it — not TypeScript
 * (the param list had the name), not the tests, not a crash. These assertions
 * are the check that was missing.
 */

const APP_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SRC = join(APP_ROOT, 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const FILES = walk(SRC).map((path) => ({ path, code: readFileSync(path, 'utf8') }));

/** Screens registered on a navigator, wherever they are declared. */
function registeredScreens(): Set<string> {
  const names = new Set<string>();
  for (const { code } of FILES) {
    for (const m of code.matchAll(/<([A-Za-z]+)\.Screen\s+name="([A-Za-z0-9_]+)"/g)) {
      names.add(m[2]);
    }
  }
  return names;
}

/**
 * Screens the app actually asks for, in the literal forms. An interpolated
 * target would be a bug in itself, so it is not quietly skipped: the pattern
 * simply does not match it and the route goes unchecked, which is why the
 * onboarding check below names its screen explicitly as well.
 */
function navigationTargets(): Map<string, string[]> {
  const targets = new Map<string, string[]>();
  const pattern = /\b(?:navigate|replace|push)\(\s*(['"`])([A-Za-z0-9_]+)\1/g;
  for (const { path, code } of FILES) {
    const rel = path.slice(APP_ROOT.length);
    for (const m of code.matchAll(pattern)) {
      const list = targets.get(m[2]) ?? [];
      list.push(rel);
      targets.set(m[2], list);
    }
  }
  return targets;
}

test('every screen the app navigates to is registered on a navigator', () => {
  const registered = registeredScreens();
  const missing: string[] = [];
  for (const [name, callers] of navigationTargets()) {
    if (!registered.has(name)) missing.push(`${name} (${[...new Set(callers)].join(', ')})`);
  }
  assert.deepEqual(missing, [], `navigate() targets with no <Stack.Screen>: ${missing.join(' | ')}`);
});

test('the last onboarding step is registered, so onboarding can be finished', () => {
  // The screen that runs `completeOnboarding()`. If it is missing, every new
  // member stops on the final welcome with a button that does nothing.
  assert.ok(registeredScreens().has('OnboardingComplete'));
  const root = readFileSync(join(SRC, 'navigation/RootNavigator.tsx'), 'utf8');
  assert.match(root, /<Stack\.Screen\s+name="OnboardingComplete"\s+component=\{OnboardingCompleteScreen\}/);
});

test('nested tab screens are registered too, so the check above is not lenient', () => {
  const registered = registeredScreens();
  for (const nested of ['Main', 'Discover', 'Messages', 'Profile']) {
    assert.ok(registered.has(nested), nested);
  }
});
