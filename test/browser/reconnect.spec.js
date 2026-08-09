// Browser integration tests: reconnection resilience
import { test, expect } from '@playwright/test';
import { joinGame, makeMove2d, resetAndGiveUp } from './helpers.js';

test.describe.serial('Reconnection', () => {
  test.afterEach(async ({ page }) => {
    const joinVisible = await page.locator('#join-overlay').isVisible();
    if (!joinVisible) {
      await resetAndGiveUp(page);
    }
  });

  test('Reclaim seat after page reload', async ({ page }) => {
    await page.goto('/');

    // Join as white
    await joinGame(page, 'white');
    await expect(page.locator('#role-badge')).toContainText('White');

    // Reload the page — reconnection token persists in localStorage
    await page.reload();

    // Join overlay should appear with the white seat enabled (held by token)
    await expect(page.locator('#join-overlay')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#btn-join-white')).toBeEnabled({ timeout: 10000 });

    // Click White to rejoin
    await page.locator('#btn-join-white').click();
    await expect(page.locator('#join-overlay')).not.toBeVisible({ timeout: 10000 });

    // Verify role badge restored
    await expect(page.locator('#role-badge')).toContainText('White');
  });

  test('Seat held during brief disconnect', async ({ page }) => {
    await page.goto('/');

    // Join as white
    await joinGame(page, 'white');
    await expect(page.locator('#role-badge')).toContainText('White');

    // Make a move so we can verify game state is preserved after reconnect
    await makeMove2d(page, 4, 1, 4, 3); // e2-e4
    await expect(page.locator('#move-log')).toContainText('e4', { timeout: 5000 });

    // Simulate browser going offline, then force-close the WebSocket
    // (setOffline alone does not close the WS quickly enough in this environment)
    await page.context().setOffline(true);
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const ws = window.__mpchess_ws;
      if (ws && ws.readyState === 1) ws.close();
    });

    // Reconnecting overlay should appear
    await expect(page.locator('#reconnecting-overlay')).toBeVisible({ timeout: 10000 });

    // Restore connectivity so the auto-reconnect can succeed
    await page.context().setOffline(false);

    // Wait for auto-reconnection to complete
    await expect(page.locator('#reconnecting-overlay')).not.toBeVisible({ timeout: 15000 });

    // Seat restored — role badge still shows White
    await expect(page.locator('#role-badge')).toContainText('White');

    // Game state preserved — move log still shows e4
    await expect(page.locator('#move-log')).toContainText('e4', { timeout: 5000 });
  });
});
