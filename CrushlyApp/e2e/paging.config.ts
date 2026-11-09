import { defineConfig } from '@playwright/test';

// A runner without Playwright's bundled browser can still drive a system
// Chromium: CHROMIUM_EXECUTABLE=/usr/bin/chromium. Without it, Playwright uses
// its own download exactly as before.
const launchOptions = {
  // Chromium's own swipe-to-navigate gesture swallows a horizontal touch drag:
  // the page is replaced by about:blank and the app receives nothing. That is
  // the browser navigating, not a Holup bug, so it is switched off for the run.
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    '--disable-features=OverscrollHistoryNavigation,TouchpadOverscrollHistoryNavigation'],
  ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
};
export default defineConfig({
  webServer: process.env.E2E_START_SERVER ? { command: 'node serve-export.mjs', url: 'http://localhost:8081' } : undefined,
  testDir: '.', testMatch: 'paging.spec.ts', workers: 1, timeout: 60000, reporter: 'line',
  use: { baseURL: process.env.E2E_BASE_URL || 'http://localhost:8081', viewport: { width: 390, height: 844 },
    launchOptions },
});
