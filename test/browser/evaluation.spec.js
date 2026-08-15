// Browser integration tests: evaluation bar (desktop)
//
// Validates that the desktop evaluation bar renders and updates with a
// live Stockfish evaluation after a move (real engine, real server).

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

test.describe.serial('Evaluation bar (desktop)', () => {
  let page = null;
  let ctx = null;

  test.afterEach(async () => {
    if (page) {
      const joinVisible = await page
        .locator('#join-overlay')
        .isVisible()
        .catch(() => false);
      if (!joinVisible) {
        await resetAndGiveUp(page);
      }
    }
    if (ctx) await ctx.close();
    page = ctx = null;
  });

  test('Evaluation bar visible and shows the initial position evaluation', async ({ browser }) => {
    ctx = await browser.newContext({ baseURL: 'http://localhost:3000' });
    page = await ctx.newPage();
    await page.goto('/');

    // Desktop bar is visible
    await expect(page.locator('#eval-bar')).toBeVisible({ timeout: 10000 });

    // The server evaluates the starting position on demand, so the label
    // goes from "–" to a real score without any move being played.
    await expect(page.locator('#eval-score')).not.toHaveText('–', { timeout: 30000 });
    const score = await page.locator('#eval-score').textContent();
    expect(score).toMatch(/^[+-]?\d+\.\d{2}$/);

    // Bar fill is a valid percentage between 0% and 100%
    const fillHeight = await page
      .locator('#eval-bar-fill')
      .evaluate((el) => parseFloat(el.style.height));
    expect(fillHeight).toBeGreaterThanOrEqual(0);
    expect(fillHeight).toBeLessThanOrEqual(100);

    // The bar's top stays below the black captures box (left-rail layout)
    const barBox = await waitForBox(page, '#eval-bar-track');
    const capBox = await waitForBox(page, '#captured-black');
    expect(barBox.y).toBeGreaterThan(capBox.y + capBox.height);

    // The track is horizontally centered over the score label (both use
    // border-box sizing: 16px track, 52px label → 18px left margin).
    const scoreBox = await waitForBox(page, '#eval-score');
    const trackCenterX = barBox.x + barBox.width / 2;
    const scoreCenterX = scoreBox.x + scoreBox.width / 2;
    expect(Math.abs(trackCenterX - scoreCenterX)).toBeLessThanOrEqual(1);
  });

  test('Evaluation bar updates after a move', async ({ browser }) => {
    ctx = await browser.newContext({ baseURL: 'http://localhost:3000' });
    page = await ctx.newPage();
    await page.goto('/');

    // Join as white
    await joinGame(page, 'white');

    // White plays 1.f3 — an objectively weakening move, so the evaluation
    // swings from the slightly-positive starting position to negative.
    await makeMove2d(page, 5, 1, 5, 2); // f2 → f3
    await waitForMoveLog(page, 'f3');

    // The engine re-evaluates the new position and the score turns negative.
    await expect(page.locator('#eval-score')).toHaveText(/^-/, { timeout: 30000 });
    const score = await page.locator('#eval-score').textContent();
    expect(score).toMatch(/^-\d+\.\d{2}$/);

    // Bar fill is a valid percentage, below 50% (black is better)
    const fillHeight = await page
      .locator('#eval-bar-fill')
      .evaluate((el) => parseFloat(el.style.height));
    expect(fillHeight).toBeGreaterThanOrEqual(0);
    expect(fillHeight).toBeLessThan(50);

    // Mobile bar must be hidden on desktop
    const mobileDisplay = await page.evaluate(() => {
      const el = document.getElementById('eval-bar-mobile');
      return el ? getComputedStyle(el).display : 'missing';
    });
    expect(mobileDisplay).toBe('none');
  });

  test('Evaluation bar resets to neutral when the game ends', async ({ browser }) => {
    ctx = await browser.newContext({ baseURL: 'http://localhost:3000' });
    page = await ctx.newPage();
    await page.goto('/');

    await joinGame(page, 'white');
    await makeMove2d(page, 4, 1, 4, 3); // e2 → e4
    await waitForMoveLog(page, 'e4');
    await expect(page.locator('#eval-score')).not.toHaveText('–', { timeout: 30000 });

    // Concede via menu (game over → evaluation resets and stays null)
    await page.locator('#btn-menu-toggle-desktop').click();
    await page.locator('#btn-concede').click();
    await expect(page.locator('#concede-overlay')).toBeVisible({ timeout: 5000 });
    await page.locator('#btn-concede-confirm').click();

    // Game-over overlay appears and the bar resets to neutral
    await expect(page.locator('#game-over-overlay')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#eval-score')).toHaveText('–', { timeout: 10000 });
    const fillHeight = await page.locator('#eval-bar-fill').evaluate((el) => el.style.height);
    expect(fillHeight).toBe('50%');
  });
});
