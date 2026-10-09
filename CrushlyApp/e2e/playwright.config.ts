import { defineConfig } from '@playwright/test';

/**
 * E2E config for the auth journeys. Runs against a deployed site by default
 * (set E2E_BASE_URL), or a local dev server (`npm start` → :8081).
 * Playwright itself is NOT an app dependency — run via `npm run e2e`
 * (npx fetches it) or the "E2E (live site)" GitHub workflow.
 */
export default defineConfig({
  testDir: '.',
  testIgnore: ['verification.spec.ts'],
  timeout: 90_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:8081',
    viewport: { width: 390, height: 844 },
    locale: 'en-US',
  },
});
