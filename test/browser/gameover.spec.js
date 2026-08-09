// Browser integration tests: game over conditions
import { test, expect } from '@playwright/test';
import {
  joinGame,
  makeMove2d,
  importFen,
  createPlayerPages,
  concede,
  offerDraw,
  acceptDraw,
  resetAndGiveUp,
} from './helpers.js';

test.describe.serial('Game over', () => {
  async function cleanup(ctx1, ctx2) {
    const p1 = ctx1.pages()[0] ?? null;
    const p2 = ctx2.pages()[0] ?? null;
    if (p1) await resetAndGiveUp(p1).catch(() => {});
    if (p2) await resetAndGiveUp(p2).catch(() => {});
    try {
      await ctx1.close();
    } catch {}
    try {
      await ctx2.close();
    } catch {}
  }

  test('Checkmate ends game', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await createPlayerPages(browser, {
      baseURL: 'http://localhost:3000',
      viewport: { width: 1280, height: 720 },
    });

    try {
      await joinGame(p1, 'white');
      await joinGame(p2, 'black');

      // FEN: f7-f8=Q is checkmate (king on h8; white king on g6 covers h7)
      await importFen(p1, '7k/5P2/6K1/8/8/8/8/8 w - - 0 1');

      // Move pawn: f7 → f8
      await makeMove2d(p1, 5, 6, 5, 7);

      // Handle promotion — click queen
      await expect(p1.locator('#promo-overlay')).toBeVisible({ timeout: 10000 });
      await p1.locator('#promo-choices [data-type="queen"]').click();

      // Game over overlay appears with checkmate text
      await expect(p1.locator('#game-over-overlay')).toBeVisible({ timeout: 10000 });
      await expect(p1.locator('#game-over-text')).toContainText('Checkmate');

      // Black also sees game over
      await expect(p2.locator('#game-over-overlay')).toBeVisible({ timeout: 10000 });
    } finally {
      await cleanup(ctx1, ctx2);
    }
  });

  test('Stalemate shows draw', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await createPlayerPages(browser, {
      baseURL: 'http://localhost:3000',
      viewport: { width: 1280, height: 720 },
    });

    try {
      await joinGame(p1, 'white');
      await joinGame(p2, 'black');

      // FEN: after Kc7-b6, a7/b7 covered by king, b8 covered by knight → stalemate
      await importFen(p1, 'k7/2K5/2N5/8/8/8/8/8 w - - 0 1');

      // Move white king: c7 → b6 (file 2, rank 6 → file 1, rank 5)
      await makeMove2d(p1, 2, 6, 1, 5);

      // Game over overlay appears with stalemate text
      await expect(p1.locator('#game-over-overlay')).toBeVisible({ timeout: 10000 });
      const gameOverText = await p1.locator('#game-over-text').textContent();
      expect(gameOverText.toLowerCase()).toContain('stalemate');
    } finally {
      await cleanup(ctx1, ctx2);
    }
  });

  test('Concede flow', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await createPlayerPages(browser, {
      baseURL: 'http://localhost:3000',
      viewport: { width: 1280, height: 720 },
    });

    try {
      await joinGame(p1, 'white');
      await joinGame(p2, 'black');

      // White concedes
      await concede(p1);

      // Black sees game over overlay about white conceding
      await expect(p2.locator('#game-over-overlay')).toBeVisible({ timeout: 10000 });
      await expect(p2.locator('#game-over-text')).toContainText('conceded');
    } finally {
      await cleanup(ctx1, ctx2);
    }
  });

  test('Draw by agreement', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await createPlayerPages(browser, {
      baseURL: 'http://localhost:3000',
      viewport: { width: 1280, height: 720 },
    });

    try {
      await joinGame(p1, 'white');
      await joinGame(p2, 'black');

      // White offers draw
      await offerDraw(p1);

      // Black accepts draw
      await acceptDraw(p2);

      // Both pages show game over overlay with draw text
      await expect(p1.locator('#game-over-overlay')).toBeVisible({ timeout: 10000 });
      await expect(p2.locator('#game-over-overlay')).toBeVisible({ timeout: 10000 });

      const text1 = await p1.locator('#game-over-text').textContent();
      const text2 = await p2.locator('#game-over-text').textContent();
      expect(text1.toLowerCase()).toContain('draw');
      expect(text2.toLowerCase()).toContain('draw');
    } finally {
      await cleanup(ctx1, ctx2);
    }
  });
});
