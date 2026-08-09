// Browser integration tests: spectator mode
import { test, expect } from '@playwright/test';
import {
  joinGame,
  makeMove2d,
  waitForMoveLog,
  openMenu,
  createPlayerPages,
  resetAndGiveUp,
} from './helpers.js';

test.describe.serial('Spectator mode', () => {
  // Track all custom pages and contexts for centralized teardown
  let cleanupPages = [];
  let cleanupContexts = [];

  const track = (pages, contexts) => {
    cleanupPages.push(...pages);
    cleanupContexts.push(...contexts);
  };

  test.afterEach(async () => {
    const pages = cleanupPages;
    const contexts = cleanupContexts;
    cleanupPages = [];
    cleanupContexts = [];

    // Release seats for any seated players
    for (const page of pages) {
      const role = await page
        .locator('#role-badge')
        .getAttribute('class')
        .catch(() => null);
      const joinVisible = await page
        .locator('#join-overlay')
        .isVisible()
        .catch(() => true);
      if (!joinVisible && ['white', 'black'].includes(role)) {
        await resetAndGiveUp(page).catch(() => {});
      }
    }
    // Close all tracked contexts, handling already-closed contexts safely
    await Promise.all(contexts.map((ctx) => ctx.close().catch(() => {})));
  });

  test('Spectator sees moves in real-time', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await createPlayerPages(browser, {
      baseURL: 'http://localhost:3000',
      viewport: { width: 1280, height: 720 },
    });
    track([p1, p2], [ctx1, ctx2]);

    // Third page for spectator
    const ctx3 = await browser.newContext({
      baseURL: 'http://localhost:3000',
      viewport: { width: 1280, height: 720 },
    });
    track([], [ctx3]);
    const p3 = await ctx3.newPage();
    track([p3], []);
    await p3.goto('/');

    await joinGame(p1, 'white');
    await joinGame(p2, 'black');
    await joinGame(p3, 'spectator');

    // Verify spectator role
    await expect(p3.locator('#role-badge')).toContainText('Spectator');

    // White makes e4
    await makeMove2d(p1, 4, 1, 4, 3);

    // Spectator sees the move in the move log
    await waitForMoveLog(p3, 'e4');
  });

  test('Spectator takes free seat via menu', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await createPlayerPages(browser, {
      baseURL: 'http://localhost:3000',
      viewport: { width: 1280, height: 720 },
    });
    track([p1, p2], [ctx1, ctx2]);

    // p1 joins as white
    await joinGame(p1, 'white');
    // p2 joins as spectator
    await joinGame(p2, 'spectator');

    // Spectator opens menu and clicks "Reconnect as Player"
    await openMenu(p2);
    await p2.locator('#btn-reconnect-as-player').click();

    // Join overlay should now be visible
    await expect(p2.locator('#join-overlay')).toBeVisible({ timeout: 5000 });

    // Click "Join as Black"
    const btnJoinBlack = p2.locator('#btn-join-black');
    await expect(btnJoinBlack).toBeEnabled({ timeout: 10000 });
    await btnJoinBlack.click();

    // Join overlay should close
    await expect(p2.locator('#join-overlay')).not.toBeVisible({ timeout: 10000 });

    // Role badge should show Black
    await expect(p2.locator('#role-badge')).toContainText('Black');
  });

  test('Spectator takes seat after both players disconnect', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await createPlayerPages(browser, {
      baseURL: 'http://localhost:3000',
      viewport: { width: 1280, height: 720 },
    });
    track([p1, p2], [ctx1, ctx2]);

    // Third page for spectator
    const ctx3 = await browser.newContext({
      baseURL: 'http://localhost:3000',
      viewport: { width: 1280, height: 720 },
    });
    track([], [ctx3]);
    const p3 = await ctx3.newPage();
    track([p3], []);
    await p3.goto('/');

    // White and black join
    await joinGame(p1, 'white');
    await joinGame(p2, 'black');
    // Spectator joins
    await joinGame(p3, 'spectator');

    // Both players disconnect (close contexts to simulate actual disconnects)
    // This triggers the server-side seat timeout timer
    await ctx1.close();
    await ctx2.close();

    // Wait for seat timeout (5s in tests) so the game-available banner appears
    // The server sends gameAvailable after the seat timeout expires
    await expect(p3.locator('#game-available-banner')).toBeVisible({ timeout: 10000 });

    // Click "Join Game" — this removes tokens and reloads the page
    await p3.locator('#btn-join-game').click();

    // After reload, wait for join overlay
    await expect(p3.locator('#join-overlay')).toBeVisible({ timeout: 10000 });

    // Select an available seat (white should be available)
    const btnJoinWhite = p3.locator('#btn-join-white');
    await expect(btnJoinWhite).toBeEnabled({ timeout: 10000 });
    await btnJoinWhite.click();

    // Join overlay should close
    await expect(p3.locator('#join-overlay')).not.toBeVisible({ timeout: 10000 });

    // Verify spectator is now a player
    await expect(p3.locator('#role-badge')).toContainText('White');
  });
});
