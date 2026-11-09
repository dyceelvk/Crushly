import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir:'.', testMatch:'space-search.spec.ts', workers:1, timeout:60000,
  use:{ baseURL:process.env.E2E_BASE_URL || 'http://localhost:8081', viewport:{width:390,height:844},
    launchOptions:process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']} : undefined }
});
