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
  isCoarsePointer: vi.fn(() => false),
  isMobilePhone: vi.fn(() => false),
  isMobileLayout: vi.fn(() => false),
}));

vi.mock('../../client/pieces.js', () => ({
  setSvgPieceSet: vi.fn(),
  getModelSet: () => 'simple-classic',
  setModelSet: vi.fn(),
  SVG_PIECE_SETS: ['mpchess', 'maestro', 'dubrovny'],
  MODEL_SETS: ['simple-classic', 'low-poly', 'jeu'],
  getPieceSvgUrl(pieceId) {
    const files = {
      1: 'wP',
      2: 'wN',
      3: 'wB',
      4: 'wR',
      5: 'wQ',
      6: 'wK',
      7: 'bP',
      8: 'bN',
      9: 'bB',
      10: 'bR',
      11: 'bQ',
      12: 'bK',
    };
    return `files/pieces/2d/mpchess/${files[pieceId]}.svg`;
  },
}));

vi.mock('../../client/sound.js', () => ({
  playMove: vi.fn(),
}));

vi.mock('../../client/ui.js', () => ({
  showError: vi.fn(),
  showPromotionPicker: vi.fn(),
  setThreeScene: vi.fn(),
}));

vi.mock('../../shared/chess.mjs', async () => {
  // Use the real permissive premove generator and pieceType so candidate
  // tests exercise the actual engine behavior; keep the local legal-move
  // generator used by the pre-existing on-turn tests.
  const actual = await vi.importActual('../../shared/chess.mjs');
  return {
    pieceColor,
    getValidMoves,
    getPremoveMoves: actual.getPremoveMoves,
    pieceType: actual.pieceType,
    findKing,
    isInCheck,
  };
});

const stateListeners = [];
const restartListeners = [];

vi.mock('../../client/network.js', () => {
  // Model the real cancelPremove(): exactly one protocol send
  // (sendPremoveCancel) plus one optimistic local clear (the clear lives in
  // premove.js, which is not mocked here). The send is the observable
  // protocol effect the cancellation tests assert on.
  const sendPremoveCancel = vi.fn();
  const cancelPremove = vi.fn(() => {
    sendPremoveCancel();
  });
  return {
    onEvaluation: vi.fn(),
    serverEvaluation: null,
    myRole: 'white',
    serverBoard: null,
    serverTurn: 'white',
    serverPromotingPiece: null,
    serverGameOver: false,
    castlingRights: { wK: true, wQ: true, bK: true, bQ: true },
    enPassantTarget: null,
    previousMove: null,
    sendMove: vi.fn(),
    sendPremove: vi.fn(),
    sendPremoveCancel,
    cancelPremove,
    debugEnabled: false,
    onStateUpdate(fn) {
      stateListeners.push(fn);
    },
    onRestart(fn) {
      restartListeners.push(fn);
    },
    onPromotion() {},
  };
});

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

  // Mock ResizeObserver (not available in JSDOM)
  if (!globalThis.window.ResizeObserver) {
    globalThis.window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
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
    network.sendPremove.mockClear();
    network.sendPremoveCancel.mockClear();
    network.cancelPremove.mockClear();
    ui.showError.mockClear();
    ui.showPromotionPicker.mockClear();
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

  // ── Check persistence during selection ─────────────────
  // Regression: select/deselect redraw previous/selection after
  // clearHighlights(), which resets the checked king to base. The
  // orchestrator must re-apply the check highlight on every path so the
  // checked king survives regardless of event order (check > selection).

  // White king e1 in check from the black queen on e4 (white to move).
  function whiteInCheckBoard() {
    const board = startingBoard();
    board[0] = [0, 0, 0, 0, W_KING, 0, 0, 0];
    board[3] = [0, 0, 0, 0, B_QUEEN, 0, 0, 0];
    board[1] = [W_PAWN, 0, 0, 0, 0, 0, 0, 0]; // keep a2 for selection
    board[2] = [0, 0, 0, 0, 0, 0, 0, 0];
    return board;
  }

  // Black king e8 in check from the white queen on e4 (black to move).
  function blackInCheckBoard() {
    const board = Array.from({ length: 8 }, () => Array(8).fill(0));
    board[1][0] = W_PAWN; // a2 (white, off-turn premove source)
    board[7][4] = B_KING; // e8
    board[3][4] = W_QUEEN; // e4
    return board;
  }

  it('normal selection keeps the checked king highlighted (check before selection)', () => {
    board2d.toggle2DBoard();
    network.serverBoard = whiteInCheckBoard();
    network.serverTurn = 'white';
    for (const fn of stateListeners) fn();

    const grid = gridEl();
    const e1 = grid.children[7 * 8 + 4];
    expect(e1.classList.contains('in-check')).toBe(true);

    grid.children[6 * 8 + 0].click(); // select a2
    const a2 = grid.children[6 * 8 + 0];
    expect(a2.classList.contains('selected')).toBe(true);
    // The checked king survives the selection redraw.
    expect(e1.classList.contains('in-check')).toBe(true);
  });

  it('premove selection keeps the checked king highlighted (check before selection)', () => {
    board2d.toggle2DBoard();
    network.serverBoard = blackInCheckBoard();
    network.serverTurn = 'black'; // white is off-turn → premove mode
    for (const fn of stateListeners) fn();

    const grid = gridEl();
    const e8 = grid.children[0 * 8 + 4]; // display row 0 = rank 7
    expect(e8.classList.contains('in-check')).toBe(true);

    grid.children[6 * 8 + 0].click(); // premove-select a2
    const a2 = grid.children[6 * 8 + 0];
    expect(a2.classList.contains('premove-selected')).toBe(true);
    // The checked king survives the premove-selection redraw.
    expect(e8.classList.contains('in-check')).toBe(true);
  });

  it('a state update arriving after a selection shows the check (selection before check)', () => {
    board2d.toggle2DBoard();
    const grid = gridEl();
    grid.children[6 * 8 + 0].click(); // select a2 (no check yet)
    expect(grid.children[6 * 8 + 0].classList.contains('selected')).toBe(true);

    // Server state flips to a position where white is in check.
    network.serverBoard = whiteInCheckBoard();
    network.serverTurn = 'white';
    for (const fn of stateListeners) fn();

    // renderBoard() rebuilds the grid — re-query the live board.
    const live = gridEl();
    const e1 = live.children[7 * 8 + 4];
    expect(e1.classList.contains('in-check')).toBe(true);
    // The state update clears the stale selection (onStateUpdate → clearSelection).
    expect(live.children[6 * 8 + 0].classList.contains('selected')).toBe(false);
  });

  it('a state update arriving after a premove selection shows the check (premove selection before check)', () => {
    board2d.toggle2DBoard();
    // Black to move (white off-turn → premove mode), no check yet.
    const board = Array.from({ length: 8 }, () => Array(8).fill(0));
    board[1][0] = W_PAWN; // a2
    board[7][4] = B_KING; // e8
    board[3][3] = W_QUEEN; // d4 (not attacking e8)
    network.serverBoard = board;
    network.serverTurn = 'black';
    for (const fn of stateListeners) fn();

    const grid = gridEl();
    grid.children[6 * 8 + 0].click(); // premove-select a2
    expect(grid.children[6 * 8 + 0].classList.contains('premove-selected')).toBe(true);

    // Server state flips to a position where the black king is in check.
    const checkBoard = Array.from({ length: 8 }, () => Array(8).fill(0));
    checkBoard[1][0] = W_PAWN; // a2
    checkBoard[7][4] = B_KING; // e8
    checkBoard[3][4] = W_QUEEN; // e4 (now attacking e8)
    network.serverBoard = checkBoard;
    network.serverTurn = 'black';
    for (const fn of stateListeners) fn();

    // renderBoard() rebuilds the grid — re-query the live board.
    const live = gridEl();
    const e8 = live.children[0 * 8 + 4]; // display row 0 = rank 7
    expect(e8.classList.contains('in-check')).toBe(true);
    // The state update clears the stale premove selection (onStateUpdate → clearSelection).
    expect(live.children[6 * 8 + 0].classList.contains('premove-selected')).toBe(false);
  });

  it('deselecting while in check keeps the checked king highlighted', () => {
    board2d.toggle2DBoard();
    network.serverBoard = whiteInCheckBoard();
    network.serverTurn = 'white';
    for (const fn of stateListeners) fn();

    const grid = gridEl();
    grid.children[6 * 8 + 0].click(); // select a2
    grid.children[6 * 8 + 0].click(); // deselect
    const a2 = grid.children[6 * 8 + 0];
    expect(a2.classList.contains('selected')).toBe(false);
    // The checked king is still highlighted after deselect.
    expect(grid.children[7 * 8 + 4].classList.contains('in-check')).toBe(true);
  });

  it('selecting the checked king itself keeps the check highlight (check outranks selection)', () => {
    board2d.toggle2DBoard();
    network.serverBoard = whiteInCheckBoard();
    network.serverTurn = 'white';
    for (const fn of stateListeners) fn();

    const grid = gridEl();
    const e1 = grid.children[7 * 8 + 4]; // the checked king
    e1.click(); // select the king itself
    // Both classes land on the same square; the check must remain present
    // (and wins visually via CSS precedence: .in-check after .selected).
    expect(e1.classList.contains('selected')).toBe(true);
    expect(e1.classList.contains('in-check')).toBe(true);
  });

  it('clears the check highlight when the server state resolves the check', () => {
    board2d.toggle2DBoard();
    network.serverBoard = whiteInCheckBoard();
    network.serverTurn = 'white';
    for (const fn of stateListeners) fn();
    expect(gridEl().children[7 * 8 + 4].classList.contains('in-check')).toBe(true);

    // Server state resolves the check (queen captured / moved away).
    network.serverBoard = startingBoard();
    network.serverTurn = 'white';
    for (const fn of stateListeners) fn();
    // renderBoard() rebuilds the grid — re-query the live board.
    expect(gridEl().children[7 * 8 + 4].classList.contains('in-check')).toBe(false);
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

  it('selects own piece off-turn in premove mode (no error toast)', () => {
    board2d.toggle2DBoard();
    network.serverTurn = 'black';
    const a2 = gridEl().children[6 * 8 + 0];
    a2.click();
    expect(a2.classList.contains('premove-selected')).toBe(true);
    expect(a2.classList.contains('selected')).toBe(false);
    expect(ui.showError).not.toHaveBeenCalled();
    expect(network.sendMove).not.toHaveBeenCalled();
    expect(network.sendPremove).not.toHaveBeenCalled();
  });

  it('shows error when clicking enemy piece on opponent turn', () => {
    board2d.toggle2DBoard();
    network.serverTurn = 'black';
    const a7 = gridEl().children[1 * 8 + 0]; // black pawn
    a7.click();
    expect(a7.classList.contains('premove-selected')).toBe(false);
    expect(ui.showError).toHaveBeenCalledWith('Not your turn');
    expect(network.sendPremove).not.toHaveBeenCalled();
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

    // Clicking the old destination (empty square) on opponent turn just
    // deselects — no move, no premove, no error toast
    const a3After = gridEl().children[5 * 8 + 0];
    a3After.click();
    expect(network.sendMove).not.toHaveBeenCalled();
    expect(network.sendPremove).not.toHaveBeenCalled();
    expect(ui.showError).not.toHaveBeenCalled();
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

  it('ghost piece preserves the computed size of the original', () => {
    board2d.toggle2DBoard();
    const a2 = gridEl().children[6 * 8 + 0];
    const pieceEl = a2.querySelector('.board2d-piece');
    const originalW = getComputedStyle(pieceEl).width;
    const originalH = getComputedStyle(pieceEl).height;

    a2.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100, button: 0 })
    );
    document.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: 120, clientY: 120 })
    );

    const ghost = document.querySelector('.board2d-drag-ghost');
    expect(ghost.style.width).toBe(originalW);
    expect(ghost.style.height).toBe(originalH);

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

  // ── Right-click annotations ────────────────────────────

  it('right-click on different squares draws arrow even within pixel threshold', async () => {
    board2d.toggle2DBoard();
    const arrows = await import('../../client/arrows.js');
    const highlights = await import('../../client/highlights.js');
    arrows.clearArrows();
    highlights.clearHighlights();

    const grid = gridEl();
    const container = grid.closest('#board-2d-container');

    // Mock grid bounding rect: 800x800, each square is 100x100
    grid.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 800,
      bottom: 800,
      width: 800,
      height: 800,
    });

    // Right-click mousedown just inside display row 6 (y=601)
    container.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, button: 2, clientX: 50, clientY: 601 })
    );

    // Right-click mouseup just inside display row 5 (y=599) — only 2px displacement, below DRAG_THRESHOLD
    // But different square, so must be arrow
    document.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, button: 2, clientX: 50, clientY: 599 })
    );

    expect(arrows.getArrows()).toHaveLength(1);
    expect(highlights.getHighlights()).toHaveLength(0);
  });

  it('right-click release off board creates no annotation', async () => {
    board2d.toggle2DBoard();
    const arrows = await import('../../client/arrows.js');
    const highlights = await import('../../client/highlights.js');
    arrows.clearArrows();
    highlights.clearHighlights();

    const grid = gridEl();
    const container = grid.closest('#board-2d-container');

    // Mock grid bounding rect so mousedown establishes arrowStart
    grid.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 800,
      bottom: 800,
      width: 800,
      height: 800,
    });

    // Right-click mousedown on board
    container.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, button: 2, clientX: 50, clientY: 650 })
    );

    // Right-click mouseup off the board (far outside)
    document.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, button: 2, clientX: 9999, clientY: 9999 })
    );

    expect(arrows.getArrows()).toHaveLength(0);
    expect(highlights.getHighlights()).toHaveLength(0);
  });

  // ── Premove (off-turn) interaction ─────────────────────

  it('off-turn own-piece selection shows premove candidates, not legal-move classes', () => {
    board2d.toggle2DBoard();
    network.serverTurn = 'black';
    const grid = gridEl();
    const a2 = grid.children[6 * 8 + 0];
    a2.click();

    expect(a2.classList.contains('premove-selected')).toBe(true);
    expect(a2.classList.contains('selected')).toBe(false);
    // a3 and a4 are premove candidates (two-step from the starting rank)
    expect(grid.children[5 * 8 + 0].classList.contains('premove-move')).toBe(true);
    expect(grid.children[4 * 8 + 0].classList.contains('premove-move')).toBe(true);
    // Normal legal-selection classes must not be used for premove candidates
    expect(grid.children[5 * 8 + 0].classList.contains('valid-move')).toBe(false);
    expect(grid.children[4 * 8 + 0].classList.contains('valid-move')).toBe(false);
  });

  it('off-turn empty-square click deselects without a toast', () => {
    board2d.toggle2DBoard();
    network.serverTurn = 'black';
    const grid = gridEl();
    grid.children[6 * 8 + 0].click(); // select a2 (premove)
    expect(grid.children[6 * 8 + 0].classList.contains('premove-selected')).toBe(true);

    // e4 is empty and not a candidate for the a2 pawn
    grid.children[4 * 8 + 4].click();
    expect(grid.children[6 * 8 + 0].classList.contains('premove-selected')).toBe(false);
    expect(ui.showError).not.toHaveBeenCalled();
    expect(network.sendPremove).not.toHaveBeenCalled();
  });

  it('premove candidates are permissive: a pinned piece still gets candidates', () => {
    board2d.toggle2DBoard();
    // White Ke1 + Nd2, black Ba5 on the a5–e1 diagonal → knight is pinned
    const board = Array.from({ length: 8 }, () => Array(8).fill(0));
    board[0][4] = W_KING;
    board[1][3] = W_KNIGHT;
    board[4][0] = B_BISHOP;
    board[7][4] = B_KING;
    network.serverBoard = board;
    network.serverTurn = 'black';
    for (const fn of stateListeners) fn();

    const grid = gridEl();
    // d2 = file 3, rank 1 → display row 6, col 3
    const d2 = grid.children[6 * 8 + 3];
    d2.click();

    expect(d2.classList.contains('premove-selected')).toBe(true);
    // The pinned knight has 0 legal moves but 6 premove candidates
    const candidates = [...grid.children].filter(
      (sq) => sq.classList.contains('premove-move') || sq.classList.contains('premove-capture')
    );
    expect(candidates).toHaveLength(6);
  });

  it('premove candidates include a recapture onto a friendly-occupied square', () => {
    board2d.toggle2DBoard();
    // White Ra1 blocked by friendly pawns on a2 and b1: the rook has no
    // legal moves, but both friendly-occupied squares are premove
    // recapture candidates (the opponent may capture them and finish there).
    const board = Array.from({ length: 8 }, () => Array(8).fill(0));
    board[0][0] = W_ROOK;
    board[1][0] = W_PAWN; // a2 — blocks the file
    board[0][1] = W_PAWN; // b1 — blocks the rank
    board[0][4] = W_KING;
    board[7][4] = B_KING;
    network.serverBoard = board;
    network.serverTurn = 'black';
    for (const fn of stateListeners) fn();

    // The rook has no legal moves (both in-board directions are blocked)
    const rights = { wK: true, wQ: true, bK: true, bQ: true };
    expect(
      getValidMoves(
        board.map((r) => [...r]),
        0,
        0,
        rights,
        null
      )
    ).toHaveLength(0);

    const grid = gridEl();
    const a1 = grid.children[7 * 8 + 0];
    a1.click();

    expect(a1.classList.contains('premove-selected')).toBe(true);
    // a2 and b1 (friendly-occupied) are premove recapture candidates
    expect(grid.children[6 * 8 + 0].classList.contains('premove-capture')).toBe(true);
    expect(grid.children[7 * 8 + 1].classList.contains('premove-capture')).toBe(true);
    const candidates = [...grid.children].filter(
      (sq) => sq.classList.contains('premove-move') || sq.classList.contains('premove-capture')
    );
    expect(candidates).toHaveLength(2);
  });

  it('premove candidates include a pawn destination occupied by an enemy piece', () => {
    board2d.toggle2DBoard();
    // White pawn d2 with an enemy knight on d3: the one-step forward is a
    // candidate (the opponent may vacate d3) even though it is not legal now.
    const board = Array.from({ length: 8 }, () => Array(8).fill(0));
    board[1][3] = W_PAWN;
    board[2][3] = B_KNIGHT;
    board[0][4] = W_KING;
    board[7][4] = B_KING;
    network.serverBoard = board;
    network.serverTurn = 'black';
    for (const fn of stateListeners) fn();

    const grid = gridEl();
    const d2 = grid.children[6 * 8 + 3];
    d2.click();

    expect(d2.classList.contains('premove-selected')).toBe(true);
    // d3 (enemy-occupied) is a capture candidate; d4 is also a candidate
    // (two-step: the opponent's single move can vacate d3); the forward
    // diagonals c3/e3 are candidates too (the opponent may move a piece
    // onto them, making them captures)
    expect(grid.children[5 * 8 + 3].classList.contains('premove-capture')).toBe(true);
    expect(grid.children[4 * 8 + 3].classList.contains('premove-move')).toBe(true);
    expect(grid.children[5 * 8 + 2].classList.contains('premove-move')).toBe(true); // c3
    expect(grid.children[5 * 8 + 4].classList.contains('premove-move')).toBe(true); // e3
    const candidates = [...grid.children].filter(
      (sq) => sq.classList.contains('premove-move') || sq.classList.contains('premove-capture')
    );
    expect(candidates).toHaveLength(4);
  });

  it('premove two-step is excluded when both path squares are enemy-occupied', () => {
    board2d.toggle2DBoard();
    // White pawn d2 with enemy pieces on d3 AND d4: one opponent move cannot
    // vacate two squares, so the two-step is a dead candidate.
    const board = Array.from({ length: 8 }, () => Array(8).fill(0));
    board[1][3] = W_PAWN;
    board[2][3] = B_KNIGHT;
    board[3][3] = B_PAWN;
    board[0][4] = W_KING;
    board[7][4] = B_KING;
    network.serverBoard = board;
    network.serverTurn = 'black';
    for (const fn of stateListeners) fn();

    const grid = gridEl();
    const d2 = grid.children[6 * 8 + 3];
    d2.click();

    expect(d2.classList.contains('premove-selected')).toBe(true);
    // d3 (enemy-occupied) is a capture candidate and the forward diagonals
    // c3/e3 are candidates, but the two-step d4 is not (one opponent move
    // cannot vacate two squares)
    expect(grid.children[5 * 8 + 3].classList.contains('premove-capture')).toBe(true);
    expect(grid.children[4 * 8 + 3].classList.contains('premove-move')).toBe(false);
    expect(grid.children[5 * 8 + 2].classList.contains('premove-move')).toBe(true); // c3
    expect(grid.children[5 * 8 + 4].classList.contains('premove-move')).toBe(true); // e3
    const candidates = [...grid.children].filter(
      (sq) => sq.classList.contains('premove-move') || sq.classList.contains('premove-capture')
    );
    expect(candidates).toHaveLength(3);
  });

  it('off-turn click on a candidate destination sends premove, not move', () => {
    board2d.toggle2DBoard();
    network.serverTurn = 'black';
    const grid = gridEl();
    grid.children[6 * 8 + 0].click(); // select a2 (premove)
    grid.children[5 * 8 + 0].click(); // a3
    expect(network.sendPremove).toHaveBeenCalledWith(0, 1, 0, 2);
    expect(network.sendMove).not.toHaveBeenCalled();
    // Selection is cleared after completion
    expect(grid.children[6 * 8 + 0].classList.contains('premove-selected')).toBe(false);
  });

  it('off-turn click on a non-candidate own piece re-selects it', () => {
    board2d.toggle2DBoard();
    network.serverTurn = 'black';
    const grid = gridEl();
    const a2 = grid.children[6 * 8 + 0];
    const b2 = grid.children[6 * 8 + 1];
    a2.click();
    b2.click(); // b2 is not a candidate for the a2 pawn
    expect(b2.classList.contains('premove-selected')).toBe(true);
    expect(a2.classList.contains('premove-selected')).toBe(false);
    expect(network.sendPremove).not.toHaveBeenCalled();
  });

  it('off-turn drag on own piece completes as premove', () => {
    board2d.toggle2DBoard();
    network.serverTurn = 'black';
    const grid = gridEl();
    const a2 = grid.children[6 * 8 + 0];
    const a3 = grid.children[5 * 8 + 0];

    a2.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100, button: 0 })
    );
    document.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: 120, clientY: 120 })
    );
    expect(document.querySelector('.board2d-drag-ghost')).toBeTruthy();

    document.elementFromPoint = vi.fn(() => a3);
    document.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, clientX: 120, clientY: 120 })
    );

    expect(network.sendPremove).toHaveBeenCalledWith(0, 1, 0, 2);
    expect(network.sendMove).not.toHaveBeenCalled();
    expect(document.querySelector('.board2d-drag-ghost')).toBeNull();
  });

  it('off-turn touch drag on own piece completes as premove', () => {
    board2d.toggle2DBoard();
    network.serverTurn = 'black';
    const grid = gridEl();
    const a2 = grid.children[6 * 8 + 0];
    const a3 = grid.children[5 * 8 + 0];

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

    expect(network.sendPremove).toHaveBeenCalledWith(0, 1, 0, 2);
    expect(network.sendMove).not.toHaveBeenCalled();
  });

  it('late turn flip between selection and completion still sends premove', () => {
    board2d.toggle2DBoard();
    network.serverTurn = 'black';
    const grid = gridEl();
    grid.children[6 * 8 + 0].click(); // select a2 off-turn (premove mode)

    // The turn has flipped on the server, but the client state is stale
    // (no state update processed yet) — the selection is still in premove
    // mode, so the completion must send `premove` (the server decides
    // execute-now vs store).
    network.serverTurn = 'white';

    grid.children[5 * 8 + 0].click(); // complete on a3
    expect(network.sendPremove).toHaveBeenCalledWith(0, 1, 0, 2);
    expect(network.sendMove).not.toHaveBeenCalled();
  });

  it('on-turn click-to-move still sends move (regression)', () => {
    board2d.toggle2DBoard();
    network.serverTurn = 'white';
    const grid = gridEl();
    grid.children[6 * 8 + 0].click(); // select a2
    grid.children[5 * 8 + 0].click(); // a3
    expect(network.sendMove).toHaveBeenCalledWith(0, 1, 0, 2);
    expect(network.sendPremove).not.toHaveBeenCalled();
  });

  it('on-turn selection uses legal classes, not premove classes (regression)', () => {
    board2d.toggle2DBoard();
    network.serverTurn = 'white';
    const grid = gridEl();
    const a2 = grid.children[6 * 8 + 0];
    a2.click();
    expect(a2.classList.contains('selected')).toBe(true);
    expect(a2.classList.contains('premove-selected')).toBe(false);
    expect(grid.children[5 * 8 + 0].classList.contains('valid-move')).toBe(true);
    expect(grid.children[5 * 8 + 0].classList.contains('premove-move')).toBe(false);
  });

  it('off-turn pawn premove to a promotion rank opens the picker in premove mode', () => {
    board2d.toggle2DBoard();
    const board = Array.from({ length: 8 }, () => Array(8).fill(0));
    board[6][4] = W_PAWN; // white pawn e7 (file 4, rank 6)
    board[0][4] = W_KING;
    board[7][4] = B_KING;
    network.serverBoard = board;
    network.serverTurn = 'black';
    for (const fn of stateListeners) fn();

    const grid = gridEl();
    const e7 = grid.children[1 * 8 + 4];
    e7.click(); // select e7 pawn (premove)
    expect(e7.classList.contains('premove-selected')).toBe(true);

    const e8 = grid.children[0 * 8 + 4]; // promotion destination
    e8.click();

    expect(ui.showPromotionPicker).toHaveBeenCalledWith(4, 7, 'white', {
      mode: 'premove',
      fromFile: 4,
      fromRank: 6,
      toFile: 4,
      toRank: 7,
    });
    // Nothing is sent until the picker choice
    expect(network.sendPremove).not.toHaveBeenCalled();
    expect(network.sendMove).not.toHaveBeenCalled();
  });

  // ── Premove visuals + cancellation (2D) ───────────────

  describe('premove visuals + cancellation', () => {
    let premove;

    // Synchronous rAF + mocked geometry so the arrow SVG actually renders.
    function mockArrowGeometry() {
      const syncRaf = (cb) => {
        cb();
        return 0;
      };
      globalThis.window.requestAnimationFrame = syncRaf;
      globalThis.window.cancelAnimationFrame = () => {};
      globalThis.requestAnimationFrame = syncRaf;
      globalThis.cancelAnimationFrame = () => {};

      const grid = gridEl();
      const container = grid.closest('#board-2d-container');
      container.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        right: 800,
        bottom: 800,
        width: 800,
        height: 800,
      });
      for (const sq of grid.children) {
        const file = parseInt(sq.dataset.file, 10);
        const rank = parseInt(sq.dataset.rank, 10);
        // White standard orientation: displayFile = file, displayRank = 7 - rank
        const displayFile = file;
        const displayRank = 7 - rank;
        sq.getBoundingClientRect = () => ({
          left: displayFile * 100,
          top: displayRank * 100,
          right: displayFile * 100 + 100,
          bottom: displayRank * 100 + 100,
          width: 100,
          height: 100,
        });
      }
    }

    function premoveArrowEl() {
      return document.querySelector('[data-premove-arrow]');
    }

    function annotationArrowCount() {
      const svg = document.querySelector('#board-2d-container svg');
      if (!svg) return 0;
      return [...svg.children].filter((g) => !g.hasAttribute('data-premove-arrow')).length;
    }

    // e2 (file 4, rank 1) → e4 (file 4, rank 3)
    const E2 = { fromFile: 4, fromRank: 1, toFile: 4, toRank: 3 };
    const E2_DISPLAY = 6 * 8 + 4; // display row 6, col 4
    const E4_DISPLAY = 4 * 8 + 4; // display row 4, col 4

    beforeEach(async () => {
      premove = await import('../../client/premove.js');
    });

    // ── Square classes ───────────────────────────────────

    it('confirmed premove fills origin (premove-from) and destination (premove-to)', () => {
      board2d.toggle2DBoard();
      const grid = gridEl();
      premove.setPremove(E2);
      expect(grid.children[E2_DISPLAY].classList.contains('premove-from')).toBe(true);
      expect(grid.children[E4_DISPLAY].classList.contains('premove-to')).toBe(true);
      // No other square carries the confirmed fills
      expect(grid.children[6 * 8 + 0].classList.contains('premove-from')).toBe(false);
      expect(grid.children[6 * 8 + 0].classList.contains('premove-to')).toBe(false);
    });

    it('premove-selected/move/capture are selection classes, distinct from confirmed fills', () => {
      board2d.toggle2DBoard();
      network.serverTurn = 'black';
      const grid = gridEl();
      grid.children[6 * 8 + 0].click(); // select a2 (premove mode)
      const a2 = grid.children[6 * 8 + 0];
      expect(a2.classList.contains('premove-selected')).toBe(true);
      expect(a2.classList.contains('premove-from')).toBe(false); // not a confirmed fill
      expect(grid.children[5 * 8 + 0].classList.contains('premove-move')).toBe(true);
      expect(grid.children[5 * 8 + 0].classList.contains('premove-to')).toBe(false);
    });

    it('confirmed fills persist across an unrelated selection change', () => {
      board2d.toggle2DBoard();
      network.serverTurn = 'black';
      const grid = gridEl();
      premove.setPremove(E2);
      expect(grid.children[E2_DISPLAY].classList.contains('premove-from')).toBe(true);

      // Select a different own piece (b2) — the confirmed fills must survive
      grid.children[6 * 8 + 1].click();
      expect(grid.children[6 * 8 + 1].classList.contains('premove-selected')).toBe(true);
      expect(grid.children[E2_DISPLAY].classList.contains('premove-from')).toBe(true);
      expect(grid.children[E4_DISPLAY].classList.contains('premove-to')).toBe(true);
    });

    // ── Confirmed arrow independence ─────────────────────

    it('renders a dashed premove arrow as an independent system overlay', async () => {
      board2d.toggle2DBoard();
      mockArrowGeometry();
      premove.setPremove(E2);

      const arrow = premoveArrowEl();
      expect(arrow).toBeTruthy();
      const body = arrow.querySelector('path');
      expect(body).toBeTruthy();
      expect(body.getAttribute('stroke-dasharray')).toBeTruthy(); // dashed
      expect(arrow.querySelector('polygon')).toBeTruthy(); // solid head

      // The premove arrow is NOT in the mutable annotation arrows list
      const arrows = await import('../../client/arrows.js');
      expect(arrows.getArrows()).toHaveLength(0);
    });

    it('clearArrows() does not clear or hide the premove arrow', async () => {
      board2d.toggle2DBoard();
      mockArrowGeometry();
      premove.setPremove(E2);
      expect(premoveArrowEl()).toBeTruthy();

      const arrows = await import('../../client/arrows.js');
      arrows.clearArrows();
      expect(premoveArrowEl()).toBeTruthy(); // still rendered
    });

    it('an annotation with identical endpoints coexists with the premove arrow', async () => {
      board2d.toggle2DBoard();
      mockArrowGeometry();
      premove.setPremove(E2);
      expect(premoveArrowEl()).toBeTruthy();

      const arrows = await import('../../client/arrows.js');
      // Identical endpoints to the premove (e2 → e4)
      arrows.addArrow({ file: 4, rank: 1 }, { file: 4, rank: 3 }, '#ffdd00');
      // Both the annotation and the premove arrow are present
      expect(annotationArrowCount()).toBe(1);
      expect(premoveArrowEl()).toBeTruthy();
    });

    it('removeArrow() does not remove the premove arrow', async () => {
      board2d.toggle2DBoard();
      mockArrowGeometry();
      premove.setPremove(E2);

      const arrows = await import('../../client/arrows.js');
      arrows.addArrow({ file: 4, rank: 1 }, { file: 4, rank: 3 }, '#ffdd00');
      expect(annotationArrowCount()).toBe(1);

      arrows.removeArrow(4, 1, 4, 3);
      expect(annotationArrowCount()).toBe(0);
      expect(premoveArrowEl()).toBeTruthy(); // premove arrow survives
    });

    it('toggling an annotation off (same endpoints+color) does not affect the premove arrow', async () => {
      board2d.toggle2DBoard();
      mockArrowGeometry();
      premove.setPremove(E2);
      expect(premoveArrowEl()).toBeTruthy();

      const arrows = await import('../../client/arrows.js');
      // Add an annotation with identical endpoints to the premove (e2 → e4)
      arrows.addArrow({ file: 4, rank: 1 }, { file: 4, rank: 3 }, '#ffdd00');
      expect(annotationArrowCount()).toBe(1);
      expect(premoveArrowEl()).toBeTruthy();

      // Toggle it off (same from/to/color) — the annotation is removed
      arrows.addArrow({ file: 4, rank: 1 }, { file: 4, rank: 3 }, '#ffdd00');
      expect(annotationArrowCount()).toBe(0);
      // The premove arrow survives the toggle
      expect(premoveArrowEl()).toBeTruthy();
    });

    it('an ordinary left-click (clearArrows) does not hide the premove arrow', async () => {
      board2d.toggle2DBoard();
      network.serverTurn = 'black';
      mockArrowGeometry();
      premove.setPremove(E2);
      expect(premoveArrowEl()).toBeTruthy();

      // Left-click a non-origin empty square (a3) — triggers clearArrows()
      const grid = gridEl();
      grid.children[5 * 8 + 0].click();
      expect(premoveArrowEl()).toBeTruthy(); // premove arrow survives
      // The premove itself is intact (a3 is not the origin)
      expect(premove.getPremove()).not.toBeNull();
    });

    // ── Server restore / clear re-render ─────────────────

    it('restores premove visuals on set (server restore) and removes them on clear', () => {
      board2d.toggle2DBoard();
      mockArrowGeometry();
      const grid = gridEl();

      // No premove → no fills, no arrow
      expect(grid.children[E2_DISPLAY].classList.contains('premove-from')).toBe(false);
      expect(premoveArrowEl()).toBeFalsy();

      // Server restore (state message carries the premove)
      premove.setPremove(E2);
      expect(grid.children[E2_DISPLAY].classList.contains('premove-from')).toBe(true);
      expect(grid.children[E4_DISPLAY].classList.contains('premove-to')).toBe(true);
      expect(premoveArrowEl()).toBeTruthy();

      // Server clear (premoveCleared / state premove:null)
      premove.clearPremove();
      expect(grid.children[E2_DISPLAY].classList.contains('premove-from')).toBe(false);
      expect(grid.children[E4_DISPLAY].classList.contains('premove-to')).toBe(false);
      expect(premoveArrowEl()).toBeFalsy();
    });

    it('re-renders premove visuals after a full board re-render (state update)', () => {
      board2d.toggle2DBoard();
      mockArrowGeometry();
      premove.setPremove(E2);
      expect(premoveArrowEl()).toBeTruthy();

      // A state update re-renders the whole board — the premove visuals must
      // come back (fills + arrow) from the premove state.
      for (const fn of stateListeners) fn();
      const grid = gridEl();
      expect(grid.children[E2_DISPLAY].classList.contains('premove-from')).toBe(true);
      expect(grid.children[E4_DISPLAY].classList.contains('premove-to')).toBe(true);
      expect(premoveArrowEl()).toBeTruthy();
    });

    it('renders premove visuals when the board is shown after the premove is set', () => {
      // Set the premove while the board is hidden (mode 0) — the
      // onPremoveChange callback is a no-op while hidden, but the visuals
      // must render when the board is later shown.
      premove.setPremove(E2);
      expect(board2d.is2DBoardVisible()).toBe(false);

      board2d.toggle2DBoard();
      const grid = gridEl();
      expect(grid.children[E2_DISPLAY].classList.contains('premove-from')).toBe(true);
      expect(grid.children[E4_DISPLAY].classList.contains('premove-to')).toBe(true);
    });

    it('does not accumulate duplicate arrow SVGs across premove changes', () => {
      board2d.toggle2DBoard();
      mockArrowGeometry();
      premove.setPremove(E2);
      premove.setPremove({ fromFile: 0, fromRank: 1, toFile: 0, toRank: 3 }); // replace
      premove.setPremove(E2);
      // Exactly one arrow SVG overlay in the container
      const svgs = document.querySelectorAll('#board-2d-container svg');
      expect(svgs.length).toBe(1);
      // Exactly one premove arrow group
      expect(document.querySelectorAll('[data-premove-arrow]').length).toBe(1);
    });

    // ── Cancellation: origin re-click ────────────────────

    it('re-clicking the confirmed premove origin cancels it', () => {
      board2d.toggle2DBoard();
      network.serverTurn = 'black';
      premove.setPremove(E2);
      const grid = gridEl();

      // Click the origin (e2) — cancels the premove
      grid.children[E2_DISPLAY].click();
      expect(network.cancelPremove).toHaveBeenCalledTimes(1);
      expect(network.sendPremoveCancel).toHaveBeenCalledTimes(1);
      // No new selection was started
      expect(grid.children[E2_DISPLAY].classList.contains('premove-selected')).toBe(false);
    });

    it('re-clicking a non-origin square does not cancel the premove', () => {
      board2d.toggle2DBoard();
      network.serverTurn = 'black';
      premove.setPremove(E2);
      const grid = gridEl();

      // Click b2 (own piece, not the origin) — re-selects, does not cancel
      grid.children[6 * 8 + 1].click();
      expect(network.cancelPremove).not.toHaveBeenCalled();
      expect(grid.children[6 * 8 + 1].classList.contains('premove-selected')).toBe(true);
      expect(premove.getPremove()).not.toBeNull(); // premove intact
    });

    // ── Cancellation: same-square right-click on origin ──

    function rightClickSameSquare(displayIndex) {
      const grid = gridEl();
      const container = grid.closest('#board-2d-container');
      grid.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        right: 800,
        bottom: 800,
        width: 800,
        height: 800,
      });
      const col = displayIndex % 8;
      const row = Math.floor(displayIndex / 8);
      const x = col * 100 + 50;
      const y = row * 100 + 50;
      container.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, button: 2, clientX: x, clientY: y })
      );
      document.dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, button: 2, clientX: x, clientY: y })
      );
    }

    it('same-square right-click on the premove origin cancels (priority over highlight)', async () => {
      board2d.toggle2DBoard();
      network.serverTurn = 'black';
      premove.setPremove(E2);

      const highlights = await import('../../client/highlights.js');
      rightClickSameSquare(E2_DISPLAY);

      expect(network.cancelPremove).toHaveBeenCalledTimes(1);
      // No highlight was added (the cancel took priority)
      expect(highlights.getHighlights()).toHaveLength(0);
    });

    it('same-square right-click on a NON-origin square still highlights (no cancel)', async () => {
      board2d.toggle2DBoard();
      network.serverTurn = 'black';
      premove.setPremove(E2);

      const highlights = await import('../../client/highlights.js');
      // Right-click a3 (display row 5, col 0) — not the origin
      rightClickSameSquare(5 * 8 + 0);

      expect(network.cancelPremove).not.toHaveBeenCalled();
      expect(highlights.getHighlights()).toHaveLength(1);
      expect(premove.getPremove()).not.toBeNull(); // premove intact
    });

    it('right-click drag ending on the origin still draws an arrow (no cancel)', async () => {
      board2d.toggle2DBoard();
      network.serverTurn = 'black';
      premove.setPremove(E2);

      const arrows = await import('../../client/arrows.js');
      const grid = gridEl();
      const container = grid.closest('#board-2d-container');
      grid.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        right: 800,
        bottom: 800,
        width: 800,
        height: 800,
      });

      // Press on a3 (display row 5, col 0), release on e2 (display row 6, col 4)
      // — a drag (press ≠ release) that ENDS on the premove origin.
      container.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, button: 2, clientX: 50, clientY: 550 })
      );
      document.dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, button: 2, clientX: 450, clientY: 650 })
      );

      // An arrow was drawn (a3 → e2), the premove was NOT cancelled
      expect(arrows.getArrows()).toHaveLength(1);
      expect(network.cancelPremove).not.toHaveBeenCalled();
      expect(premove.getPremove()).not.toBeNull(); // premove intact
    });

    // ── Ordinary annotation behavior regression ──────────

    it('right-click annotations are unchanged with no premove (regression)', async () => {
      board2d.toggle2DBoard();
      const arrows = await import('../../client/arrows.js');
      const highlights = await import('../../client/highlights.js');
      arrows.clearArrows();
      highlights.clearHighlights();

      const grid = gridEl();
      const container = grid.closest('#board-2d-container');
      grid.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        right: 800,
        bottom: 800,
        width: 800,
        height: 800,
      });

      // Same-square right-click → highlight
      container.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, button: 2, clientX: 50, clientY: 550 })
      );
      document.dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, button: 2, clientX: 50, clientY: 550 })
      );
      expect(highlights.getHighlights()).toHaveLength(1);
      expect(arrows.getArrows()).toHaveLength(0);

      // Drag right-click → arrow
      container.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, button: 2, clientX: 50, clientY: 550 })
      );
      document.dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, button: 2, clientX: 150, clientY: 550 })
      );
      expect(arrows.getArrows()).toHaveLength(1);
    });
  });
});
