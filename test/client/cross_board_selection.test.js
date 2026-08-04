// ═══════════════════════════════════════════════════════════
//  CROSS-BOARD SELECTION SYNC — integration tests
// ═══════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import * as THREE from 'three';

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

// Full move generator (same as board_2d_interaction.test.js)
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
    if (target !== 0 && pieceColor(target) === color) return false;
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
      if (nf < 0 || nf >= 8) continue;
      if (nr >= 0 && nr < 8 && board[nr][nf] !== 0 && pieceColor(board[nr][nf]) !== color)
        addMove(nf, nr);
      if (enPassantTarget && enPassantTarget.file === nf && enPassantTarget.rank === nr)
        addMove(nf, nr, true);
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
    ])
      addMove(file + df, rank + dr);
  } else if (type === 'bishop' || type === 'queen') {
    for (const [df, dr] of [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ])
      for (let i = 1; i < 8; i++) if (addMove(file + df * i, rank + dr * i)) break;
  } else if (type === 'rook' || type === 'queen') {
    for (const [df, dr] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ])
      for (let i = 1; i < 8; i++) if (addMove(file + df * i, rank + dr * i)) break;
  } else if (type === 'king') {
    for (let dr = -1; dr <= 1; dr++)
      for (let df = -1; df <= 1; df++) if (dr !== 0 || df !== 0) addMove(file + df, rank + dr);
    // Castling
    if (color === 'white' && rank === 0 && file === 4) {
      if (castlingRights.wK && board[0][5] === 0 && board[0][6] === 0) {
        if (
          !isInCheck(board, 'white') &&
          !isAttacked(board, 5, 0, 'black') &&
          !isAttacked(board, 6, 0, 'black')
        )
          moves.push({ file: 6, rank: 0 });
      }
      if (castlingRights.wQ && board[0][3] === 0 && board[0][2] === 0 && board[0][1] === 0) {
        if (
          !isInCheck(board, 'white') &&
          !isAttacked(board, 3, 0, 'black') &&
          !isAttacked(board, 2, 0, 'black')
        )
          moves.push({ file: 2, rank: 0 });
      }
    }
    if (color === 'black' && rank === 7 && file === 4) {
      if (castlingRights.bK && board[7][5] === 0 && board[7][6] === 0) {
        if (
          !isInCheck(board, 'black') &&
          !isAttacked(board, 5, 7, 'white') &&
          !isAttacked(board, 6, 7, 'white')
        )
          moves.push({ file: 6, rank: 7 });
      }
      if (castlingRights.bQ && board[7][3] === 0 && board[7][2] === 0 && board[7][1] === 0) {
        if (
          !isInCheck(board, 'black') &&
          !isAttacked(board, 3, 7, 'white') &&
          !isAttacked(board, 2, 7, 'white')
        )
          moves.push({ file: 2, rank: 7 });
      }
    }
  }
  return moves;
}

function findKing(board, color) {
  const king = color === 'white' ? W_KING : B_KING;
  for (let r = 0; r < 8; r++)
    for (let f = 0; f < 8; f++) if (board[r][f] === king) return { file: f, rank: r };
  return null;
}

function isAttacked(board, file, rank, byColor) {
  const pawn = byColor === 'white' ? W_PAWN : B_PAWN;
  const pawnDir = byColor === 'white' ? -1 : 1;
  for (const df of [-1, 1]) {
    const pf = file + df,
      pr = rank + pawnDir;
    if (pf >= 0 && pf < 8 && pr >= 0 && pr < 8 && board[pr][pf] === pawn) return true;
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
  ])
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
  const rook = byColor === 'white' ? W_ROOK : B_ROOK;
  for (const [df, dr] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ])
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
  return false;
}

function isInCheck(board, color) {
  const k = findKing(board, color);
  if (!k) return false;
  return isAttacked(board, k.file, k.rank, color === 'white' ? 'black' : 'white');
}

// ── Mocks ────────────────────────────────────────────────

vi.mock('../../client/capabilities.js', () => ({
  isTouchDevice: vi.fn(() => false),
  isCoarsePointer: vi.fn(() => false),
  isMobilePhone: vi.fn(() => false),
  isMobileLayout: vi.fn(() => false),
  hasPointerLock: vi.fn(() => false),
}));

vi.mock('../../client/sound.js', () => ({
  playMove: vi.fn(),
}));

vi.mock('../../client/ui.js', () => ({
  menuOpen: false,
  settingsOpen: false,
  helpOpen: false,
  showMenu: vi.fn(),
  hideMenu: vi.fn(),
  hideHelp: vi.fn(),
  hideSettings: vi.fn(),
  updateMouseModeDisplay: vi.fn(),
  hidePromotionPicker: vi.fn(),
  hideConcedeConfirm: vi.fn(),
  mouseSensitivity: 0.002,
  showError: vi.fn(),
  setThreeScene: vi.fn(),
}));

vi.mock('../../client/board.js', () => ({
  squares: Array.from({ length: 8 }, () => Array(8).fill(null)),
  clearHighlights: vi.fn(),
  highlightSelected: vi.fn(),
  highlightValidMoves: vi.fn(),
  highlightCheck: vi.fn(),
  highlightPreviousMove: vi.fn(),
}));

vi.mock('../../shared/chess.mjs', () => ({
  pieceColor,
  getValidMoves,
  findKing,
  isInCheck,
}));

const mockPieceMeshes = [];
vi.mock('../../client/pieces.js', () => ({
  setSvgPieceSet: vi.fn(),
  getModelSet: () => 'simple-classic',
  setModelSet: vi.fn(),
  SVG_PIECE_SETS: ['mpchess', 'maestro', 'dubrovny'],
  MODEL_SETS: ['simple-classic', 'low-poly', 'jeu'],
  pieceMeshes: mockPieceMeshes,
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

vi.mock('../../client/arrows.js', () => ({
  addArrow: vi.fn(),
  clearArrows: vi.fn(),
  getArrowColor: vi.fn(() => '#ffffff'),
  getArrows: vi.fn(() => []),
  onArrowChange: vi.fn(),
  getArrowPath: vi.fn((f, t) => [f, t]),
}));

vi.mock('../../client/highlights.js', () => ({
  addHighlight: vi.fn(),
  clearHighlights: vi.fn(),
  getHighlightColor: vi.fn(() => '#ffdd00'),
  getHighlights: vi.fn(() => []),
  onHighlightChange: vi.fn(),
}));

vi.mock('../../client/controls_config.js', () => ({
  CONTROLS_CONFIG: {
    cameraPositions: {},
    roleKey: { white: 'white', black: 'black' },
    dragThreshold: 10,
    dragHeight: 0.5,
    pitchMin: -Math.PI / 2 + 0.01,
    pitchMax: Math.PI / 2 - 0.01,
  },
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
  previousMove: null,
  sendMove: vi.fn(),
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
      <canvas id="game-canvas"></canvas>
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

describe('cross-board selection synchronization', () => {
  let board2d, controls, network, board3d, selection;

  async function reloadModules() {
    vi.resetModules();
    setupDOM();
    stateListeners.length = 0;
    restartListeners.length = 0;
    mockPieceMeshes.length = 0;

    board2d = await import('../../client/board_2d.js');
    controls = await import('../../client/controls.js');
    network = await import('../../client/network.js');
    board3d = await import('../../client/board.js');
    selection = await import('../../client/selection.js');

    network.serverBoard = startingBoard();
    network.serverTurn = 'white';
    network.myRole = 'white';
    network.serverPromotingPiece = null;
    network.serverGameOver = false;
    network.castlingRights = { wK: true, wQ: true, bK: true, bQ: true };
    network.enPassantTarget = null;
    network.sendMove.mockClear();
  }

  beforeEach(async () => {
    await reloadModules();
  });

  function gridEl() {
    return document.querySelector('.board2d-grid');
  }

  // ── 2D to 3D sync ──────────────────────────────────────

  it('selecting on 2D board updates 3D board highlights', () => {
    // Set up the 3D scene reference so controls.js callback fires
    const mockScene = { name: 'mock-3d-scene' };
    controls.setScene(mockScene);
    board2d.toggle2DBoard();
    const grid = gridEl();
    const a2 = grid.children[6 * 8 + 0]; // a2 pawn
    a2.click();

    // 2D board should show selection
    expect(a2.classList.contains('selected')).toBe(true);

    // 3D board should have received the selection via callback
    expect(board3d.highlightSelected).toHaveBeenCalledWith(0, 1);
    // Verify highlightValidMoves is called with (scene, moves) signature
    expect(board3d.highlightValidMoves).toHaveBeenCalledWith(
      mockScene,
      expect.arrayContaining([expect.objectContaining({ file: expect.any(Number) })])
    );
  });

  it('deselecting on 2D board clears 3D board highlights', () => {
    controls.setScene({});
    board2d.toggle2DBoard();
    const grid = gridEl();
    const a2 = grid.children[6 * 8 + 0];
    a2.click(); // select
    vi.clearAllMocks();
    a2.click(); // deselect

    // 3D board should have cleared highlights
    expect(board3d.clearHighlights).toHaveBeenCalled();
    expect(board3d.highlightPreviousMove).toHaveBeenCalled();
  });

  // ── 3D to 2D sync ──────────────────────────────────────

  it('selecting on 3D board updates 2D board highlights', () => {
    board2d.toggle2DBoard();

    // Simulate 3D board selection by calling setSelectedSquare directly
    const moves = [
      { file: 0, rank: 2 },
      { file: 0, rank: 3 },
    ]; // a3, a4
    selection.setSelectedSquare({ file: 0, rank: 1 }, moves);

    const grid = gridEl();
    const a2 = grid.children[6 * 8 + 0];
    expect(a2.classList.contains('selected')).toBe(true);
    expect(grid.children[5 * 8 + 0].classList.contains('valid-move')).toBe(true); // a3
    expect(grid.children[4 * 8 + 0].classList.contains('valid-move')).toBe(true); // a4
  });

  it('deselecting on 3D board clears 2D board highlights', () => {
    board2d.toggle2DBoard();

    // Select first
    const moves = [{ file: 0, rank: 2 }];
    selection.setSelectedSquare({ file: 0, rank: 1 }, moves);

    const grid = gridEl();
    expect(grid.children[6 * 8 + 0].classList.contains('selected')).toBe(true);

    // Deselect
    selection.clearSelection();

    expect(grid.children[6 * 8 + 0].classList.contains('selected')).toBe(false);
  });

  // ── Readiness guards ───────────────────────────────────

  it('3D renderer callbacks do not run before setScene', () => {
    // Do NOT call setScene — orchestrator should skip 3D updates
    board2d.toggle2DBoard();
    const grid = gridEl();
    const a2 = grid.children[6 * 8 + 0];
    a2.click(); // select on 2D

    // 2D should still show selection (its own callbacks are independent)
    expect(a2.classList.contains('selected')).toBe(true);

    // 3D callbacks should NOT have been called (no scene set)
    expect(board3d.highlightSelected).not.toHaveBeenCalled();
    expect(board3d.highlightValidMoves).not.toHaveBeenCalled();
  });

  // ── Shared state consistency ───────────────────────────

  it('shared selection state is consistent after 2D selection', () => {
    board2d.toggle2DBoard();
    const grid = gridEl();
    grid.children[6 * 8 + 0].click(); // select a2

    const sel = selection.getSelectedSquare();
    expect(sel).toEqual({ file: 0, rank: 1 });
    expect(selection.getValidMovesList().length).toBeGreaterThan(0);
  });

  it('shared selection state is consistent after 3D selection', () => {
    const moves = [
      { file: 0, rank: 2 },
      { file: 0, rank: 3 },
    ];
    selection.setSelectedSquare({ file: 0, rank: 1 }, moves);

    const sel = selection.getSelectedSquare();
    expect(sel).toEqual({ file: 0, rank: 1 });
    expect(selection.getValidMovesList()).toEqual(moves);
  });

  it('clearSelection clears shared state', () => {
    selection.setSelectedSquare({ file: 0, rank: 1 }, [{ file: 0, rank: 2 }]);
    selection.clearSelection();

    expect(selection.getSelectedSquare()).toBeNull();
    expect(selection.getValidMovesList()).toEqual([]);
  });

  // ── Controls exports sync ──────────────────────────────

  it('controls.selectedSquare reflects shared state', () => {
    expect(controls.selectedSquare).toBeNull();

    selection.setSelectedSquare({ file: 3, rank: 4 }, []);
    expect(controls.selectedSquare).toEqual({ file: 3, rank: 4 });

    selection.clearSelection();
    expect(controls.selectedSquare).toBeNull();
  });

  // ── Drag selection sync ────────────────────────────────

  it('3D drag commit propagates selection to 2D board', () => {
    board2d.toggle2DBoard();

    // Set up mock raycaster to hit a2 (file=0, rank=1)
    // x = file - 3.5 = -3.5, z = 3.5 - rank = 2.5
    globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 2.5 } }];

    // Set up mock piece mesh for a2
    mockPieceMeshes.length = 0;
    mockPieceMeshes.push({
      file: 0,
      rank: 1,
      mesh: { position: new THREE.Vector3(-3.5, 0.01, 2.5) },
    });

    // Install drag handlers
    const canvas = document.getElementById('game-canvas');
    const mockRenderer = { domElement: canvas };
    controls.setDragHandlers(mockRenderer);

    // Dispatch mousedown on canvas (triggers drag candidate)
    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100, button: 0 }));

    // Dispatch mousemove beyond drag threshold (triggers commitDrag)
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 150, clientY: 150 }));

    // 2D board should reflect the selection from drag commit
    const grid = gridEl();
    const a2 = grid.children[6 * 8 + 0];
    expect(a2.classList.contains('selected')).toBe(true);

    // Clean up
    delete globalThis.__mockRaycasterResult;
  });
});
