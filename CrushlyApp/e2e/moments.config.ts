import { defineConfig } from '@playwright/test';

/**
 * The Moments surfaces, offline, against the local web export.
 *
 * Same shape as the other offline configs: the server is started by the runner
 * when `E2E_START_SERVER` is set, the viewport is a phone, and a system Chromium
 * can stand in for Playwright's download via `CHROMIUM_EXECUTABLE`.
 */
const launchOptions = {
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
};

export default defineConfig({
  webServer: process.env.E2E_START_SERVER
    ? { command: 'node serve-export.mjs', url: 'http://localhost:8081', reuseExistingServer: true }
    : undefined,
  testDir: '.',
  testMatch: 'moment-circles.spec.ts',
  workers: 1,
  timeout: 60_000,
  reporter: 'line',
  outputDir: 'test-results',
  use: { baseURL: process.env.E2E_BASE_URL || 'http://localhost:8081', viewport: { width: 390, height: 844 }, launchOptions },
});
