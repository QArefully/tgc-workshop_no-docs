import { defineConfig, devices } from '@playwright/test';

import { BASE_URL } from './e2e/config';

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  // Keep specs honest: no accidental `.only`, no silent flake-passing locally.
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  fullyParallel: true,
  workers: isCI ? 1 : undefined,
  // Fail fast rather than letting a broken app burn a whole CI run.
  maxFailures: isCI ? 5 : 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  // Blocks until the API answers, not just Vite. See e2e/global-setup.ts.
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    // A facilitator with the app already running is never blocked.
    reuseExistingServer: true,
    // A cold start seeds the SQLite database before Vite serves anything.
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
