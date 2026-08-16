// Browser integration tests: 2D premove
//
// Covers the Phase 2 (2D) premove UX in a real browser:
//   - set → opponent moves → auto-executes (owner-only feedback)
//   - opponent captures the premoved piece → discarded, no execution
//   - promotion premove via the picker → atomic selected promotion
//   - cancellation: origin re-click, same-square right-click on origin, ESC
//   - right-click priority: another square still highlights, premove intact
//   - annotation arrow dragged to the premove origin still draws, premove intact
//   - clearing/drawing annotations never clears/hides the dashed premove arrow
//   - reconnect restores the pending premove visual (held-token path)
//   - multi-client: pending premove private; execution feedback owner-only
//
// Server-authority notes:
//   - The premove chip only appears after the server's confirmation echo (the
//     client never sets it optimistically), so "chip visible" proves the server
//     stored the premove — not just client DOM state.
//   - Execution / discard are asserted via the move log (server-authoritative).
//   - Owner-only feedback is asserted against a recorded toast history: the
//     toast auto-hides after 2.5s, so a point-in-time check could pass
//     vacuously (toast already gone) or fail flakily (toast not yet shown).
import { test, expect } from '@playwright/test';
import {
  joinGame,
  makeMove2d,
  waitForMoveLog,
  importFen,
  createPlayerPages,
  giveUpSpot,
} from './helpers.js';

// FENs — all with black to move so white is off-turn and can premove.
const FEN_BLACK_TO_MOVE = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1';
// White pawn e4, black pawn d5 (can capture dxe4).
const FEN_CAPTURE = 'rnbqkbnr/pppppppp/8/3p4/4P3/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1';
// White pawn e7 ready to promote (e8 empty, black king g8).
const FEN_PROMO = '6k1/4P3/8/8/8/8/8/4K3 b - - 0 1';

const VIEWPORT = { width: 1280, height: 720 };

// ── Local helpers ──────────────────────────────────────────────────────

function square(page, file, rank) {
  return page.locator(`#board-2d-overlay [data-file="${file}"][data-rank="${rank}"]`);
}

const premoveChip = (page) => page.locator('#premove-chip');
const premoveArrow = (page) => page.locator('#board-2d-container svg [data-premove-arrow="true"]');
const premoveSquares = (page) =>
  page.locator(
    '#board-2d-overlay .board2d-square.premove-from, #board-2d-overlay .board2d-square.premove-to'
  );
// Annotation arrows are the SVG <g> groups WITHOUT the premove marker. The
// confirmed premove arrow is a separate <g data-premove-arrow="true"> system
// overlay, so the two locators never alias each other.
const annotationArrows = (page) =>
  page.locator('#board-2d-container svg g:not([data-premove-arrow])');

async function ensureBoard2d(page) {
  const overlay = page.locator('#board-2d-overlay');
  if (!(await overlay.isVisible())) {
    const toggle = page.locator('#btn-board-2d:visible, #btn-board-2d-desktop:visible').first();
    await toggle.click();
    await expect(overlay).toBeVisible({ timeout: 5000 });
  }
}

async function suppressContextMenu(page) {
  await page.evaluate(() => {
    window.addEventListener('contextmenu', (e) => e.preventDefault(), { capture: true });
  });
}

/**
 * Set a premove via the 2D board (off-turn own-piece selection).
 * Clicks the origin, waits for the premove selection highlight, clicks the
 * destination, then waits for the server confirmation echo (chip visible).
 * The chip only appears after the server echoes the stored premove, so this
 * helper proves the server accepted the premove (not just client DOM state).
 */
async function setPremove2d(page, fromFile, fromRank, toFile, toRank) {
  await ensureBoard2d(page);
  const from = square(page, fromFile, fromRank);
  await from.click();
  await expect(from).toHaveClass(/premove-selected/, { timeout: 3000 });
  const to = square(page, toFile, toRank);
  await to.click();
  await expect(premoveChip(page)).toBeVisible({ timeout: 5000 });
}

async function rightClickSquare(page, file, rank) {
  const box = await square(page, file, rank).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
}

async function rightDrag(page, fromFile, fromRank, toFile, toRank) {
  const fromBox = await square(page, fromFile, fromRank).boundingBox();
  const toBox = await square(page, toFile, toRank).boundingBox();
  await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + toBox.height / 2);
  await page.mouse.up({ button: 'right' });
}

async function assertPremoveVisible(page) {
  await expect(premoveChip(page)).toBeVisible();
  await expect(premoveSquares(page)).toHaveCount(2);
  await expect(premoveArrow(page)).toHaveCount(1);
}

async function assertPremoveGone(page) {
  await expect(premoveChip(page)).not.toBeVisible();
  await expect(premoveSquares(page)).toHaveCount(0);
  await expect(premoveArrow(page)).toHaveCount(0);
}

async function closeContexts(ctxs) {
  await Promise.all(ctxs.map((c) => c.close().catch(() => {})));
}

// ── Toast recording ──────────────────────────────────────────────
// The toast (#error-toast) auto-hides after 2.5s, so a point-in-time
// assertion can pass vacuously (the toast already disappeared) or fail
// flakily (the toast not yet shown). Record every toast text the moment it
// appears via a MutationObserver, then assert against the full history.

async function startRecordingToasts(page) {
  await page.evaluate(() => {
    window.__toastLog = [];
    const toast = document.getElementById('error-toast');
    const observer = new window.MutationObserver(() => {
      const text = toast.textContent;
      if (text) window.__toastLog.push(text);
    });
    observer.observe(toast, { childList: true, characterData: true, subtree: true });
  });
}

async function getRecordedToasts(page) {
  return page.evaluate(() => window.__toastLog || []);
}

// Poll until the page's recorded toast history contains the given text.
// Robust to the 2.5s auto-hide: the observer captures the text the moment it
// appears, so we never race the hide timer.
async function expectToastRecorded(page, text, timeout = 5000) {
  await expect
    .poll(async () => (await getRecordedToasts(page)).includes(text), { timeout })
    .toBe(true);
}

// Assert the given text NEVER appeared in the page's recorded toast history.
// Safe to call once the triggering move has been processed: the premove toast
// (if any) is emitted synchronously in the same move handler that updates the
// log, so by then the history is complete.
async function expectToastNeverRecorded(page, text) {
  const toasts = await getRecordedToasts(page);
  expect(
    toasts,
    `expected "${text}" to never appear in recorded toasts ${JSON.stringify(toasts)}`
  ).not.toContain(text);
}

// ── Cleanup ──────────────────────────────────────────────────────
// Give up any held seats before closing contexts. A closed context holds its
// seat for seatTimeout (~5s in tests), which the next test's joinGame would
// otherwise wait out. Releasing the seat now makes the next join immediate
// without weakening isolation (each test still gets fresh pages).

async function giveUpSeats(pages) {
  for (const page of pages) {
    try {
      const role = await page
        .locator('#role-badge')
        .getAttribute('class')
        .catch(() => '');
      if (!['white', 'black'].includes(role)) continue;
      const joinVisible = await page
        .locator('#join-overlay')
        .isVisible()
        .catch(() => false);
      if (!joinVisible) await giveUpSpot(page);
    } catch {
      /* page may be closed or in a bad state — context close is enough */
    }
  }
}

// ── Tests ──────────────────────────────────────────────────────────────

test.describe.serial('Premove (2D)', () => {
  test('Premove auto-executes when the opponent moves', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await createPlayerPages(browser, {
      baseURL: 'http://localhost:3000',
      viewport: VIEWPORT,
    });
    try {
      await joinGame(p1, 'white');
      await joinGame(p2, 'black');
      await importFen(p1, FEN_BLACK_TO_MOVE);
      await ensureBoard2d(p1);
      await ensureBoard2d(p2);
      await suppressContextMenu(p1);
      await suppressContextMenu(p2);
      await startRecordingToasts(p1);
      await startRecordingToasts(p2);

      // White (off-turn) premoves e2-e4
      await setPremove2d(p1, 4, 1, 4, 3);
      await assertPremoveVisible(p1);
      // Premove is private: the opponent sees no premove visual
      await expect(premoveChip(p2)).not.toBeVisible();
      await expect(premoveSquares(p2)).toHaveCount(0);
      await expect(premoveArrow(p2)).toHaveCount(0);

      // Black moves e7-e5 → the server auto-executes white's premove
      await makeMove2d(p2, 4, 6, 4, 4);

      // Both moves appear in both logs (ordinary move update for everyone)
      await waitForMoveLog(p1, 'e4');
      await waitForMoveLog(p2, 'e4');

      // Premove visual cleared on the owner
      await assertPremoveGone(p1);
      // Owner sees premove-specific feedback (recorded, so the 2.5s auto-hide
      // can't make this flaky)
      await expectToastRecorded(p1, 'Premove played');
      // Opponent never sees premove-specific feedback (recorded over time, so
      // a briefly-shown-then-hidden toast can't make this pass vacuously)
      await expectToastNeverRecorded(p2, 'Premove played');
      // Turn is back to black
      await expect(p1.locator('#turn-indicator')).toContainText('Black');
    } finally {
      await giveUpSeats([p1, p2]);
      await closeContexts([ctx1, ctx2]);
    }
  });

  test('Opponent captures the premoved piece → premove discarded', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await createPlayerPages(browser, {
      baseURL: 'http://localhost:3000',
      viewport: VIEWPORT,
    });
    try {
      await joinGame(p1, 'white');
      await joinGame(p2, 'black');
      await importFen(p1, FEN_CAPTURE);
      await ensureBoard2d(p1);
      await ensureBoard2d(p2);
      await suppressContextMenu(p1);
      await suppressContextMenu(p2);

      // White (off-turn) premoves e4-e5
      await setPremove2d(p1, 4, 3, 4, 4);
      await assertPremoveVisible(p1);

      // Black captures the premoved pawn: d5xe4
      await makeMove2d(p2, 3, 4, 4, 3);
      await waitForMoveLog(p1, 'dxe4');

      // Premove is discarded by the server: visual cleared, no execution
      await assertPremoveGone(p1);
      const logText = await p1.locator('#move-log').textContent();
      expect(logText).not.toContain('e5');
      // Turn is white's (black just moved)
      await expect(p1.locator('#turn-indicator')).toContainText('White');
    } finally {
      await giveUpSeats([p1, p2]);
      await closeContexts([ctx1, ctx2]);
    }
  });

  test('Promotion premove via picker → atomic selected promotion', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await createPlayerPages(browser, {
      baseURL: 'http://localhost:3000',
      viewport: VIEWPORT,
    });
    try {
      await joinGame(p1, 'white');
      await joinGame(p2, 'black');
      await importFen(p1, FEN_PROMO);
      await ensureBoard2d(p1);
      await ensureBoard2d(p2);
      await suppressContextMenu(p1);
      await suppressContextMenu(p2);
      await startRecordingToasts(p1);

      // White (off-turn) selects e7 then e8 → promotion picker (premove mode)
      const from = square(p1, 4, 6);
      await from.click();
      await expect(from).toHaveClass(/premove-selected/, { timeout: 3000 });
      await square(p1, 4, 7).click();
      await expect(p1.locator('#promo-overlay')).toBeVisible({ timeout: 5000 });

      // Choose rook → atomic premove with promotion
      await p1.locator('#promo-choices [data-type="rook"]').click();
      await expect(p1.locator('#promo-overlay')).not.toBeVisible({ timeout: 5000 });
      await assertPremoveVisible(p1);

      // Black moves Kh8 → the server executes white's promotion premove
      await makeMove2d(p2, 6, 7, 7, 7);
      await waitForMoveLog(p1, 'e8=R');

      // Pawn promoted to rook on e8
      const e8Piece = await square(p1, 4, 7).locator('.board2d-piece').getAttribute('src');
      expect(e8Piece).toContain('wR');
      await assertPremoveGone(p1);
      // Owner sees premove-specific feedback (recorded, auto-hide-safe)
      await expectToastRecorded(p1, 'Premove played');
    } finally {
      await giveUpSeats([p1, p2]);
      await closeContexts([ctx1, ctx2]);
    }
  });

  test('Cancel by re-clicking the premove origin', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await createPlayerPages(browser, {
      baseURL: 'http://localhost:3000',
      viewport: VIEWPORT,
    });
    try {
      await joinGame(p1, 'white');
      await joinGame(p2, 'black');
      await importFen(p1, FEN_BLACK_TO_MOVE);
      await ensureBoard2d(p1);
      await ensureBoard2d(p2);
      await suppressContextMenu(p1);
      await suppressContextMenu(p2);

      await setPremove2d(p1, 4, 1, 4, 3);
      await assertPremoveVisible(p1);

      // Re-click the origin (e2) → cancel
      await square(p1, 4, 1).click();
      await assertPremoveGone(p1);

      // Black moves → the server must NOT execute the cancelled premove
      await makeMove2d(p2, 4, 6, 4, 4);
      await waitForMoveLog(p1, 'e5');
      const logText = await p1.locator('#move-log').textContent();
      expect(logText).not.toContain('e4');
    } finally {
      await giveUpSeats([p1, p2]);
      await closeContexts([ctx1, ctx2]);
    }
  });

  test('Cancel by same-square right-click on the premove origin', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await createPlayerPages(browser, {
      baseURL: 'http://localhost:3000',
      viewport: VIEWPORT,
    });
    try {
      await joinGame(p1, 'white');
      await joinGame(p2, 'black');
      await importFen(p1, FEN_BLACK_TO_MOVE);
      await ensureBoard2d(p1);
      await ensureBoard2d(p2);
      await suppressContextMenu(p1);
      await suppressContextMenu(p2);

      await setPremove2d(p1, 4, 1, 4, 3);
      await assertPremoveVisible(p1);

      // Same-square right-click on the origin (e2) → cancel
      await rightClickSquare(p1, 4, 1);
      await assertPremoveGone(p1);

      // Black moves → the server must NOT execute the cancelled premove
      await makeMove2d(p2, 4, 6, 4, 4);
      await waitForMoveLog(p1, 'e5');
      const logText = await p1.locator('#move-log').textContent();
      expect(logText).not.toContain('e4');
    } finally {
      await giveUpSeats([p1, p2]);
      await closeContexts([ctx1, ctx2]);
    }
  });

  test('Cancel by ESC', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await createPlayerPages(browser, {
      baseURL: 'http://localhost:3000',
      viewport: VIEWPORT,
    });
    try {
      await joinGame(p1, 'white');
      await joinGame(p2, 'black');
      await importFen(p1, FEN_BLACK_TO_MOVE);
      await ensureBoard2d(p1);
      await ensureBoard2d(p2);
      await suppressContextMenu(p1);
      await suppressContextMenu(p2);

      await setPremove2d(p1, 4, 1, 4, 3);
      await assertPremoveVisible(p1);

      // ESC → cancel
      await p1.keyboard.press('Escape');
      await assertPremoveGone(p1);

      // Black moves → the server must NOT execute the cancelled premove
      await makeMove2d(p2, 4, 6, 4, 4);
      await waitForMoveLog(p1, 'e5');
      const logText = await p1.locator('#move-log').textContent();
      expect(logText).not.toContain('e4');
    } finally {
      await giveUpSeats([p1, p2]);
      await closeContexts([ctx1, ctx2]);
    }
  });

  test('Right-click another square still highlights and keeps the premove', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await createPlayerPages(browser, {
      baseURL: 'http://localhost:3000',
      viewport: VIEWPORT,
    });
    try {
      await joinGame(p1, 'white');
      await joinGame(p2, 'black');
      await importFen(p1, FEN_BLACK_TO_MOVE);
      await ensureBoard2d(p1);
      await suppressContextMenu(p1);

      await setPremove2d(p1, 4, 1, 4, 3);
      await assertPremoveVisible(p1);

      // Same-square right-click on a different (empty) square a3 → highlight.
      // The highlight is an annotation overlay (.board2d-highlight), distinct
      // from the premove square fills (premove-from/premove-to).
      await rightClickSquare(p1, 0, 2);
      await expect(square(p1, 0, 2).locator('.board2d-highlight')).toBeVisible({
        timeout: 5000,
      });

      // Premove is intact (fills + dashed arrow)
      await assertPremoveVisible(p1);
    } finally {
      await giveUpSeats([p1, p2]);
      await closeContexts([ctx1, ctx2]);
    }
  });

  test('Annotation arrow dragged to the premove origin still draws and keeps the premove', async ({
    browser,
  }) => {
    const { p1, p2, ctx1, ctx2 } = await createPlayerPages(browser, {
      baseURL: 'http://localhost:3000',
      viewport: VIEWPORT,
    });
    try {
      await joinGame(p1, 'white');
      await joinGame(p2, 'black');
      await importFen(p1, FEN_BLACK_TO_MOVE);
      await ensureBoard2d(p1);
      await suppressContextMenu(p1);

      // Premove e2-e4 (origin e2)
      await setPremove2d(p1, 4, 1, 4, 3);
      await assertPremoveVisible(p1);

      // Right-drag an annotation arrow from d2 to the premove origin e2.
      // A drag (press ≠ release) always draws its arrow — even one that ends
      // on the premove origin — and never touches the premove.
      await rightDrag(p1, 3, 1, 4, 1);
      await expect(annotationArrows(p1)).toHaveCount(1, { timeout: 5000 });

      // The annotation arrow drew AND the premove arrow + state are intact
      await expect(premoveArrow(p1)).toHaveCount(1);
      await assertPremoveVisible(p1);
    } finally {
      await giveUpSeats([p1, p2]);
      await closeContexts([ctx1, ctx2]);
    }
  });

  test('Clearing/drawing annotations never clears or hides the premove arrow', async ({
    browser,
  }) => {
    const { p1, p2, ctx1, ctx2 } = await createPlayerPages(browser, {
      baseURL: 'http://localhost:3000',
      viewport: VIEWPORT,
    });
    try {
      await joinGame(p1, 'white');
      await joinGame(p2, 'black');
      await importFen(p1, FEN_BLACK_TO_MOVE);
      await ensureBoard2d(p1);
      await suppressContextMenu(p1);

      // Premove e2-e4
      await setPremove2d(p1, 4, 1, 4, 3);
      await assertPremoveVisible(p1);
      await expect(annotationArrows(p1)).toHaveCount(0);

      // Draw an annotation arrow with IDENTICAL endpoints to the premove.
      // The premove arrow is a separate system overlay, so it is not deduped
      // against the annotation list — both coexist.
      await rightDrag(p1, 4, 1, 4, 3);
      await expect(annotationArrows(p1)).toHaveCount(1, { timeout: 5000 });
      // Both arrows coexist: 1 annotation + 1 premove (each a <g> with one
      // body <path>), so the SVG holds exactly two body paths.
      await expect(premoveArrow(p1)).toHaveCount(1);
      await expect(p1.locator('#board-2d-container svg path')).toHaveCount(2);

      // Clear annotations via an ordinary left-click on an empty square
      await square(p1, 0, 2).click();
      await expect(annotationArrows(p1)).toHaveCount(0);
      // The dashed premove arrow survives the annotation clear
      await expect(premoveArrow(p1)).toHaveCount(1);
      await assertPremoveVisible(p1);
    } finally {
      await giveUpSeats([p1, p2]);
      await closeContexts([ctx1, ctx2]);
    }
  });

  test('Reconnect restores the pending premove visual', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await createPlayerPages(browser, {
      baseURL: 'http://localhost:3000',
      viewport: VIEWPORT,
    });
    try {
      await joinGame(p1, 'white');
      await joinGame(p2, 'black');
      await importFen(p1, FEN_BLACK_TO_MOVE);
      await ensureBoard2d(p1);
      await suppressContextMenu(p1);

      // White sets a premove
      await setPremove2d(p1, 4, 1, 4, 3);
      await assertPremoveVisible(p1);

      // Reload the page. The session token persists in localStorage, so the
      // rejoin below goes through the held-token reconnect path (the server
      // matches the token to the held seat) — not a fresh join with a new
      // token. A fresh join would get a new token and no premove, so the
      // restored-premove assertion below only passes via the held-token path.
      await p1.reload();
      await expect(p1.locator('#join-overlay')).toBeVisible({ timeout: 10000 });
      const heldToken = await p1.evaluate(() => localStorage.getItem('mpchess_session_white'));
      expect(heldToken).toBeTruthy();
      await expect(p1.locator('#btn-join-white')).toBeEnabled({ timeout: 10000 });
      await p1.locator('#btn-join-white').click();
      await expect(p1.locator('#join-overlay')).not.toBeVisible({ timeout: 10000 });

      // Premove visual restored from the per-client state message
      await ensureBoard2d(p1);
      await assertPremoveVisible(p1);
    } finally {
      await giveUpSeats([p1, p2]);
      await closeContexts([ctx1, ctx2]);
    }
  });

  test('Multi-client: pending premove private; execution feedback owner-only', async ({
    browser,
  }) => {
    // Three players (white + black + spectator) means 3 page loads, 3 joins,
    // and 3× cleanup — the slowest test in the file. Give it a larger
    // per-test timeout than the 60s default so the 3-player overhead doesn't
    // cause a spurious timeout.
    test.setTimeout(120_000);
    const { p1, p2, ctx1, ctx2 } = await createPlayerPages(browser, {
      baseURL: 'http://localhost:3000',
      viewport: VIEWPORT,
    });
    // Create the spectator context up front and track every context so the
    // finally block closes all of them even if setup fails part-way.
    const ctx3 = await browser.newContext({
      baseURL: 'http://localhost:3000',
      viewport: VIEWPORT,
    });
    const p3 = await ctx3.newPage();
    await p3.goto('/');
    try {
      await joinGame(p1, 'white');
      await joinGame(p2, 'black');
      await joinGame(p3, 'spectator');
      await importFen(p1, FEN_BLACK_TO_MOVE);
      await ensureBoard2d(p1);
      await ensureBoard2d(p2);
      await ensureBoard2d(p3);
      await suppressContextMenu(p1);
      await suppressContextMenu(p2);
      await suppressContextMenu(p3);
      await startRecordingToasts(p1);
      await startRecordingToasts(p2);
      await startRecordingToasts(p3);

      // White premoves e2-e4
      await setPremove2d(p1, 4, 1, 4, 3);
      await assertPremoveVisible(p1);

      // Pending premove is private: opponent and spectator see no visual
      await expect(premoveChip(p2)).not.toBeVisible();
      await expect(premoveChip(p3)).not.toBeVisible();
      await expect(premoveSquares(p2)).toHaveCount(0);
      await expect(premoveSquares(p3)).toHaveCount(0);
      await expect(premoveArrow(p2)).toHaveCount(0);
      await expect(premoveArrow(p3)).toHaveCount(0);

      // Black moves e7-e5 → the server executes white's premove
      await makeMove2d(p2, 4, 6, 4, 4);

      // All three clients receive the ordinary move update
      await waitForMoveLog(p1, 'e4');
      await waitForMoveLog(p2, 'e4');
      await waitForMoveLog(p3, 'e4');

      // Only the owner sees premove-specific feedback (recorded, so the 2.5s
      // auto-hide can't make these pass vacuously or fail flakily)
      await expectToastRecorded(p1, 'Premove played');
      await expectToastNeverRecorded(p2, 'Premove played');
      await expectToastNeverRecorded(p3, 'Premove played');
    } finally {
      await giveUpSeats([p1, p2, p3]);
      await closeContexts([ctx1, ctx2, ctx3]);
    }
  });
});
