// Browser integration tests: pawn promotion
import { test, expect } from '@playwright/test';
import { joinGame, makeMove2d, waitForMoveLog, importFen, createPlayerPages } from './helpers.js';

test.describe.serial('Promotion', () => {
  // All tests use createPlayerPages, so no shared page cleanup needed
  test('Promote to queen', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await createPlayerPages(browser, {
      baseURL: 'http://localhost:3000',
      viewport: { width: 1280, height: 720 },
    });

    try {
      await joinGame(p1, 'white');
      await joinGame(p2, 'black');

      // Import FEN with white pawn on e7 ready to promote (king on g8, not blocking e8)
      await importFen(p1, '6k1/4P3/8/8/8/8/8/4K3 w - - 0 1');

      // Ensure 2D board is visible
      const overlay = p1.locator('#board-2d-overlay');
      if (!(await overlay.isVisible())) {
        await p1.locator('#btn-board-2d-desktop').click();
        await expect(overlay).toBeVisible({ timeout: 5000 });
      }
      // Wait for pieces to render
      await expect(p1.locator('#board-2d-overlay .board2d-piece').first()).toBeVisible({
        timeout: 5000,
      });
      // Verify source square exists
      await expect(p1.locator('#board-2d-overlay [data-file="4"][data-rank="6"]')).toBeVisible({
        timeout: 5000,
      });

      // Make the promotion move
      await makeMove2d(p1, 4, 6, 4, 7);

      // Wait for promotion overlay
      await expect(p1.locator('#promo-overlay')).toBeVisible({ timeout: 10000 });

      // Click queen button
      await p1.locator('#promo-choices [data-type="queen"]').click();

      // Board shows queen on e8
      const e8Square = p1.locator('#board-2d-overlay [data-file="4"][data-rank="7"]');
      await expect(e8Square.locator('.board2d-piece')).toBeVisible({ timeout: 5000 });

      // Move log contains "e8=Q"
      await waitForMoveLog(p1, 'e8=Q');
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test('Promote to knight', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await createPlayerPages(browser, {
      baseURL: 'http://localhost:3000',
      viewport: { width: 1280, height: 720 },
    });

    try {
      await joinGame(p1, 'white');
      await joinGame(p2, 'black');

      // Import FEN with white pawn on e7 ready to promote (king on g8, not blocking e8)
      await importFen(p1, '6k1/4P3/8/8/8/8/8/4K3 w - - 0 1');

      // Make the promotion move
      await makeMove2d(p1, 4, 6, 4, 7);

      // Wait for promotion overlay
      await expect(p1.locator('#promo-overlay')).toBeVisible({ timeout: 10000 });

      // Click knight button
      await p1.locator('#promo-choices [data-type="knight"]').click();

      // Board shows knight on e8
      const e8Square = p1.locator('#board-2d-overlay [data-file="4"][data-rank="7"]');
      await expect(e8Square.locator('.board2d-piece')).toBeVisible({ timeout: 5000 });

      // Move log contains "e8=N" (standard SAN for knight)
      await waitForMoveLog(p1, 'e8=N');
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });
});
