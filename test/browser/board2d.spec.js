// Browser integration tests: 2D board
import { test, expect } from '@playwright/test';
import {
  joinGame,
  makeMove2d,
  waitForMoveLog,
  resetAndGiveUp,
  createPlayerPages,
} from './helpers.js';

test.describe.serial('2D Board', () => {
  let testManagesOwnPages = false;

  test.afterEach(async ({ page }) => {
    if (testManagesOwnPages) return;
    const joinVisible = await page
      .locator('#join-overlay')
      .isVisible()
      .catch(() => false);
    if (!joinVisible) {
      await resetAndGiveUp(page);
    }
  });

  test('2D board toggles and shows pieces', async ({ page }) => {
    await page.goto('/');
    await joinGame(page, 'white');

    // Toggle 2D board on
    const toggle = page.locator('#btn-board-2d:visible, #btn-board-2d-desktop:visible').first();
    await toggle.click();
    await expect(page.locator('#board-2d-overlay')).toBeVisible({ timeout: 5000 });

    // Verify coordinate labels are visible on all 4 edges
    const fileLabelsBottom = page.locator('#board-2d-overlay .board2d-file-labels');
    const fileLabelsTop = page.locator('#board-2d-overlay .board2d-file-labels-top');
    await expect(fileLabelsBottom.locator('.board2d-file-label')).toHaveCount(10);
    await expect(fileLabelsTop.locator('.board2d-file-label')).toHaveCount(10);
    expect(await fileLabelsBottom.locator('.board2d-file-label').allTextContents()).toEqual([
      '',
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
      'g',
      'h',
      '',
    ]);
    expect(await fileLabelsTop.locator('.board2d-file-label').allTextContents()).toEqual([
      '',
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
      'g',
      'h',
      '',
    ]);
    const rankLabelsLeft = page.locator('#board-2d-overlay .board2d-rank-labels');
    const rankLabelsRight = page.locator('#board-2d-overlay .board2d-rank-labels-right');
    await expect(rankLabelsLeft.locator('.board2d-rank-label')).toHaveCount(8);
    await expect(rankLabelsRight.locator('.board2d-rank-label')).toHaveCount(8);
    expect(await rankLabelsLeft.locator('.board2d-rank-label').allTextContents()).toEqual([
      '8',
      '7',
      '6',
      '5',
      '4',
      '3',
      '2',
      '1',
    ]);
    expect(await rankLabelsRight.locator('.board2d-rank-label').allTextContents()).toEqual([
      '8',
      '7',
      '6',
      '5',
      '4',
      '3',
      '2',
      '1',
    ]);

    // Verify a white pawn exists on e2 (file=4, rank=1)
    const e2Square = page.locator('#board-2d-overlay [data-file="4"][data-rank="1"]');
    await expect(e2Square.locator('.board2d-piece')).toBeVisible({ timeout: 5000 });
    const e2PieceSrc = await e2Square.locator('.board2d-piece').getAttribute('src');
    expect(e2PieceSrc).toContain('wP');

    // Verify a black pawn exists on e7 (file=4, rank=6)
    const e7Square = page.locator('#board-2d-overlay [data-file="4"][data-rank="6"]');
    await expect(e7Square.locator('.board2d-piece')).toBeVisible({ timeout: 5000 });
    const e7PieceSrc = await e7Square.locator('.board2d-piece').getAttribute('src');
    expect(e7PieceSrc).toContain('bP');
  });

  test('Make move via 2D board', async ({ browser }) => {
    testManagesOwnPages = true;
    const { p1, p2, ctx1, ctx2 } = await createPlayerPages(browser, {
      baseURL: 'http://localhost:3000',
      viewport: { width: 1280, height: 720 },
    });

    try {
      await joinGame(p1, 'white');
      await joinGame(p2, 'black');

      // White makes e4 via 2D board (fromFile=4, fromRank=1, toFile=4, toRank=3)
      await makeMove2d(p1, 4, 1, 4, 3);

      // Verify move appears in move log on both pages
      await waitForMoveLog(p1, 'e4');
      await waitForMoveLog(p2, 'e4');

      // Verify 3D board also updates: poll until white pawn mesh is at e4 and absent from e2
      await p1.waitForFunction(
        () => {
          const positions = window.__testPiecePositions?.() ?? [];
          return (
            positions.some(
              (p) =>
                p.file === 4 &&
                p.rank === 3 &&
                p.type === 'pawn' &&
                p.color === 'white' &&
                Math.abs(p.x - 0.5) < 0.01 &&
                Math.abs(p.z - 0.5) < 0.01
            ) &&
            !positions.some(
              (p) => p.file === 4 && p.rank === 1 && p.type === 'pawn' && p.color === 'white'
            )
          );
        },
        {},
        { timeout: 10000 }
      );

      // Verify 2D overlay reflects the move: pawn no longer on e2
      const e2Square = p1.locator('#board-2d-overlay [data-file="4"][data-rank="1"]');
      const pieceOnE2 = e2Square.locator('.board2d-piece');
      await expect(pieceOnE2).not.toBeVisible({ timeout: 5000 });

      // Pawn should now be on e4
      const e4Square = p1.locator('#board-2d-overlay [data-file="4"][data-rank="3"]');
      await expect(e4Square.locator('.board2d-piece')).toBeVisible({ timeout: 5000 });
      const e4PieceSrc = await e4Square.locator('.board2d-piece').getAttribute('src');
      expect(e4PieceSrc).toContain('wP');
    } finally {
      // Clean up both pages
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
    }
  });
});
