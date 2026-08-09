// Browser integration tests: right-click annotations (arrows & highlights)
import { test, expect } from '@playwright/test';
import { joinGame, resetAndGiveUp } from './helpers.js';

test.describe.serial('Annotations', () => {
  test.afterEach(async ({ page }) => {
    const joinVisible = await page
      .locator('#join-overlay')
      .isVisible()
      .catch(() => false);
    if (!joinVisible) {
      await resetAndGiveUp(page);
    }
  });

  test('Draw arrow between squares', async ({ page }) => {
    await page.goto('/');
    await joinGame(page, 'white');

    // Suppress the browser context menu
    await page.evaluate(() => {
      window.addEventListener('contextmenu', (e) => e.preventDefault(), { capture: true });
    });

    // Ensure 2D board is visible
    const toggle = page.locator('#btn-board-2d:visible, #btn-board-2d-desktop:visible').first();
    await toggle.click();
    await expect(page.locator('#board-2d-overlay')).toBeVisible({ timeout: 5000 });

    // Get coordinates for source (e2) and destination (e4) squares
    const sourceBox = await page.locator('[data-file="4"][data-rank="1"]').boundingBox();
    const destBox = await page.locator('[data-file="4"][data-rank="3"]').boundingBox();

    const sourceX = sourceBox.x + sourceBox.width / 2;
    const sourceY = sourceBox.y + sourceBox.height / 2;
    const destX = destBox.x + destBox.width / 2;
    const destY = destBox.y + destBox.height / 2;

    // Right-button drag from source to destination
    await page.mouse.move(sourceX, sourceY);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(destX, destY);
    await page.mouse.up({ button: 'right' });

    // Verify an arrow appears in the 2D board SVG overlay
    const arrowSvg = page.locator('#board-2d-container svg');
    await expect(arrowSvg).toBeVisible({ timeout: 5000 });

    // The SVG should contain at least one path (arrow body)
    const arrowPath = arrowSvg.locator('path');
    await expect(arrowPath).toHaveCount(1, { timeout: 5000 });
  });

  test('Highlight a square', async ({ page }) => {
    await page.goto('/');
    await joinGame(page, 'white');

    // Suppress the browser context menu
    await page.evaluate(() => {
      window.addEventListener('contextmenu', (e) => e.preventDefault(), { capture: true });
    });

    // Ensure 2D board is visible
    const toggle = page.locator('#btn-board-2d:visible, #btn-board-2d-desktop:visible').first();
    await toggle.click();
    await expect(page.locator('#board-2d-overlay')).toBeVisible({ timeout: 5000 });

    // Get coordinates for e4 square
    const squareBox = await page.locator('[data-file="4"][data-rank="3"]').boundingBox();
    const squareX = squareBox.x + squareBox.width / 2;
    const squareY = squareBox.y + squareBox.height / 2;

    // Right-click the square (no drag)
    await page.mouse.click(squareX, squareY, { button: 'right' });

    // Verify a highlight appears on the square
    const highlight = page.locator('[data-file="4"][data-rank="3"] .board2d-highlight');
    await expect(highlight).toBeVisible({ timeout: 5000 });
  });
});
