// ═══════════════════════════════════════════════════════════
//  2D BOARD — confirmed premove destination ghost (Phase 3D)
//  Focused tests: create/update/replace/clear/restore, board
//  flip, piece-set change, state-update re-render, correct piece
//  asset/orientation, real origin piece never moved/removed,
//  capture and friendly-occupied destinations, non-interactivity
//  (CSS pointer-events/opacity), and no duplicate ghosts.
// ═══════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cssSource = readFileSync(join(__dirname, '../../client/style.css'), 'utf-8');

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

// ── Mocks (hoisted by Vite) ─────────────────────────────

vi.mock('../../client/capabilities.js', () => ({
  isTouchDevice: () => false,
  isCoarsePointer: () => false,
  isMobilePhone: () => false,
  isMobileLayout: () => false,
}));

// Self-contained piece-set tracker so the ghost asset assertions can
// follow a 2D piece-set change.
const pieceSetState = { set: 'mpchess' };
vi.mock('../../client/pieces.js', () => ({
  setSvgPieceSet: (v) => {
    pieceSetState.set = v;
  },
  getSvgPieceSet: () => pieceSetState.set,
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
    return `files/pieces/2d/${pieceSetState.set}/${files[pieceId]}.svg`;
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
  const actual = await vi.importActual('../../shared/chess.mjs');
  return {
    pieceColor: actual.pieceColor,
    pieceType: actual.pieceType,
    getValidMoves: actual.getValidMoves,
    getPremoveMoves: actual.getPremoveMoves,
    findKing: actual.findKing,
    isInCheck: actual.isInCheck,
  };
});

const stateListeners = [];
const restartListeners = [];

vi.mock('../../client/network.js', () => ({
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
  sendPremoveCancel: vi.fn(),
  cancelPremove: vi.fn(),
  debugEnabled: false,
  onStateUpdate(fn) {
    stateListeners.push(fn);
  },
  onRestart(fn) {
    restartListeners.push(fn);
  },
  onPromotion() {},
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

  if (!globalThis.window.ResizeObserver) {
    globalThis.window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
}

describe('2D board — confirmed premove ghost (Phase 3D)', () => {
  let board2d;
  let network;
  let premove;

  // e2 (file 4, rank 1) → e4 (file 4, rank 3)
  const E2 = { fromFile: 4, fromRank: 1, toFile: 4, toRank: 3 };
  // a2 (file 0, rank 1) → a4 (file 0, rank 3)
  const A2 = { fromFile: 0, fromRank: 1, toFile: 0, toRank: 3 };

  // White standard orientation: displayFile = file, displayRank = 7 - rank
  const E4_DISPLAY = 4 * 8 + 4;
  const E2_DISPLAY = 6 * 8 + 4;
  const A4_DISPLAY = 4 * 8 + 0;

  function gridEl() {
    return document.querySelector('.board2d-grid');
  }

  function ghosts() {
    return [...document.querySelectorAll('[data-premove-ghost]')];
  }

  function ghostIn(displayIndex) {
    return gridEl().children[displayIndex].querySelector('[data-premove-ghost]');
  }

  function realPieceIn(displayIndex) {
    return gridEl().children[displayIndex].querySelector(
      '.board2d-piece:not([data-premove-ghost])'
    );
  }

  beforeEach(async () => {
    vi.resetModules();
    setupDOM();
    stateListeners.length = 0;
    restartListeners.length = 0;
    pieceSetState.set = 'mpchess';

    board2d = await import('../../client/board_2d.js');
    network = await import('../../client/network.js');
    premove = await import('../../client/premove.js');
    network.serverBoard = startingBoard();
    network.serverTurn = 'white';
    network.myRole = 'white';
    network.serverPromotingPiece = null;
    network.serverGameOver = false;
  });

  // ── Create ─────────────────────────────────────────────

  it('renders no ghost without a confirmed premove', () => {
    board2d.toggle2DBoard();
    expect(ghosts()).toHaveLength(0);
  });

  it('renders exactly one ghost at the destination with the origin piece asset', () => {
    board2d.toggle2DBoard();
    premove.setPremove(E2);

    const all = ghosts();
    expect(all).toHaveLength(1);
    const ghost = ghostIn(E4_DISPLAY);
    expect(ghost).toBeTruthy();
    // correct piece asset: the white pawn being premoved
    expect(ghost.src).toContain('wP.svg');
    expect(ghost.classList.contains('board2d-premove-ghost')).toBe(true);
    expect(ghost.classList.contains('board2d-piece')).toBe(true);
    expect(ghost.draggable).toBe(false);
    // the ghost lives inside the destination square
    expect(ghost.parentElement.dataset.file).toBe('4');
    expect(ghost.parentElement.dataset.rank).toBe('3');
  });

  it('does not move or remove the real origin piece', () => {
    board2d.toggle2DBoard();
    premove.setPremove(E2);

    // origin e2 still shows the real white pawn (not the ghost)
    const originPiece = realPieceIn(E2_DISPLAY);
    expect(originPiece).toBeTruthy();
    expect(originPiece.src).toContain('wP.svg');
    // destination e4 holds only the ghost (empty square)
    expect(realPieceIn(E4_DISPLAY)).toBeNull();
    expect(ghostIn(E4_DISPLAY)).toBeTruthy();
  });

  it('uses the black piece asset for a black premoved piece', () => {
    board2d.toggle2DBoard();
    network.myRole = 'black';
    network.serverTurn = 'white';
    // state update re-renders the board in the flipped orientation
    for (const fn of stateListeners) fn();
    premove.setPremove({ fromFile: 0, fromRank: 6, toFile: 0, toRank: 4 }); // a7–a5

    const all = ghosts();
    expect(all).toHaveLength(1);
    // flipped: displayFile = 7 - 0 = 7, displayRank = 4
    const ghost = ghostIn(4 * 8 + 7);
    expect(ghost).toBeTruthy();
    expect(ghost.src).toContain('bP.svg');
  });

  // ── Occupied destinations ──────────────────────────────

  it('capture destination: ghost coexists with the captured piece, which stays untouched', () => {
    board2d.toggle2DBoard();
    network.serverBoard[3][4] = B_PAWN; // black pawn on e4
    for (const fn of stateListeners) fn(); // re-render with the new board
    premove.setPremove(E2);

    const ghost = ghostIn(E4_DISPLAY);
    expect(ghost).toBeTruthy();
    expect(ghost.src).toContain('wP.svg');
    // the real black pawn is still there, unmodified
    const real = realPieceIn(E4_DISPLAY);
    expect(real).toBeTruthy();
    expect(real.src).toContain('bP.svg');
    expect(ghosts()).toHaveLength(1);
  });

  it('friendly-occupied destination (premoved recapture): ghost coexists with the friendly piece', () => {
    board2d.toggle2DBoard();
    network.serverBoard[3][4] = W_PAWN; // friendly white pawn on e4
    for (const fn of stateListeners) fn();
    premove.setPremove(E2);

    const ghost = ghostIn(E4_DISPLAY);
    expect(ghost).toBeTruthy();
    expect(ghost.src).toContain('wP.svg');
    const real = realPieceIn(E4_DISPLAY);
    expect(real).toBeTruthy();
    expect(real.src).toContain('wP.svg');
    expect(ghosts()).toHaveLength(1);
  });

  // ── Replace / clear / restore ──────────────────────────

  it('replacing the premove moves the ghost without leaving duplicates', () => {
    board2d.toggle2DBoard();
    premove.setPremove(E2);
    expect(ghostIn(E4_DISPLAY)).toBeTruthy();

    premove.setPremove(A2);

    expect(ghosts()).toHaveLength(1);
    expect(ghostIn(A4_DISPLAY)).toBeTruthy();
    expect(ghostIn(E4_DISPLAY)).toBeNull();
  });

  it('clearing the premove removes the ghost', () => {
    board2d.toggle2DBoard();
    premove.setPremove(E2);
    expect(ghosts()).toHaveLength(1);

    premove.clearPremove();
    expect(ghosts()).toHaveLength(0);
  });

  it('clear then re-set (reconnect restore) re-creates exactly one ghost', () => {
    board2d.toggle2DBoard();
    premove.setPremove(E2);
    premove.clearPremove();
    expect(ghosts()).toHaveLength(0);

    premove.setPremove(E2);
    expect(ghosts()).toHaveLength(1);
    expect(ghostIn(E4_DISPLAY)).toBeTruthy();
  });

  it('repeated identical premove sets do not duplicate the ghost', () => {
    board2d.toggle2DBoard();
    premove.setPremove(E2);
    premove.setPremove({ ...E2 }); // no-op (same value)
    premove.setPremove({ ...E2, promotion: null }); // no-op (same value)
    expect(ghosts()).toHaveLength(1);
  });

  // ── Board flip / re-render / piece set ─────────────────

  it('board flip: the ghost lands on the correct display square after a state update', () => {
    board2d.toggle2DBoard();
    premove.setPremove(E2);
    expect(ghostIn(E4_DISPLAY)).toBeTruthy();

    // Rejoin as black → flipped orientation → full board re-render.
    // The white premove is cleared (it is no longer the player's premove),
    // so set a black premove to verify the ghost on the flipped board.
    network.myRole = 'black';
    for (const fn of stateListeners) fn();
    premove.setPremove({ fromFile: 0, fromRank: 6, toFile: 0, toRank: 4 }); // a7–a5

    expect(ghosts()).toHaveLength(1);
    // flipped: displayFile = 7 - 0 = 7, displayRank = 4
    expect(ghostIn(4 * 8 + 7)).toBeTruthy();
  });

  it('a state-update re-render re-emits the ghost without duplicates', () => {
    board2d.toggle2DBoard();
    premove.setPremove(E2);
    for (const fn of stateListeners) fn();
    for (const fn of stateListeners) fn();
    expect(ghosts()).toHaveLength(1);
    expect(ghostIn(E4_DISPLAY)).toBeTruthy();
  });

  it('renders the ghost when the board is shown after the premove is set', () => {
    premove.setPremove(E2);
    expect(board2d.is2DBoardVisible()).toBe(false);

    board2d.toggle2DBoard();
    expect(ghosts()).toHaveLength(1);
    expect(ghostIn(E4_DISPLAY)).toBeTruthy();
  });

  it('piece-set change: the ghost re-renders with the new asset', async () => {
    board2d.toggle2DBoard();
    premove.setPremove(E2);
    expect(ghostIn(E4_DISPLAY).src).toContain('/mpchess/');

    const pieces = await import('../../client/pieces.js');
    pieces.setSvgPieceSet('maestro');
    board2d.renderBoard2D();

    expect(ghosts()).toHaveLength(1);
    expect(ghostIn(E4_DISPLAY).src).toContain('/maestro/');
    expect(ghostIn(E4_DISPLAY).src).toContain('wP.svg');
  });

  // ── Defensive / privacy ────────────────────────────────

  it('origin piece captured (opponent piece now on source square): no ghost, no crash', () => {
    board2d.toggle2DBoard();
    premove.setPremove(E2);
    expect(ghosts()).toHaveLength(1);

    // The opponent captured the premoved pawn: the source square now holds
    // the opponent's capturing piece (not 0) during the state update that
    // precedes premoveDiscarded. Must not ghost the opponent's piece.
    network.serverBoard[1][4] = B_PAWN; // opponent captured onto e2
    for (const fn of stateListeners) fn();

    expect(ghosts()).toHaveLength(0);
  });

  it('a client with null premove state (spectator/opponent) renders no ghost', () => {
    board2d.toggle2DBoard();
    network.myRole = 'spectator';
    for (const fn of stateListeners) fn();
    expect(premove.getPremove()).toBeNull();
    expect(ghosts()).toHaveLength(0);
  });

  it('out-of-range premove coordinates do not crash or render a ghost', () => {
    board2d.toggle2DBoard();
    // Out-of-range origin: no ghost
    premove.setPremove({ fromFile: 9, fromRank: 1, toFile: 4, toRank: 3 });
    expect(ghosts()).toHaveLength(0);
    // Out-of-range destination with a VALID origin (e2 pawn exists):
    // must not wrap the grid index onto a wrong square
    premove.setPremove({ fromFile: 4, fromRank: 1, toFile: 9, toRank: 3 });
    expect(ghosts()).toHaveLength(0);
    premove.setPremove({ fromFile: 4, fromRank: 1, toFile: 4, toRank: -1 });
    expect(ghosts()).toHaveLength(0);
    // A valid premove after malformed ones still renders correctly
    premove.setPremove(E2);
    expect(ghosts()).toHaveLength(1);
    expect(ghostIn(E4_DISPLAY)).toBeTruthy();
  });

  // ── Non-interactivity (CSS) ────────────────────────────

  it('the ghost CSS rule is non-interactive and semi-transparent (~0.5 opacity)', () => {
    const m = cssSource.match(/\.board2d-premove-ghost\s*\{([\s\S]*?)\}/);
    expect(m, '.board2d-premove-ghost rule not found in style.css').toBeTruthy();
    const rule = m[1];
    expect(rule).toContain('pointer-events: none');
    expect(rule).toContain('opacity: 0.5');
    // drawn above the real piece (.board2d-piece z-index: 10)
    expect(rule).toContain('z-index: 12');
  });
});
