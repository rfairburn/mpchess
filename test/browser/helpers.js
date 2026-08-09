import { expect } from '@playwright/test';

/**
 * Join a game as white, black, or spectator.
 * Waits for the join button to be enabled, clicks it, and waits for the join overlay to close.
 * Handles held seats from previous test contexts by retrying after a page reload.
 */
export async function joinGame(page, role) {
  const buttonId = `#btn-join-${role}`;
  const btn = page.locator(buttonId);

  // If the page is already seated from a previous test context, the join
  // overlay won't be visible. Free the seat first so we can rejoin cleanly.
  const joinOverlayVisible = await page
    .locator('#join-overlay')
    .isVisible()
    .catch(() => false);
  if (!joinOverlayVisible) {
    await resetAndGiveUp(page);
  }

  // Ensure the join overlay is visible (page is connected to server)
  await expect(page.locator('#join-overlay')).toBeVisible({ timeout: 10000 });

  // Wait for the button to be enabled. If the seat is held from a previous
  // test context, the server releases held seats after seatTimeout (5s in tests)
  // when both players are disconnected. Retry with a reload if the button
  // stays disabled to refresh stale client-side seat status.
  let enabled = await btn.isEnabled({ timeout: 1000 }).catch(() => false);
  if (!enabled) {
    await page.reload();
    await expect(page.locator('#join-overlay')).toBeVisible({ timeout: 10000 });
  }

  // Wait for button to be enabled. Use 30s timeout to handle stale server
  // seats from a reused Playwright webServer (seatTimeout is 5s, so 30s
  // is more than enough for any stale seat to expire).
  await expect(btn).toBeEnabled({ timeout: 30000 });
  await btn.click();
  await expect(page.locator('#join-overlay')).not.toBeVisible({ timeout: 10000 });
}

/**
 * Give up the current seat via the menu flow.
 * Opens menu, clicks give up, confirms, waits for join overlay to reappear.
 */
export async function giveUpSpot(page) {
  await openMenu(page);
  await page.locator('#btn-give-up-spot').click();
  await expect(page.locator('#give-up-spot-overlay')).toBeVisible({ timeout: 5000 });
  await page.locator('#btn-give-up-spot-confirm').click();
  await expect(page.locator('#join-overlay')).toBeVisible({ timeout: 5000 });
}

/**
 * Make a move via the 2D board.
 * Coordinates are 0-indexed (0=a, 0=rank1).
 * Ensures 2D board is visible, clicks source square, waits for selection, clicks destination.
 */
export async function makeMove2d(page, fromFile, fromRank, toFile, toRank) {
  // Ensure 2D board is visible
  const overlay = page.locator('#board-2d-overlay');
  if ((await overlay.isVisible()) === false) {
    const toggle = page.locator('#btn-board-2d:visible, #btn-board-2d-desktop:visible').first();
    await toggle.click();
    await expect(overlay).toBeVisible({ timeout: 5000 });
  }

  // Click source square
  const fromSquare = page.locator(
    `#board-2d-overlay [data-file="${fromFile}"][data-rank="${fromRank}"]`
  );
  await fromSquare.click();
  // Wait for selection highlight
  await expect(fromSquare).toHaveClass(/selected/, { timeout: 3000 });

  // Click destination square
  const toSquare = page.locator(`#board-2d-overlay [data-file="${toFile}"][data-rank="${toRank}"]`);
  await toSquare.click();
}

/**
 * Open the main menu. Picks the visible toggle button (desktop or mobile).
 */
export async function openMenu(page) {
  const toggle = page.locator('#btn-menu-toggle:visible, #btn-menu-toggle-desktop:visible').first();
  await toggle.click();
  await expect(page.locator('#menu-overlay')).toBeVisible({ timeout: 5000 });
}

/**
 * Close the main menu via the resume button.
 */
export async function closeMenu(page) {
  await page.locator('#btn-resume').click();
  await expect(page.locator('#menu-overlay')).not.toBeVisible({ timeout: 5000 });
}

/**
 * Import a FEN position via the menu flow.
 */
export async function importFen(page, fen) {
  await openMenu(page);
  await page.locator('#btn-import-fen').click();
  await expect(page.locator('#import-fen-overlay')).toBeVisible({ timeout: 5000 });
  await page.locator('#fen-input').fill(fen);
  await page.locator('#btn-import-fen-confirm').click();
  await expect(page.locator('#import-fen-overlay')).not.toBeVisible({ timeout: 5000 });
  // Close the menu overlay which remains open after import
  const menuVisible = await page.locator('#menu-overlay').isVisible();
  if (menuVisible) {
    await closeMenu(page);
  }
}

/**
 * Wait for the move log to contain specific text.
 */
export async function waitForMoveLog(page, text, timeout = 10000) {
  await expect(page.locator('#move-log')).toContainText(text, { timeout });
}

/**
 * Dismiss the connection error overlay if visible.
 */
export async function dismissOverlays(page) {
  const overlay = page.locator('#connection-error-overlay');
  if (await overlay.isVisible({ timeout: 1000 }).catch(() => false)) {
    await page.locator('#btn-retry-connection').click();
    await expect(overlay).not.toBeVisible({ timeout: 5000 });
  }
}

/**
 * Export FEN to clipboard. Asserts toast appears with "FEN copied".
 */
export async function exportFen(page) {
  await openMenu(page);
  await page.locator('#btn-export-fen').click();
  await expect(page.locator('#error-toast')).toContainText('FEN copied', { timeout: 5000 });
  await closeMenu(page);
}

/**
 * Concede the current game via the menu flow.
 */
export async function concede(page) {
  await openMenu(page);
  await page.locator('#btn-concede').click();
  await expect(page.locator('#concede-overlay')).toBeVisible({ timeout: 5000 });
  await page.locator('#btn-concede-confirm').click();
  await expect(page.locator('#concede-overlay')).not.toBeVisible({ timeout: 5000 });
}

/**
 * Offer a draw via the menu.
 */
export async function offerDraw(page) {
  await openMenu(page);
  await page.locator('#btn-offer-draw').click();
}

/**
 * Accept an incoming draw offer from the draw-offer overlay.
 */
export async function acceptDraw(page) {
  await expect(page.locator('#draw-offer-overlay')).toBeVisible({ timeout: 10000 });
  await page.locator('#btn-draw-accept').click();
  await expect(page.locator('#draw-offer-overlay')).not.toBeVisible({ timeout: 5000 });
}

/**
 * Create two isolated browser contexts for multi-player tests.
 * Grants clipboard permissions. Navigates both to '/'.
 */
export async function createPlayerPages(browser, options = {}) {
  const ctx1 = await browser.newContext({ ...options });
  await ctx1.grantPermissions(['clipboard-read', 'clipboard-write']);
  const p1 = await ctx1.newPage();
  await p1.goto('/');

  const ctx2 = await browser.newContext({ ...options });
  await ctx2.grantPermissions(['clipboard-read', 'clipboard-write']);
  const p2 = await ctx2.newPage();
  await p2.goto('/');

  // Wait for WebSocket connections to establish and seat status to be received
  await p1.waitForTimeout(500);

  return { p1, p2, ctx1, ctx2 };
}

/**
 * Reset game state and give up seat.
 * Detects role from role-badge class, dismisses game-over if present,
 * restarts board, gives up spot, waits for join button to be enabled.
 */
export async function resetAndGiveUp(page) {
  // Detect current role
  const role = await page.locator('#role-badge').getAttribute('class');

  // Guard: only white/black can give up a seat
  if (!['white', 'black'].includes(role)) return;

  // Dismiss game-over overlay if present
  const gameOver = page.locator('#game-over-overlay');
  if (await gameOver.isVisible({ timeout: 1000 }).catch(() => false)) {
    await page.locator('#btn-new-game').click();
    await expect(gameOver).not.toBeVisible({ timeout: 5000 });
  } else {
    // Reset board state via menu — restart handler closes the menu itself
    await openMenu(page);
    await page.locator('#btn-restart').click();
  }

  // Give up spot
  await giveUpSpot(page);

  // Wait for join button to be enabled
  const joinBtn = page.locator(`#btn-join-${role}`);
  await expect(joinBtn).toBeEnabled({ timeout: 10000 });
}
