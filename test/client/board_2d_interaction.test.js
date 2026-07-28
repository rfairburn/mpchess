// ═══════════════════════════════════════════════════════════
//  2D BOARD — interaction tests
// ═══════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';

// Chess piece constants
const W_PAWN = 1,
  W_KNIGHT = 2,
  W_BISHOP = 3,
  W_ROOK = 4,
  W_QUEEN = 5,
  W_KING = 6;
const B_PAWN = 7,
  B_KNIGHT = 8,
  B_BISHOP = 9,
  B_ROOK = 10,
  B_QUEEN = 11,
  B_KING = 12;

function startingBoard() {
  const b = Array.from({ length: 8 }, () => Array(8).fill(0));
  const back = [W_ROOK, W_KNIGHT, W_BISHOP, W_QUEEN, W_KING, W_BISHOP, W_KNIGHT, W_ROOK];
  for (let f = 0; f < 8; f++) {
    b[0][f] = back[f];
    b[7][f] = back[f] + 6;
  }
  for (let f = 0; f < 8; f++) {
    b[1][f] = W_PAWN;
    b[6][f] = B_PAWN;
  }
  return b;
}

function pieceColor(p) {
  if (p === 0) return null;
  return p >= 7 ? 'black' : 'white';
}

// Full move generator supporting all piece types, castling, en passant
function getValidMoves(board, file, rank, castlingRights, enPassantTarget) {
  const piece = board[rank][file];
  if (piece === 0) return [];
  const color = pieceColor(piece);
  const moves = [];
  const type =
    ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'][
      color === 'white' ? piece - 1 : piece - 7
    ] || '';

  function addMove(tf, tr, isEnPassant) {
    if (tf < 0 || tf >= 8 || tr < 0 || tr >= 8) return false;
    const target = board[tr][tf];
    if (target !== 0 && pieceColor(target) === color) return true;
    const saved = board[tr][tf];
    try {
      board[tr][tf] = piece;
      board[rank][file] = 0;
      if (isEnPassant) {
        const capturedRank = color === 'white' ? tr - 1 : tr + 1;
        board[capturedRank][tf] = 0;
      }
      const inCheck = isInCheck(board, color);
      if (!inCheck) moves.push({ file: tf, rank: tr, enPassant: isEnPassant });
    } finally {
      board[rank][file] = piece;
      board[tr][tf] = saved;
    }
    return target !== 0;
  }

  if (type === 'pawn') {
    const dir = color === 'white' ? 1 : -1;
    const startRank = color === 'white' ? 1 : 6;
    const nr = rank + dir;
    if (nr >= 0 && nr < 8 && board[nr][file] === 0) {
      addMove(file, nr);
      if (rank === startRank && board[rank + 2 * dir][file] === 0) addMove(file, rank + 2 * dir);
    }
    for (const df of [-1, 1]) {
      const nf = file + df;
      if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
        if (pieceColor(board[nr][nf]) !== color && board[nr][nf] !== 0) addMove(nf, nr);
        if (enPassantTarget && nf === enPassantTarget.file && nr === enPassantTarget.rank) {
          addMove(nf, nr, true);
        }
      }
    }
  } else if (type === 'knight') {
    for (const [df, dr] of [
      [-2, -1],
      [-2, 1],
      [-1, -2],
      [-1, 2],
      [1, -2],
      [1, 2],
      [2, -1],
      [2, 1],
    ]) {
      addMove(file + df, rank + dr);
    }
  } else if (type === 'bishop') {
    for (const [df, dr] of [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ]) {
      for (let i = 1; i < 8; i++) {
        if (addMove(file + df * i, rank + dr * i)) break;
      }
    }
  } else if (type === 'rook') {
    for (const [df, dr] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      for (let i = 1; i < 8; i++) {
        if (addMove(file + df * i, rank + dr * i)) break;
      }
    }
  } else if (type === 'queen') {
    for (const [df, dr] of [
      [-1, -1],
      [-1, 0],
      [-1, 1],
      [0, -1],
      [0, 1],
      [1, -1],
      [1, 0],
      [1, 1],
    ]) {
      for (let i = 1; i < 8; i++) {
        if (addMove(file + df * i, rank + dr * i)) break;
      }
    }
  } else if (type === 'king') {
    for (let dr = -1; dr <= 1; dr++)
      for (let df = -1; df <= 1; df++) {
        if (dr === 0 && df === 0) continue;
        addMove(file + df, rank + dr);
      }
    // Castling
    if (file === 4 && rank === (color === 'white' ? 0 : 7)) {
      const kRight = color === 'white' ? 'wK' : 'bK';
      const qRight = color === 'white' ? 'wQ' : 'bQ';
      const rookVal = color === 'white' ? W_ROOK : B_ROOK;
      const enemy = color === 'white' ? 'black' : 'white';
      if (
        castlingRights[kRight] &&
        board[rank][5] === 0 &&
        board[rank][6] === 0 &&
        board[rank][7] === rookVal
      ) {
        if (
          !isInCheck(board, color) &&
          !isAttacked(board, 5, rank, enemy) &&
          !isAttacked(board, 6, rank, enemy)
        ) {
          moves.push({ file: 6, rank, castle: 'K' });
        }
      }
      if (
        castlingRights[qRight] &&
        board[rank][3] === 0 &&
        board[rank][2] === 0 &&
        board[rank][1] === 0 &&
        board[rank][0] === rookVal
      ) {
        if (
          !isInCheck(board, color) &&
          !isAttacked(board, 3, rank, enemy) &&
          !isAttacked(board, 2, rank, enemy)
        ) {
          moves.push({ file: 2, rank, castle: 'Q' });
        }
      }
    }
  }
  return moves;
}

function findKing(board, color) {
  const k = color === 'white' ? W_KING : B_KING;
  for (let r = 0; r < 8; r++)
    for (let f = 0; f < 8; f++) if (board[r][f] === k) return { file: f, rank: r };
  return null;
}

function isAttacked(board, file, rank, byColor) {
  if (byColor === 'white') {
    if (rank - 1 >= 0 && file - 1 >= 0 && board[rank - 1][file - 1] === W_PAWN) return true;
    if (rank - 1 >= 0 && file + 1 < 8 && board[rank - 1][file + 1] === W_PAWN) return true;
  } else {
    if (rank + 1 < 8 && file - 1 >= 0 && board[rank + 1][file - 1] === B_PAWN) return true;
    if (rank + 1 < 8 && file + 1 < 8 && board[rank + 1][file + 1] === B_PAWN) return true;
  }
  const knight = byColor === 'white' ? W_KNIGHT : B_KNIGHT;
  for (const [df, dr] of [
    [-2, -1],
    [-2, 1],
    [-1, -2],
    [-1, 2],
    [1, -2],
    [1, 2],
    [2, -1],
    [2, 1],
  ]) {
    const nf = file + df,
      nr = rank + dr;
    if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8 && board[nr][nf] === knight) return true;
  }
  const king = byColor === 'white' ? W_KING : B_KING;
  for (let dr = -1; dr <= 1; dr++)
    for (let df = -1; df <= 1; df++) {
      if (dr === 0 && df === 0) continue;
      const nf = file + df,
        nr = rank + dr;
      if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8 && board[nr][nf] === king) return true;
    }
  const bishop = byColor === 'white' ? W_BISHOP : B_BISHOP;
  const queen = byColor === 'white' ? W_QUEEN : B_QUEEN;
  for (const [df, dr] of [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ]) {
    for (let i = 1; i < 8; i++) {
      const nf = file + df * i,
        nr = rank + dr * i;
      if (nf < 0 || nf >= 8 || nr < 0 || nr >= 8) break;
      const p = board[nr][nf];
      if (p !== 0) {
        if (p === bishop || p === queen) return true;
        break;
      }
    }
  }
  const rook = byColor === 'white' ? W_ROOK : B_ROOK;
  for (const [df, dr] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ]) {
    for (let i = 1; i < 8; i++) {
      const nf = file + df * i,
        nr = rank + dr * i;
      if (nf < 0 || nf >= 8 || nr < 0 || nr >= 8) break;
      const p = board[nr][nf];
      if (p !== 0) {
        if (p === rook || p === queen) return true;
        break;
      }
    }
  }
  return false;
}

function isInCheck(board, color) {
  const k = findKing(board, color);
  if (!k) return false;
  return isAttacked(board, k.file, k.rank, color === 'white' ? 'black' : 'white');
}

// ── Mocks (hoisted by Vite) ─────────────────────────────

vi.mock('../../client/capabilities.js', () => ({
  isTouchDevice: vi.fn(() => false),
}));

vi.mock('../../client/sound.js', () => ({
  playMove: vi.fn(),
}));

vi.mock('../../client/ui.js', () => ({
  showError: vi.fn(),
}));

vi.mock('../../client/chess.mjs', () => ({
  pieceColor,
  getValidMoves,
  findKing,
  isInCheck,
}));

const stateListeners = [];
const restartListeners = [];

vi.mock('../../client/network.js', () => ({
  myRole: 'white',
  serverBoard: null,
  serverTurn: 'white',
  serverPromotingPiece: null,
  serverGameOver: false,
  castlingRights: { wK: true, wQ: true, bK: true, bQ: true },
  enPassantTarget: null,
  sendMove: vi.fn(),
  onStateUpdate(fn) {
    stateListeners.push(fn);
  },
  onRestart(fn) {
    restartListeners.push(fn);
  },
}));

// ── Setup ────────────────────────────────────────────────

function setupDOM() {
  const dom = new JSDOM(`
    <!doctype html>
    <html><body>
      <div id="board-2d-overlay">
        <div id="board-2d-container"></div>
      </div>
    </body></html>
  `);
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  document.elementFromPoint = vi.fn(() => null);
}

describe('2D board interaction', () => {
  let board2d;
  let network;
  let ui;

  async function reloadModule() {
    vi.resetModules();
    setupDOM();
    stateListeners.length = 0;
    restartListeners.length = 0;

    board2d = await import('../../client/board_2d.js');
    network = await import('../../client/network.js');
    ui = await import('../../client/ui.js');
    network.serverBoard = startingBoard();
    network.serverTurn = 'white';
    network.myRole = 'white';
    network.serverPromotingPiece = null;
    network.serverGameOver = false;
    network.castlingRights = { wK: true, wQ: true, bK: true, bQ: true };
    network.enPassantTarget = null;
    network.sendMove.mockClear();
    ui.showError.mockClear();
  }

  beforeEach(async () => {
    await reloadModule();
  });

  function gridEl() {
    return document.querySelector('.board2d-grid');
  }

  // ── Selection ──────────────────────────────────────────

  it('selects a piece on click and shows valid moves', () => {
    board2d.toggle2DBoard();
    const grid = gridEl();
    const sq = grid.children[6 * 8 + 0]; // a2 pawn
    sq.click();

    expect(sq.classList.contains('selected')).toBe(true);
    expect(grid.children[5 * 8 + 0].classList.contains('valid-move')).toBe(true); // a3
    expect(grid.children[4 * 8 + 0].classList.contains('valid-move')).toBe(true); // a4
  });

  it('deselects when clicking the same piece again', () => {
    board2d.toggle2DBoard();
    const grid = gridEl();
    const sq = grid.children[6 * 8 + 0];
    sq.click();
    sq.click();
    expect(sq.classList.contains('selected')).toBe(false);
  });

  it('executes a move on click-to-destination', () => {
    board2d.toggle2DBoard();
    const grid = gridEl();
    grid.children[6 * 8 + 0].click(); // select a2
    grid.children[5 * 8 + 0].click(); // move to a3
    expect(network.sendMove).toHaveBeenCalledWith(0, 1, 0, 2);
  });

  it('re-selects another piece when clicking invalid square with own piece', () => {
    board2d.toggle2DBoard();
    const grid = gridEl();
    const a2 = grid.children[6 * 8 + 0];
    const b2 = grid.children[6 * 8 + 1];
    a2.click();
    b2.click();
    expect(b2.classList.contains('selected')).toBe(true);
    expect(a2.classList.contains('selected')).toBe(false);
  });

  // ── Check highlighting ─────────────────────────────────

  it('does NOT highlight king when not in check', () => {
    board2d.toggle2DBoard();
    const grid = gridEl();
    const e1 = grid.children[7 * 8 + 4]; // white king
    expect(e1.classList.contains('in-check')).toBe(false);
  });

  it('highlights king when in check', () => {
    board2d.toggle2DBoard();
    // King at e1, Queen at e4 — check along file
    const board = startingBoard();
    board[0] = [0, 0, 0, 0, W_KING, 0, 0, 0];
    board[3] = [0, 0, 0, 0, B_QUEEN, 0, 0, 0];
    board[1] = [0, 0, 0, 0, 0, 0, 0, 0];
    board[2] = [0, 0, 0, 0, 0, 0, 0, 0];
    network.serverBoard = board;
    network.serverTurn = 'white';
    for (const fn of stateListeners) fn();

    const grid = gridEl();
    const e1 = grid.children[7 * 8 + 4];
    expect(e1.classList.contains('in-check')).toBe(true);
  });

  // ── Mode cycling (regression for double-click bug) ─────

  it('cycles through desktop modes without stacking click handlers', () => {
    board2d.toggle2DBoard();
    board2d.toggle2DBoard();
    board2d.toggle2DBoard();
    board2d.toggle2DBoard();

    const grid = gridEl();
    const a2 = grid.children[6 * 8 + 0];
    a2.click();
    expect(a2.classList.contains('selected')).toBe(true);
    a2.click();
    expect(a2.classList.contains('selected')).toBe(false);
  });

  // ── Game state guards ──────────────────────────────────

  it('does not allow interaction when game is over', () => {
    board2d.toggle2DBoard();
    network.serverGameOver = true;
    gridEl().children[6 * 8 + 0].click();
    expect(gridEl().children[6 * 8 + 0].classList.contains('selected')).toBe(false);
  });

  it('does not allow interaction during promotion', () => {
    board2d.toggle2DBoard();
    network.serverPromotingPiece = { file: 0, rank: 7, color: 'white' };
    gridEl().children[6 * 8 + 0].click();
    expect(gridEl().children[6 * 8 + 0].classList.contains('selected')).toBe(false);
  });

  it('does not allow selecting opponent pieces', () => {
    board2d.toggle2DBoard();
    gridEl().children[1 * 8 + 0].click(); // black pawn
    expect(gridEl().children[1 * 8 + 0].classList.contains('selected')).toBe(false);
  });

  it('shows error when clicking own piece on opponent turn', () => {
    board2d.toggle2DBoard();
    network.serverTurn = 'black';
    gridEl().children[6 * 8 + 0].click();
    expect(ui.showError).toHaveBeenCalledWith('Not your turn');
  });

  // ── Stale selection cleared on state update ────────────

  it('clears stale selection after turn-changing state update', () => {
    board2d.toggle2DBoard();
    const grid = gridEl();
    const a2 = grid.children[6 * 8 + 0];
    const a3 = grid.children[5 * 8 + 0];

    a2.click(); // select a2
    expect(a2.classList.contains('selected')).toBe(true);

    // Simulate opponent's move — turn changes to black
    network.serverTurn = 'black';
    for (const fn of stateListeners) fn();

    // Selection should be cleared
    expect(gridEl().children[6 * 8 + 0].classList.contains('selected')).toBe(false);

    // Clicking the old destination (empty square) on opponent turn shows error
    const a3After = gridEl().children[5 * 8 + 0];
    a3After.click();
    expect(network.sendMove).not.toHaveBeenCalled();
    expect(ui.showError).toHaveBeenCalledWith('Not your turn');
  });

  // ── Click-through prevention ───────────────────────────

  it('sets pointer-events: auto on visible overlay', () => {
    board2d.toggle2DBoard();
    const overlay = document.getElementById('board-2d-overlay');
    expect(overlay.classList.contains('visible')).toBe(true);
    const style = globalThis.window.getComputedStyle(overlay);
    expect(style.pointerEvents).toBe('auto');
  });

  // ── State update clears selection ──────────────────────

  it('clears selection on restart', () => {
    board2d.toggle2DBoard();
    gridEl().children[6 * 8 + 0].click();
    for (const fn of restartListeners) fn();
    expect(gridEl().children[6 * 8 + 0].classList.contains('selected')).toBe(false);
  });

  // ── Drag ghost ─────────────────────────────────────────

  it('creates a drag ghost element during committed drag', () => {
    board2d.toggle2DBoard();
    const a2 = gridEl().children[6 * 8 + 0];

    a2.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100, button: 0 })
    );
    document.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: 120, clientY: 120 })
    );

    expect(document.querySelector('.board2d-drag-ghost')).toBeTruthy();
    expect(a2.querySelector('.board2d-piece').style.visibility).toBe('hidden');

    document.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, clientX: 120, clientY: 120 })
    );
  });

  it('removes drag ghost on mouseup', () => {
    board2d.toggle2DBoard();
    const a2 = gridEl().children[6 * 8 + 0];

    a2.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100, button: 0 })
    );
    document.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: 120, clientY: 120 })
    );
    document.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, clientX: 120, clientY: 120 })
    );

    expect(document.querySelector('.board2d-drag-ghost')).toBeNull();
  });

  it('ghost piece preserves the computed font-size of the original', () => {
    board2d.toggle2DBoard();
    const a2 = gridEl().children[6 * 8 + 0];
    const pieceEl = a2.querySelector('.board2d-piece');
    const originalSize = getComputedStyle(pieceEl).fontSize;

    a2.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100, button: 0 })
    );
    document.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: 120, clientY: 120 })
    );

    const ghost = document.querySelector('.board2d-drag-ghost');
    expect(ghost.style.fontSize).toBe(originalSize);

    document.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, clientX: 120, clientY: 120 })
    );
  });

  it('restores original piece visibility after invalid drag drop', () => {
    board2d.toggle2DBoard();
    const a2 = gridEl().children[6 * 8 + 0];
    const pieceEl = a2.querySelector('.board2d-piece');

    a2.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100, button: 0 })
    );
    document.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: 120, clientY: 120 })
    );
    expect(pieceEl.style.visibility).toBe('hidden');

    document.elementFromPoint = vi.fn(() => null);
    document.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, clientX: 120, clientY: 120 })
    );

    expect(pieceEl.style.visibility).toBe('');
    expect(document.querySelector('.board2d-drag-ghost')).toBeNull();
  });

  // ── Drag completed suppression scoped to one click ─────

  it('next board click works after invalid drop outside board', async () => {
    board2d.toggle2DBoard();
    const a2 = gridEl().children[6 * 8 + 0];

    a2.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100, button: 0 })
    );
    document.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: 120, clientY: 120 })
    );

    document.elementFromPoint = vi.fn(() => null);
    document.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, clientX: 999, clientY: 999 })
    );

    // Simulate the one-shot click suppressor firing (JSDOM doesn't auto-fire it)
    document.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // Next click on board should work
    const b2 = gridEl().children[6 * 8 + 1];
    b2.click();
    expect(b2.classList.contains('selected')).toBe(true);
  });

  // ── Touch drag ─────────────────────────────────────────

  it('touch drag commits and executes a valid move', () => {
    board2d.toggle2DBoard();
    const grid = gridEl();
    const a2 = grid.children[6 * 8 + 0];
    const a3 = grid.children[5 * 8 + 0];

    // onTouchStart uses findSquareUnderEvent() → document.elementFromPoint()
    // Must return the source square so the touch is registered
    document.elementFromPoint = vi.fn(() => a2);

    const touch = { identifier: 0, clientX: 100, clientY: 100 };
    const ts = new Event('touchstart', { bubbles: true });
    ts.changedTouches = [touch];
    a2.dispatchEvent(ts);

    const moveTouch = { identifier: 0, clientX: 120, clientY: 120 };
    const tm = new Event('touchmove', { bubbles: true, cancelable: true });
    tm.touches = [moveTouch];
    tm.changedTouches = [moveTouch];
    document.dispatchEvent(tm);

    expect(document.querySelector('.board2d-drag-ghost')).toBeTruthy();

    document.elementFromPoint = vi.fn(() => a3);
    const endTouch = { identifier: 0, clientX: 120, clientY: 140 };
    const te = new Event('touchend', { bubbles: true, cancelable: true });
    te.changedTouches = [endTouch];
    document.dispatchEvent(te);

    expect(network.sendMove).toHaveBeenCalledWith(0, 1, 0, 2);
  });

  it('touch drag restores piece on invalid drop', () => {
    board2d.toggle2DBoard();
    const a2 = gridEl().children[6 * 8 + 0];
    const pieceEl = a2.querySelector('.board2d-piece');

    // onTouchStart uses findSquareUnderEvent() → document.elementFromPoint()
    document.elementFromPoint = vi.fn(() => a2);

    const touch = { identifier: 0, clientX: 100, clientY: 100 };
    const ts = new Event('touchstart', { bubbles: true });
    ts.changedTouches = [touch];
    a2.dispatchEvent(ts);

    const moveTouch = { identifier: 0, clientX: 120, clientY: 120 };
    const tm = new Event('touchmove', { bubbles: true, cancelable: true });
    tm.touches = [moveTouch];
    tm.changedTouches = [moveTouch];
    document.dispatchEvent(tm);

    expect(pieceEl.style.visibility).toBe('hidden');

    document.elementFromPoint = vi.fn(() => null);
    const endTouch = { identifier: 0, clientX: 120, clientY: 140 };
    const te = new Event('touchend', { bubbles: true, cancelable: true });
    te.changedTouches = [endTouch];
    document.dispatchEvent(te);

    expect(pieceEl.style.visibility).toBe('');
  });

  // ── Special moves: castling ────────────────────────────

  it('shows castling as a valid move for king', () => {
    board2d.toggle2DBoard();
    // Clear f1 and g1 so castling path is open
    const board = startingBoard();
    board[0][5] = 0; // f1 empty
    board[0][6] = 0; // g1 empty
    network.serverBoard = board;
    network.castlingRights = { wK: true, wQ: true, bK: true, bQ: true };
    for (const fn of stateListeners) fn();

    const grid = gridEl();
    const e1 = grid.children[7 * 8 + 4]; // white king
    e1.click();

    // Kingside castle target: g1 (rank=0, file=6)
    const g1 = grid.children[7 * 8 + 6];
    expect(g1.classList.contains('valid-move')).toBe(true);
  });

  // ── Special moves: en passant ──────────────────────────

  it('shows en passant as a valid capture move', () => {
    board2d.toggle2DBoard();
    const board = startingBoard();
    board[4][4] = W_PAWN; // white pawn at e5
    board[4][3] = B_PAWN; // black pawn at d5
    board[1] = [0, 0, 0, 0, 0, 0, 0, 0];
    board[6] = [0, 0, 0, 0, 0, 0, 0, 0];
    network.serverBoard = board;
    network.serverTurn = 'white';
    // enPassantTarget is the capture square (d6 = file 3, rank 5)
    network.enPassantTarget = { file: 3, rank: 5 };

    for (const fn of stateListeners) fn();

    const grid = gridEl();
    const e5 = grid.children[3 * 8 + 4];
    e5.click();

    const d6 = grid.children[2 * 8 + 3];
    expect(d6.classList.contains('capture-move')).toBe(true);
  });
});
