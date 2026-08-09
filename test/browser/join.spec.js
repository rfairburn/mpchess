// Browser integration tests: join flow
import { test, expect } from '@playwright/test';
import { joinGame, resetAndGiveUp, createPlayerPages } from './helpers.js';

test.describe('Join flow', () => {
  test('Join overlay shows on page load', async ({ page }) => {
    await page.goto('/');

    // Wait for join overlay to become visible (WebSocket connected)
    await expect(page.locator('#join-overlay')).toBeVisible({ timeout: 10000 });

    // Buttons start disabled (loading state) until seat status arrives
    // They may already be enabled by the time we check, so just wait for enabled
    await expect(page.locator('#btn-join-white')).toBeEnabled({ timeout: 10000 });
    await expect(page.locator('#btn-join-black')).toBeEnabled({ timeout: 10000 });
  });

  test('Join as white, see role badge update', async ({ page }) => {
    await page.goto('/');
    await joinGame(page, 'white');

    await expect(page.locator('#join-overlay')).not.toBeVisible();
    await expect(page.locator('#role-badge')).toContainText('White');
  });

  test('Two tabs join as white + black', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await createPlayerPages(browser, {
      baseURL: 'http://localhost:3000',
      viewport: { width: 1280, height: 720 },
    });

    try {
      await joinGame(p1, 'white');
      await joinGame(p2, 'black');

      // Both role badges correct
      await expect(p1.locator('#role-badge')).toContainText('White');
      await expect(p2.locator('#role-badge')).toContainText('Black');

      // Player count shows 2 on both pages
      await expect(p1.locator('#player-count')).toContainText('2');
      await expect(p2.locator('#player-count')).toContainText('2');
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });
});
