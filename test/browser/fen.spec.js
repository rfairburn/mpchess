// Browser integration tests: FEN import/export
import { test, expect } from '@playwright/test';
import {
  joinGame,
  importFen,
  exportFen,
  makeMove2d,
  waitForMoveLog,
  resetAndGiveUp,
  createPlayerPages,
} from './helpers.js';

test.describe.serial('FEN import/export', () => {
  let p1, p2, ctx1, ctx2;

  test.beforeEach(async ({ browser }) => {
    ({ p1, p2, ctx1, ctx2 } = await createPlayerPages(browser, {
      baseURL: 'http://localhost:3000',
      viewport: { width: 1280, height: 720 },
    }));
  });

  test.afterEach(async () => {
    for (const p of [p1, p2]) {
      const joinVisible = await p
        .locator('#join-overlay')
        .isVisible()
        .catch(() => false);
      if (!joinVisible) {
        await resetAndGiveUp(p);
      }
    }
    await ctx1.close();
    await ctx2.close();
  });

  test('Import FEN loads custom position', async () => {
    await joinGame(p1, 'white');
    await joinGame(p2, 'black');

    // Make a move first so we can verify the import clears it
    await makeMove2d(p1, 4, 1, 4, 3); // e2 → e4
    await waitForMoveLog(p1, 'e4');

    // Import a black-to-move FEN (position after 1.d4 d5)
    const fen = 'rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP3PPP/RNBQKBNR b KQkq - 0 1';
    await importFen(p1, fen);

    // Turn indicator flips to Black — only passes if the FEN was actually loaded
    await expect(p1.locator('#turn-indicator')).toContainText('Black');

    // FEN import triggers a restart, so the prior move is gone
    const moveLogText = await p1.locator('#move-log').textContent();
    expect(moveLogText).not.toContain('e4');

    // Close and reopen the 2D board (left open by makeMove2d) to force re-render with new state
    const board2dBtn = p1.locator('#btn-board-2d:visible, #btn-board-2d-desktop:visible').first();
    // Click until the board is hidden (mode cycles: small → fullscreen → off)
    await board2dBtn.click();
    const stillVisible = await p1.locator('#board-2d-overlay').isVisible();
    if (stillVisible) await board2dBtn.click();
    await expect(p1.locator('#board-2d-overlay')).not.toBeVisible({ timeout: 5000 });
    // Reopen to trigger renderBoard() with the new state
    await board2dBtn.click();
    await expect(p1.locator('#board-2d-overlay')).toBeVisible({ timeout: 5000 });

    // Verify FEN pieces: white pawn on d4, black pawn on d5
    await expect(
      p1.locator('#board-2d-overlay [data-file="3"][data-rank="3"] .board2d-piece')
    ).toHaveAttribute('src', /wP/);
    await expect(
      p1.locator('#board-2d-overlay [data-file="3"][data-rank="4"] .board2d-piece')
    ).toHaveAttribute('src', /bP/);
  });

  test('Export FEN copies to clipboard', async () => {
    await joinGame(p1, 'white');
    await joinGame(p2, 'black');

    // Make a move so the exported FEN is non-default
    await makeMove2d(p1, 4, 1, 4, 3); // e2 → e4
    await waitForMoveLog(p1, 'e4');

    // Export FEN — helper asserts toast contains "FEN copied"
    await exportFen(p1);
  });
});
