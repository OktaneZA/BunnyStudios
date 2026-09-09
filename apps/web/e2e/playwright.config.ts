import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests for the web app, run against a real server: the built image started by
 * deploy/release.mjs, or any URL in E2E_BASE_URL. The base URL should be the machine's LAN IP,
 * not localhost, so the origin is insecure exactly as it is on the NAS (crypto.randomUUID is
 * undefined there; that bug shipped once because tests ran on localhost).
 *
 *   E2E_BASE_URL=http://192.168.1.107:3999 npx playwright test -c apps/web/e2e
 */
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  outputDir: '../../../.playwright-results',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3999',
    // The Fire HD 10 in landscape reports roughly 1280×800 dp; test at the plan's 1024×768 floor.
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 768 } } }],
});
