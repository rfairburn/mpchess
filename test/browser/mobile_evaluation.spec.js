// Browser integration tests: evaluation bar (mobile)
//
// These tests only run under the chromium-mobile project (testMatch in
// playwright.config.js). The default mobile viewport (844x390) is
// landscape → vertical bar on the left edge. A dedicated portrait test
// (390x844 context) validates the wide horizontal bar at the bottom,
// which must clear the camera position buttons.

import { test, expect } from '@playwright/test';
import { joinGame, resetAndGiveUp, makeMove2d, waitForMoveLog } from './helpers.js';

// boundingBox() can transiently return null right after page load while
// the layout settles — poll until the element has a real box.
async function waitForBox(page, selector) {
  let box = null;
  await expect
    .poll(
      async () => {
        box = await page.locator(selector).boundingBox();
        return box !== null;
      },
      { timeout: 10000 }
    )
    .toBe(true);
  return box;
}

test.describe.serial('Evaluation bar (mobile)', () => {
  test.afterEach(async ({ page }) => {
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

  test('Landscape: vertical bar on the left edge, desktop bar hidden', async ({ page }) => {
    await page.goto('/');

    // Wait for the top bar to be attached
    await page.waitForSelector('#top-bar', { state: 'attached', timeout: 10000 });

    // On the mobile landscape viewport (844x390, coarse pointer, short
    // height) the mobile evaluation bar must be visible.
    const mobileDisplay = await page.evaluate(() => {
      const el = document.getElementById('eval-bar-mobile');
      return el ? getComputedStyle(el).display : 'missing';
    });
    expect(mobileDisplay).toBe('flex');

    // It is a vertical bar anchored to the left edge, vertically centered
    const box = await waitForBox(page, '#eval-bar-mobile-track');
    expect(box.x).toBeLessThan(40);
    expect(box.height).toBeGreaterThan(box.width);
    const centerY = await page.evaluate(() => window.innerHeight / 2);
    expect(Math.abs(box.y + box.height / 2 - centerY)).toBeLessThan(40);

    // Desktop evaluation bar (inside #desktop-hud) must be hidden
    const desktopDisplay = await page.evaluate(() => {
      const el = document.getElementById('eval-bar');
      return el ? getComputedStyle(el).display : 'missing';
    });
    expect(desktopDisplay).toBe('none');

    // The server evaluates the starting position on demand, so the label
    // goes from "–" to a real score without any move being played.
    await expect(page.locator('#eval-score-mobile')).not.toHaveText('–', { timeout: 30000 });
    const score = await page.locator('#eval-score-mobile').textContent();
    expect(score).toMatch(/^[+-]?\d+\.\d{2}$/);
  });

  test('Landscape: bar updates after a move', async ({ page }) => {
    await page.goto('/');

    // Join as white
    await joinGame(page, 'white');

    // White plays 1.f3 — an objectively weakening move, so the evaluation
    // swings from the slightly-positive starting position to negative.
    await makeMove2d(page, 5, 1, 5, 2); // f2 → f3
    await waitForMoveLog(page, 'f3');

    // The engine re-evaluates the new position and the score turns negative.
    await expect(page.locator('#eval-score-mobile')).toHaveText(/^-/, { timeout: 30000 });
    const score = await page.locator('#eval-score-mobile').textContent();
    expect(score).toMatch(/^-\d+\.\d{2}$/);

    // Bar fill (--eval-pct) is a valid percentage below 50% (black is better)
    const fillPct = await page
      .locator('#eval-bar-mobile-track')
      .evaluate((el) => parseFloat(el.style.getPropertyValue('--eval-pct')));
    expect(fillPct).toBeGreaterThanOrEqual(0);
    expect(fillPct).toBeLessThan(50);
  });

  test('Portrait: horizontal bar at the bottom, above the camera buttons', async ({ browser }) => {
    const ctx = await browser.newContext({
      baseURL: 'http://localhost:3000',
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    await page.goto('/');
    await page.waitForSelector('#top-bar', { state: 'attached', timeout: 10000 });

    // Portrait mobile: the wide horizontal bar is visible
    const mobileDisplay = await page.evaluate(() => {
      const el = document.getElementById('eval-bar-mobile');
      return el ? getComputedStyle(el).display : 'missing';
    });
    expect(mobileDisplay).toBe('flex');

    // It is horizontal (wider than tall) and centered at the bottom
    const box = await waitForBox(page, '#eval-bar-mobile-track');
    expect(box.width).toBeGreaterThan(box.height);
    const centerX = await page.evaluate(() => window.innerWidth / 2);
    expect(Math.abs(box.x + box.width / 2 - centerX)).toBeLessThan(20);

    // It clears the camera position buttons (44px tall, 8px from the bottom)
    const camBox = await waitForBox(page, '#camera-positions');
    expect(box.y + box.height).toBeLessThanOrEqual(camBox.y);

    // The bar updates after a move
    await joinGame(page, 'white');
    await makeMove2d(page, 5, 1, 5, 2); // f2 → f3
    await waitForMoveLog(page, 'f3');
    await expect(page.locator('#eval-score-mobile')).toHaveText(/^-/, { timeout: 30000 });

    await ctx.close();
  });
});
