import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PLUS_VISIBLE, showIncognitoControl } from './featureVisibility';

test('Plus and early access are disabled for this release', () => {
  assert.equal(PLUS_VISIBLE, false);
});
test('incognito remains visible only when needed to switch it off', () => {
  assert.equal(showIncognitoControl(false, false), false);
  assert.equal(showIncognitoControl(false, true), true);
  assert.equal(showIncognitoControl(true, false), true);
});
test('Plus entry points and route are gated, while their implementation remains', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.match(read('../navigation/RootNavigator.tsx'), /PLUS_VISIBLE\s*\?\s*<Stack\.Screen name="Plus"/);
  assert.match(read('../screens/settings/Settings.tsx'), /PLUS_VISIBLE\s*\?\s*<ListRow title="Crushly Plus"/);
  assert.match(read('../screens/profile/ProfileTab.tsx'), /PLUS_VISIBLE\s*\?\s*<Pressable[^\n]*navigate\('Plus'/);
  assert.match(read('../screens/settings/Info.tsx'), /PLUS_VISIBLE\s*\?\s*\[\{ h: '9\. Crushly Plus and payments'/);
  assert.match(read('../screens/settings/Plus.tsx'), /Join early access/);
  assert.match(read('../api/service.ts'), /recordPlusInterest/);
});
