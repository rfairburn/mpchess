// Browser integration tests: 3D premove (Phase 3)
//
// Deterministic real-browser coverage of the Phase 3 (3D) premove UX with the
// 3D board active (the 2D overlay hidden — the default). The 3D board is a
// WebGL canvas, so squares are addressed through read-only test hooks:
//   - window.__testSquareScreenPos(file, rank) projects a square center to
//     screen coordinates (live camera) so clicks land deterministically.
//   - window.__testPremove3D() exposes the confirmed-premove renderer state
//     (shared premove value, selection, confirmed-square emissive fills,
//     dashed system arrow).
//   - window.__testPremoveGhost3D() exposes the destination ghost state.
//   - window.__testAnnotationArrows3D() counts annotation arrows.
//
// Covers:
//   - off-turn 3D selection/submission confirmed by the server (chip only
//     appears after the server echo — not optimistic client state)
//   - visible confirmed deep-blue squares, dashed system arrow, ghost
//   - opponent move auto-executes (owner-only feedback, private to owner)
//   - cancellation: origin re-click, same-square right-click on origin, ESC
//   - right-click priority: a right-drag ending on the premove origin still
//     draws its annotation arrow and leaves the premove intact
//   - promotion premove via the picker (atomic selected promotion)
//   - reconnect restores the pending premove visual (held-token path)
//   - clearing/drawing annotations (incl. identical endpoints) never removes
//     the 3D system arrow
//
// Server-authority notes (same as the 2D spec):
//   - "chip visible" proves the server stored the premove.
//   - Execution / discard are asserted via the move log (server-authoritative).
//   - Owner-only feedback is asserted against a recorded toast history (the
//     toast auto-hides after 2.5s, so a point-in-time check could pass
//     vacuously or fail flakily).
//
// This spec deliberately does NOT duplicate the full 2D premove matrix
// (test/browser/premove.spec.js) — it reuses the shared helpers and focuses
// on the 3D-specific interaction and renderer state.
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
// White pawn e7 ready to promote (e8 empty, black king g8).
const FEN_PROMO = '6k1/4P3/8/8/8/8/8/4K3 b - - 0 1';

const VIEWPORT = { width: 1280, height: 720 };
// Deep royal blue — the confirmed-premove hue (squares, arrow).
const PREMOVE_BLUE = 0x1e5ac8;

// ── Local helpers ──────────────────────────────────────────────────────

const premoveChip = (page) => page.locator('#premove-chip');

/**
 * The 3D board is active when the 2D overlay is hidden (the default).
 * Asserts the overlay is not visible so every test runs against the 3D board.
 */
async function ensureBoard3d(page) {
  await expect(page.locator('#board-2d-overlay')).not.toBeVisible();
}

/**
 * Wait until the 3D pieces are rendered (models loaded + board state applied).
 * This is the deterministic signal that the WebGL board is ready — it also
 * implies the role camera has been positioned (both happen on the same state
 * update), so screen projections are valid afterwards.
 */
async function waitForPieces3d(page, timeout = 20000) {
  await expect
    .poll(async () => page.evaluate(() => window.__testPiecePositions().length), { timeout })
    .toBeGreaterThan(0);
}

async function squareScreenPos(page, file, rank) {
  const pos = await page.evaluate(([f, r]) => window.__testSquareScreenPos(f, r), [file, rank]);
  expect(pos, `square (${file},${rank}) must project to a screen position`).not.toBeNull();
  return pos;
}

async function click3d(page, file, rank) {
  const pos = await squareScreenPos(page, file, rank);
  await page.mouse.click(pos.x, pos.y);
}

async function rightClick3d(page, file, rank) {
  const pos = await squareScreenPos(page, file, rank);
  await page.mouse.click(pos.x, pos.y, { button: 'right' });
}

async function rightDrag3d(page, fromFile, fromRank, toFile, toRank) {
  const from = await squareScreenPos(page, fromFile, fromRank);
  const to = await squareScreenPos(page, toFile, toRank);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(to.x, to.y);
  await page.mouse.up({ button: 'right' });
}

async function premove3dState(page) {
  return page.evaluate(() => window.__testPremove3D());
}

async function ghost3dState(page) {
  return page.evaluate(() => window.__testPremoveGhost3D());
}

async function annotationArrows3dCount(page) {
  return page.evaluate(() => window.__testAnnotationArrows3D());
}

/**
 * Create two isolated player pages (like createPlayerPages) but install a
 * Playwright-side observer on p1's WebSocket that counts the private
 * `premoveCleared` frames (the server's cancel acknowledgement). The observer
 * is installed BEFORE navigation so it catches the initial connection. Returns
 * a `clearedCount()` getter for the count.
 *
 * This keeps the acknowledgement observer entirely in the test harness — no
 * production protocol hook is needed (the task requires new hooks to expose
 * only renderer state).
 */
async function createPlayerPagesWithClearedWatcher(browser, options = {}) {
  const ctx1 = await browser.newContext({ ...options });
  await ctx1.grantPermissions(['clipboard-read', 'clipboard-write']);
  const p1 = await ctx1.newPage();
  let clearedCount = 0;
  p1.on('websocket', (ws) => {
    ws.on('framereceived', (frame) => {
      if (typeof frame.payload === 'string' && frame.payload.includes('"premoveCleared"')) {
        clearedCount++;
      }
    });
  });
  await p1.goto('/');

  const ctx2 = await browser.newContext({ ...options });
  await ctx2.grantPermissions(['clipboard-read', 'clipboard-write']);
  const p2 = await ctx2.newPage();
  await p2.goto('/');

  await p1.waitForTimeout(500);

  return { p1, p2, ctx1, ctx2, clearedCount: () => clearedCount };
}

/**
 * Wait until the server has acknowledged the premove cancel (the private
 * `premoveCleared` frame, observed via Playwright WebSocket instrumentation).
 * The optimistic local clear alone is not enough: the cancel and the
 * opponent's move travel over different WebSockets, so cross-socket ordering
 * is not guaranteed — the server could process the move before the cancel
 * and auto-execute the still-stored premove. Awaiting the ack makes the
 * subsequent negative move-log assertion deterministic.
 */
async function waitForPremoveClearedAck(clearedCount, baseline) {
  await expect.poll(clearedCount, { timeout: 5000 }).toBeGreaterThan(baseline);
}

async function suppressContextMenu(page) {
  await page.evaluate(() => {
    window.addEventListener('contextmenu', (e) => e.preventDefault(), { capture: true });
  });
}

/**
 * Set a premove via the 3D board (off-turn own-piece selection).
 * Clicks the origin, waits for the premove selection to register, clicks the
 * destination, then waits for the server confirmation echo (chip visible).
 * The chip only appears after the server echoes the stored premove, so this
 * helper proves the server accepted the premove (not just client state).
 */
async function setPremove3d(page, fromFile, fromRank, toFile, toRank) {
  await ensureBoard3d(page);
  await click3d(page, fromFile, fromRank);
  // Wait for the off-turn premove selection to register (client-side).
  await expect
    .poll(
      async () => {
        const sel = (await premove3dState(page)).selection;
        return sel && sel.mode === 'premove' && sel.file === fromFile && sel.rank === fromRank;
      },
      { timeout: 5000 }
    )
    .toBe(true);
  await click3d(page, toFile, toRank);
  await expect(premoveChip(page)).toBeVisible({ timeout: 5000 });
}

async function assertPremove3dVisible(page, fromFile, fromRank, toFile, toRank) {
  await expect(premoveChip(page)).toBeVisible();
  const s = await premove3dState(page);
  expect(s.premove).toMatchObject({ fromFile, fromRank, toFile, toRank });
  expect(s.confirmedSquares).toMatchObject({ fromFile, fromRank, toFile, toRank });
  // Confirmed origin/destination squares carry the deep-blue emissive fill
  // at a nonzero intensity (proves visible fills, not merely stored colors).
  expect(s.fromEmissive).toBe(PREMOVE_BLUE);
  expect(s.toEmissive).toBe(PREMOVE_BLUE);
  expect(s.fromEmissiveIntensity).toBeGreaterThan(0);
  expect(s.toEmissiveIntensity).toBeGreaterThan(0);
  // Dashed system arrow: attached to the premove group, visible, and made of
  // multiple dash segments (a detached, hidden, or solid arrow would fail).
  expect(s.arrow.present).toBe(true);
  expect(s.arrow.attached).toBe(true);
  expect(s.arrow.visible).toBe(true);
  expect(s.arrow.dashSegments).toBeGreaterThan(1);
  expect(s.arrow.color).toBe(PREMOVE_BLUE);
  // Semi-transparent destination ghost.
  const g = await ghost3dState(page);
  expect(g.present).toBe(true);
  expect(g.file).toBe(toFile);
  expect(g.rank).toBe(toRank);
  expect(g.opacity).toBeCloseTo(0.45, 2);
  expect(g.transparent).toBe(true);
  expect(g.depthWrite).toBe(false);
}

async function assertPremove3dGone(page) {
  await expect(premoveChip(page)).not.toBeVisible();
  const s = await premove3dState(page);
  expect(s.premove).toBeNull();
  expect(s.confirmedSquares).toBeNull();
  expect(s.fromEmissive).toBeNull();
  expect(s.toEmissive).toBeNull();
  expect(s.fromEmissiveIntensity).toBeNull();
  expect(s.toEmissiveIntensity).toBeNull();
  expect(s.arrow.present).toBe(false);
  expect(s.arrow.attached).toBe(false);
  expect(s.arrow.visible).toBe(false);
  expect(s.arrow.dashSegments).toBe(0);
  const g = await ghost3dState(page);
  expect(g.present).toBe(false);
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

async function expectToastRecorded(page, text, timeout = 5000) {
  await expect
    .poll(async () => (await getRecordedToasts(page)).includes(text), { timeout })
    .toBe(true);
}

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
// otherwise wait out. Releasing the seat now makes the next join immediate.

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

test.describe.serial('Premove (3D)', () => {
  test('Off-turn 3D premove: confirmed by server, visualized, auto-executes', async ({
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
      await ensureBoard3d(p1);
      await ensureBoard3d(p2);
      await waitForPieces3d(p1);
      await waitForPieces3d(p2);
      await suppressContextMenu(p1);
      await suppressContextMenu(p2);
      await startRecordingToasts(p1);
      await startRecordingToasts(p2);

      // White (off-turn) premoves e2-e4 through the 3D board
      await setPremove3d(p1, 4, 1, 4, 3);
      await assertPremove3dVisible(p1, 4, 1, 4, 3);

      // Premove is private: the opponent's 3D renderer shows nothing
      await expect(premoveChip(p2)).not.toBeVisible();
      const opp = await premove3dState(p2);
      expect(opp.premove).toBeNull();
      expect(opp.confirmedSquares).toBeNull();
      expect(opp.arrow.present).toBe(false);
      expect((await ghost3dState(p2)).present).toBe(false);

      // Black moves e7-e5 → the server auto-executes white's premove
      await makeMove2d(p2, 4, 6, 4, 4);

      // Both moves appear in both logs (server-authoritative)
      await waitForMoveLog(p1, 'e4');
      await waitForMoveLog(p2, 'e4');

      // Premove visual cleared on the owner (chip, squares, arrow, ghost)
      await assertPremove3dGone(p1);
      // Owner sees premove-specific feedback (recorded, auto-hide-safe)
      await expectToastRecorded(p1, 'Premove played');
      // Opponent never sees premove-specific feedback
      await expectToastNeverRecorded(p2, 'Premove played');
      // Turn is back to black
      await expect(p1.locator('#turn-indicator')).toContainText('Black');
    } finally {
      await giveUpSeats([p1, p2]);
      await closeContexts([ctx1, ctx2]);
    }
  });

  test('Cancel by re-clicking the premove origin (3D)', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2, clearedCount } = await createPlayerPagesWithClearedWatcher(
      browser,
      {
        baseURL: 'http://localhost:3000',
        viewport: VIEWPORT,
      }
    );
    try {
      await joinGame(p1, 'white');
      await joinGame(p2, 'black');
      await importFen(p1, FEN_BLACK_TO_MOVE);
      await ensureBoard3d(p1);
      await ensureBoard3d(p2);
      await waitForPieces3d(p1);
      await suppressContextMenu(p1);
      await suppressContextMenu(p2);

      await setPremove3d(p1, 4, 1, 4, 3);
      await assertPremove3dVisible(p1, 4, 1, 4, 3);
      const clearedBaseline = clearedCount();

      // Re-click the origin (e2) on the 3D board → cancel
      await click3d(p1, 4, 1);
      await assertPremove3dGone(p1);
      // Wait for the server's cancel acknowledgement before the opponent moves
      await waitForPremoveClearedAck(clearedCount, clearedBaseline);

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

  test('Cancel by same-square right-click on the premove origin (3D)', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2, clearedCount } = await createPlayerPagesWithClearedWatcher(
      browser,
      {
        baseURL: 'http://localhost:3000',
        viewport: VIEWPORT,
      }
    );
    try {
      await joinGame(p1, 'white');
      await joinGame(p2, 'black');
      await importFen(p1, FEN_BLACK_TO_MOVE);
      await ensureBoard3d(p1);
      await ensureBoard3d(p2);
      await waitForPieces3d(p1);
      await suppressContextMenu(p1);
      await suppressContextMenu(p2);

      await setPremove3d(p1, 4, 1, 4, 3);
      await assertPremove3dVisible(p1, 4, 1, 4, 3);
      const clearedBaseline = clearedCount();

      // Same-square right-click on the origin (e2) → cancel
      await rightClick3d(p1, 4, 1);
      await assertPremove3dGone(p1);
      // Wait for the server's cancel acknowledgement before the opponent moves
      await waitForPremoveClearedAck(clearedCount, clearedBaseline);

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

  test('Cancel by ESC (3D)', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2, clearedCount } = await createPlayerPagesWithClearedWatcher(
      browser,
      {
        baseURL: 'http://localhost:3000',
        viewport: VIEWPORT,
      }
    );
    try {
      await joinGame(p1, 'white');
      await joinGame(p2, 'black');
      await importFen(p1, FEN_BLACK_TO_MOVE);
      await ensureBoard3d(p1);
      await ensureBoard3d(p2);
      await waitForPieces3d(p1);
      await suppressContextMenu(p1);
      await suppressContextMenu(p2);

      await setPremove3d(p1, 4, 1, 4, 3);
      await assertPremove3dVisible(p1, 4, 1, 4, 3);
      const clearedBaseline = clearedCount();

      // ESC → cancel (no menu open)
      await p1.keyboard.press('Escape');
      await assertPremove3dGone(p1);
      // Wait for the server's cancel acknowledgement before the opponent moves
      await waitForPremoveClearedAck(clearedCount, clearedBaseline);

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

  test('Right-drag to the premove origin draws its annotation and keeps the premove (3D)', async ({
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
      await ensureBoard3d(p1);
      await ensureBoard3d(p2);
      await waitForPieces3d(p1);
      await suppressContextMenu(p1);
      await suppressContextMenu(p2);

      // Premove e2-e4 (origin e2)
      await setPremove3d(p1, 4, 1, 4, 3);
      await assertPremove3dVisible(p1, 4, 1, 4, 3);

      // Right-drag an annotation arrow from d2 to the premove origin e2.
      // A drag (press ≠ release) always draws its arrow — even one that ends
      // on the premove origin — and never touches the premove.
      await rightDrag3d(p1, 3, 1, 4, 1);
      await expect.poll(() => annotationArrows3dCount(p1), { timeout: 5000 }).toBe(1);

      // The annotation arrow drew AND the premove (arrow + state) is intact
      await assertPremove3dVisible(p1, 4, 1, 4, 3);
    } finally {
      await giveUpSeats([p1, p2]);
      await closeContexts([ctx1, ctx2]);
    }
  });

  test('Annotation clear and identical-endpoint annotation never remove the 3D premove arrow', async ({
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
      await ensureBoard3d(p1);
      await ensureBoard3d(p2);
      await waitForPieces3d(p1);
      await suppressContextMenu(p1);
      await suppressContextMenu(p2);

      // Premove e2-e4
      await setPremove3d(p1, 4, 1, 4, 3);
      await assertPremove3dVisible(p1, 4, 1, 4, 3);
      expect(await annotationArrows3dCount(p1)).toBe(0);

      // Draw an annotation arrow with IDENTICAL endpoints to the premove.
      // The premove arrow is a separate system overlay, so it is not deduped
      // against the annotation list — both coexist.
      await rightDrag3d(p1, 4, 1, 4, 3);
      await expect.poll(() => annotationArrows3dCount(p1), { timeout: 5000 }).toBe(1);
      expect((await premove3dState(p1)).arrow.present).toBe(true);

      // Clear annotations via an ordinary left-click on an empty square
      await click3d(p1, 0, 2);
      await expect.poll(() => annotationArrows3dCount(p1), { timeout: 5000 }).toBe(0);
      // The dashed premove arrow survives the annotation clear
      await assertPremove3dVisible(p1, 4, 1, 4, 3);
    } finally {
      await giveUpSeats([p1, p2]);
      await closeContexts([ctx1, ctx2]);
    }
  });

  test('Promotion premove via picker (3D) → atomic selected promotion', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await createPlayerPages(browser, {
      baseURL: 'http://localhost:3000',
      viewport: VIEWPORT,
    });
    try {
      await joinGame(p1, 'white');
      await joinGame(p2, 'black');
      await importFen(p1, FEN_PROMO);
      await ensureBoard3d(p1);
      await ensureBoard3d(p2);
      await waitForPieces3d(p1);
      await suppressContextMenu(p1);
      await suppressContextMenu(p2);
      await startRecordingToasts(p1);

      // White (off-turn) selects e7 then e8 on the 3D board → promotion
      // picker (premove mode)
      await click3d(p1, 4, 6);
      await expect
        .poll(
          async () => {
            const sel = (await premove3dState(p1)).selection;
            return sel && sel.mode === 'premove' && sel.file === 4 && sel.rank === 6;
          },
          { timeout: 5000 }
        )
        .toBe(true);
      await click3d(p1, 4, 7);
      await expect(p1.locator('#promo-overlay')).toBeVisible({ timeout: 5000 });

      // Choose rook → atomic premove with promotion
      await p1.locator('#promo-choices [data-type="rook"]').click();
      await expect(p1.locator('#promo-overlay')).not.toBeVisible({ timeout: 5000 });
      await assertPremove3dVisible(p1, 4, 6, 4, 7);
      expect((await premove3dState(p1)).premove.promotion).toBe('rook');

      // Black moves Kh8 → the server executes white's promotion premove
      await makeMove2d(p2, 6, 7, 7, 7);
      await waitForMoveLog(p1, 'e8=R');

      await assertPremove3dGone(p1);
      // Owner sees premove-specific feedback (recorded, auto-hide-safe)
      await expectToastRecorded(p1, 'Premove played');
    } finally {
      await giveUpSeats([p1, p2]);
      await closeContexts([ctx1, ctx2]);
    }
  });

  test('Reconnect restores the pending premove visual (3D)', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await createPlayerPages(browser, {
      baseURL: 'http://localhost:3000',
      viewport: VIEWPORT,
    });
    try {
      await joinGame(p1, 'white');
      await joinGame(p2, 'black');
      await importFen(p1, FEN_BLACK_TO_MOVE);
      await ensureBoard3d(p1);
      await waitForPieces3d(p1);
      await suppressContextMenu(p1);

      // White sets a premove
      await setPremove3d(p1, 4, 1, 4, 3);
      await assertPremove3dVisible(p1, 4, 1, 4, 3);

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
      await ensureBoard3d(p1);
      await waitForPieces3d(p1);
      await assertPremove3dVisible(p1, 4, 1, 4, 3);
    } finally {
      await giveUpSeats([p1, p2]);
      await closeContexts([ctx1, ctx2]);
    }
  });
});
