// Browser integration test: background image loads successfully
import { test, expect } from '@playwright/test';

test('background.png loads with 200 status', async ({ page }) => {
  const responsePromise = page.waitForResponse(
    (resp) => resp.url().includes('background.png') && resp.status() === 200
  );

  await page.goto('/');

  await responsePromise;
});
