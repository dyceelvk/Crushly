import { defineConfig } from '@playwright/test';
export default defineConfig({
  webServer: process.env.E2E_START_SERVER ? { command: 'node serve-export.mjs', url: 'http://localhost:8081' } : undefined,
  testDir: '.', testMatch: 'verification.spec.ts', workers: 1, timeout: 30000,
  use: { baseURL: process.env.E2E_BASE_URL || 'http://localhost:8081', viewport: { width: 390, height: 844 },
    launchOptions: process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      ignoreDefaultArgs: ['--disable-popup-blocking'] } : { ignoreDefaultArgs: ['--disable-popup-blocking'] } },
});
