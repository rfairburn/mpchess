// Browser integration tests: making moves
import { test, expect } from '@playwright/test';
import {
  joinGame,
  giveUpSpot,
  makeMove2d,
  waitForMoveLog,
  importFen,
  resetAndGiveUp,
  createPlayerPages,
  openMenu,
} from './helpers.js';

test.describe.serial('Moves', () => {
  // Track whether the current test manages its own pages
  let testManagesOwnPages = false;

  test.afterEach(async ({ page }) => {
    if (testManagesOwnPages) return;
    // Only give up seat if we have one, without resetting game state
    const role = await page
      .locator('#role-badge')
      .getAttribute('class')
      .catch(() => '');
    if (['white', 'black'].includes(role)) {
      const joinVisible = await page
        .locator('#join-overlay')
        .isVisible()
        .catch(() => false);
      if (!joinVisible) {
        await giveUpSpot(page);
      }
    }
  });

  test('White makes e4 opening move', async ({ page }) => {
    await page.goto('/');
    await joinGame(page, 'white');

    await makeMove2d(page, 4, 1, 4, 3); // e2 → e4
    await waitForMoveLog(page, 'e4');

    // Turn indicator shows black's turn
    await expect(page.locator('#turn-indicator')).toContainText('Black');
  });

  test('Black responds e5', async ({ page }) => {
    // Navigate fresh — serial state keeps the server game alive
    await page.goto('/');
    await joinGame(page, 'black');

    await makeMove2d(page, 4, 6, 4, 4); // e7 → e5
    await waitForMoveLog(page, 'e5');

    // Move log shows "1. e4 e5"
    await expect(page.locator('#move-log')).toContainText('1. e4 e5');
  });

  test('Invalid move rejected', async ({ page }) => {
    // Navigate fresh and join as white
    await page.goto('/');
    await joinGame(page, 'white');

    // Try moving a rook diagonally: a1 → b2 (rook can't go diagonal)
    await makeMove2d(page, 0, 0, 1, 1);

    // Move log should still show only "1. e4 e5" — no new move
    await expect(page.locator('#move-log')).toContainText('1. e4 e5');
    // Ensure no new move number appeared
    const logText = await page.locator('#move-log').textContent();
    expect(logText).not.toContain('2.');
  });

  test('Capture removes opponent piece', async ({ browser }) => {
    testManagesOwnPages = true;
    // Use two pages for a capture test
    const { p1, p2, ctx1, ctx2 } = await createPlayerPages(browser, {
      baseURL: 'http://localhost:3000',
      viewport: { width: 1280, height: 720 },
    });

    try {
      await joinGame(p1, 'white');
      await joinGame(p2, 'black');

      // Import FEN on white's page: black to move, can play dxc4
      await importFen(p1, 'rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP3PPP/RNBQKBNR b KQkq - 0 1');

      // Black makes the capture: d5 → c4 (file 3, rank 4 → file 2, rank 3)
      await makeMove2d(p2, 3, 4, 2, 3);

      // Move log contains "dxc4"
      await waitForMoveLog(p2, 'dxc4');

      // The white pawn on c4 should be gone — replaced by black pawn
      const capturedSquare = p2.locator('#board-2d-overlay [data-file="2"][data-rank="3"]');
      const pieceSrc = await capturedSquare
        .locator('.board2d-piece')
        .getAttribute('src')
        .catch(() => null);
      expect(pieceSrc).not.toContain('wP');
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });
});
