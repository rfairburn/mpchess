// @ts-check
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium-mobile',
      testMatch: /(?:mobile|join|moves|gameover|camera-buttons).*\.spec\.js/,
      use: {
        channel: 'chromium',
        viewport: { width: 844, height: 390 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'chromium-desktop',
      testIgnore: /(?:mobile|camera-buttons).*\.spec\.js/,
      use: {
        channel: 'chromium',
        viewport: { width: 1280, height: 720 },
      },
    },
  ],
  webServer: {
    command:
      'npm start -- --seat-timeout=5000 --allowed-origins=localhost,http://localhost:3000 --connection-rate-limit-max=100',
    port: 3000,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
