// Browser integration tests: mobile-specific features
//
// These tests only run under the chromium-mobile project (testMatch in config).
// They validate the compact top bar, status drawer, and touch-based moves.

import { test, expect } from '@playwright/test';
import { joinGame, resetAndGiveUp, createPlayerPages, waitForMoveLog } from './helpers.js';

test.describe.serial('Mobile UI', () => {
  test.afterEach(async ({ page }) => {
    // Only clean up if this page was actually navigated to the app
    const url = page.url();
    if (!url.includes('localhost:3000')) return;

    try {
      const joinVisible = await page.locator('#join-overlay').isVisible({ timeout: 2000 });
      if (!joinVisible) {
        await resetAndGiveUp(page);
      }
    } catch {
      // Page in uncertain state — skip cleanup
    }
  });

  test('Compact top bar visible in landscape', async ({ page }) => {
    await page.goto('/');

    // Wait for the app to load
    await page.waitForSelector('#top-bar', { state: 'attached', timeout: 10000 });

    // On mobile viewport (844x390, coarse pointer, short height) the CSS media
    // query forces #top-bar to display:flex and hides #desktop-hud.
    const topBarDisplay = await page.evaluate(() => {
      const el = document.getElementById('top-bar');
      return el ? getComputedStyle(el).display : 'missing';
    });
    expect(topBarDisplay).not.toBe('none');
    expect(topBarDisplay).not.toBe('');

    // Desktop HUD should be hidden
    const desktopHudDisplay = await page.evaluate(() => {
      const el = document.getElementById('desktop-hud');
      return el ? getComputedStyle(el).display : 'missing';
    });
    expect(desktopHudDisplay).toBe('none');
  });

  test('Status drawer opens and shows move log', async ({ page }) => {
    await page.goto('/');

    // Wait for the top bar to be attached
    await page.waitForSelector('#btn-status-drawer', { state: 'attached', timeout: 10000 });

    // Hide the join overlay which blocks pointer events on the top bar
    await page.evaluate(() => {
      const el = document.getElementById('join-overlay');
      if (el) el.style.display = 'none';
    });

    // Tap the info (ℹ) button to open the status drawer
    await page.locator('#btn-status-drawer').click();

    // Drawer should be visible (has .open class)
    await expect(page.locator('#status-drawer')).toHaveClass(/open/, { timeout: 5000 });

    // Drawer content should contain move log, captures, and draw info elements
    await expect(page.locator('#drawer-move-log')).toBeVisible();
    await expect(page.locator('#drawer-captured-white')).toBeVisible();
    await expect(page.locator('#drawer-captured-black')).toBeVisible();
    // #drawer-draw-info is display:none in a fresh game (no draw info yet), so check attachment
    await expect(page.locator('#drawer-draw-info')).toBeAttached();
  });

  test('Touch drag makes a move', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await createPlayerPages(browser, {
      baseURL: 'http://localhost:3000',
      viewport: { width: 844, height: 390 },
      isMobile: true,
      hasTouch: true,
    });

    try {
      // Join as white and black
      await joinGame(p1, 'white');
      await joinGame(p2, 'black');

      // Ensure 2D board is visible
      const overlay = p1.locator('#board-2d-overlay');
      if ((await overlay.isVisible()) === false) {
        await p1.locator('#btn-board-2d').click();
        await expect(overlay).toBeVisible({ timeout: 5000 });
      }

      // Perform a real touch drag from e2 to e4 on the 2D board
      // Get bounding boxes of source and destination squares
      const { fromX, fromY, toX, toY } = await p1.evaluate(() => {
        const fromSq = document.querySelector('[data-file="4"][data-rank="1"]');
        const toSq = document.querySelector('[data-file="4"][data-rank="3"]');
        const fromRect = fromSq.getBoundingClientRect();
        const toRect = toSq.getBoundingClientRect();
        return {
          fromX: fromRect.left + fromRect.width / 2,
          fromY: fromRect.top + fromRect.height / 2,
          toX: toRect.left + toRect.width / 2,
          toY: toRect.top + toRect.height / 2,
        };
      });

      // Dispatch a real touch drag sequence using the CDP protocol.
      // Touch objects can't be constructed in JS, so we use Chromium DevTools
      // Protocol Input.dispatchTouchEvent which generates real touch events.
      const client = await p1.context().newCDPSession(p1);
      const midX = fromX + (toX - fromX) * 0.5;
      const midY = fromY + (toY - fromY) * 0.5;

      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: fromX, y: fromY, id: 1 }],
      });

      // Move beyond the drag threshold (10px) toward destination
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: midX, y: midY, id: 1 }],
      });

      // Move onto the destination square; CDP touchEnd must have no touch points.
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: toX, y: toY, id: 1 }],
      });

      await client.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      });

      // Verify move is registered in the move log
      await waitForMoveLog(p1, 'e4');

      // Verify black also sees the move
      await waitForMoveLog(p2, 'e4');
    } finally {
      // Clean up both pages
      for (const p of [p1, p2]) {
        const joinVisible = await p.locator('#join-overlay').isVisible();
        if (!joinVisible) {
          await resetAndGiveUp(p);
        }
      }
      await ctx1.close();
      await ctx2.close();
    }
  });
});
