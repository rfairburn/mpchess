// ═══════════════════════════════════════════════════════════
//  HIGHLIGHTS — regression tests for 2D/3D board highlighting
//  Covers: 2D previous-move persistence, 3D ring indicators,
//  geometry/material reuse, mesh removal, network state sync,
//  drag/touch-cancel previous-move restoration.
// ═══════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';

// ── Module mocks ──────────────────────────────────────────

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
  onStateUpdate: vi.fn(),
  onRestart: vi.fn(),
  onPromotion: vi.fn(),
}));

vi.mock('../../client/pieces.js', () => ({
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

vi.mock('../../client/capabilities.js', () => ({
  isTouchDevice: () => false,
  isCoarsePointer: () => false,
  isMobilePhone: () => false,
  isMobileLayout: () => false,
}));

vi.mock('../../client/chess.mjs', () => ({
  pieceColor: vi.fn((piece) => (piece > 0 && piece <= 6 ? 'white' : 'black')),
  getValidMoves: vi.fn(() => [
    { file: 4, rank: 3 },
    { file: 3, rank: 3 },
  ]),
  findKing: vi.fn(() => null),
  isInCheck: vi.fn(() => false),
}));

vi.mock('../../client/sound.js', () => ({
  playMove: vi.fn(),
}));

vi.mock('../../client/ui.js', () => ({
  showError: vi.fn(),
}));

// ═══════════════════════════════════════════════════════════
//  2D board — previous move highlight persistence
// ═══════════════════════════════════════════════════════════

describe('2D board — previous move highlight persistence', () => {
  beforeEach(() => {
    vi.resetModules();

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

    // Mock ResizeObserver (not available in JSDOM)
    if (!globalThis.window.ResizeObserver) {
      globalThis.window.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    }
  });

  it('shows previous move highlight when no piece is selected', async () => {
    const network = await import('../../client/network.js');
    const { toggle2DBoard, is2DBoardVisible } = await import('../../client/board_2d.js');

    network.serverBoard = Array.from({ length: 8 }, () => Array(8).fill(0));
    network.serverBoard[1][4] = 1;
    network.previousMove = { fromFile: 4, fromRank: 1, toFile: 4, toRank: 3 };

    toggle2DBoard();
    expect(is2DBoardVisible()).toBe(true);

    const grid = document.querySelector('.board2d-grid');
    const e4Square = grid.children[4 * 8 + 4];
    const e2Square = grid.children[6 * 8 + 4];

    expect(e4Square.classList.contains('previous-move')).toBe(true);
    expect(e2Square.classList.contains('previous-move')).toBe(true);
  });

  it('preserves previous move highlight when selecting a piece', async () => {
    const network = await import('../../client/network.js');
    const { toggle2DBoard } = await import('../../client/board_2d.js');

    network.serverBoard = Array.from({ length: 8 }, () => Array(8).fill(0));
    network.serverBoard[1][4] = 1;
    network.serverBoard[3][3] = 1;
    network.previousMove = { fromFile: 4, fromRank: 1, toFile: 4, toRank: 3 };

    toggle2DBoard();
    const grid = document.querySelector('.board2d-grid');

    // Click on d4 pawn to select it
    const d4Square = grid.children[4 * 8 + 3];
    d4Square.click();

    const e4Square = grid.children[4 * 8 + 4];
    const e2Square = grid.children[6 * 8 + 4];

    expect(e4Square.classList.contains('previous-move')).toBe(true);
    expect(e2Square.classList.contains('previous-move')).toBe(true);
    expect(d4Square.classList.contains('selected')).toBe(true);
  });

  it('restores previous move highlight on deselect', async () => {
    const network = await import('../../client/network.js');
    const { toggle2DBoard } = await import('../../client/board_2d.js');

    network.serverBoard = Array.from({ length: 8 }, () => Array(8).fill(0));
    network.serverBoard[1][4] = 1;
    network.serverBoard[3][3] = 1;
    network.previousMove = { fromFile: 4, fromRank: 1, toFile: 4, toRank: 3 };

    toggle2DBoard();
    const grid = document.querySelector('.board2d-grid');

    // Select d4
    const d4Square = grid.children[4 * 8 + 3];
    d4Square.click();

    // Click same square to deselect
    d4Square.click();

    // Previous move should be restored after deselect
    const e4Square = grid.children[4 * 8 + 4];
    const e2Square = grid.children[6 * 8 + 4];
    expect(e4Square.classList.contains('previous-move')).toBe(true);
    expect(e2Square.classList.contains('previous-move')).toBe(true);
    expect(d4Square.classList.contains('selected')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
//  3D board — move ring indicators
// ═══════════════════════════════════════════════════════════

describe('3D board — move ring indicators', () => {
  it('creates flat ring meshes for valid moves', async () => {
    const board = await import('../../client/board.js');
    const network = await import('../../client/network.js');

    network.serverBoard = Array.from({ length: 8 }, () => Array(8).fill(0));

    const added = [];
    const mockScene = {
      add: vi.fn((m) => added.push(m)),
      remove: vi.fn(),
    };

    board.highlightValidMoves(mockScene, [{ file: 4, rank: 3 }]);

    expect(added.length).toBe(1);
    const mesh = added[0];
    expect(mesh.rotation.x).toBe(-Math.PI / 2);
    expect(mesh.geometry.innerRadius).toBeDefined();
    expect(mesh.geometry.outerRadius).toBeDefined();
  });

  it('creates hollow ring meshes for capture moves', async () => {
    const board = await import('../../client/board.js');
    const network = await import('../../client/network.js');

    network.serverBoard = Array.from({ length: 8 }, () => Array(8).fill(0));
    network.serverBoard[3][4] = 7;

    const added = [];
    const mockScene = {
      add: vi.fn((m) => added.push(m)),
      remove: vi.fn(),
    };

    board.highlightValidMoves(mockScene, [{ file: 4, rank: 3 }]);

    expect(added.length).toBe(1);
    expect(added[0].geometry.innerRadius).toBeGreaterThan(0);
  });

  it('valid move ring is a solid filled circle', async () => {
    const board = await import('../../client/board.js');
    const network = await import('../../client/network.js');

    network.serverBoard = Array.from({ length: 8 }, () => Array(8).fill(0));

    const added = [];
    const mockScene = {
      add: vi.fn((m) => added.push(m)),
      remove: vi.fn(),
    };

    board.highlightValidMoves(mockScene, [{ file: 4, rank: 3 }]);
    expect(added[0].geometry.innerRadius).toBe(0);
  });

  it('capture ring is larger than valid move ring', async () => {
    const board = await import('../../client/board.js');
    const network = await import('../../client/network.js');

    network.serverBoard = Array.from({ length: 8 }, () => Array(8).fill(0));
    network.serverBoard[3][3] = 7;

    const added = [];
    const mockScene = {
      add: vi.fn((m) => added.push(m)),
      remove: vi.fn(),
    };

    board.highlightValidMoves(mockScene, [
      { file: 4, rank: 3 },
      { file: 3, rank: 3 },
    ]);

    const validMesh = added.find((m) => m.position.x === 0.5);
    const captureMesh = added.find((m) => m.position.x === -0.5);

    expect(validMesh.geometry.outerRadius).toBeLessThan(captureMesh.geometry.outerRadius);
  });
});

// ═══════════════════════════════════════════════════════════
//  3D board — geometry/material reuse and mesh removal
// ═══════════════════════════════════════════════════════════

describe('3D board — geometry, material reuse, and mesh removal', () => {
  it('reuses shared geometries across highlight calls', async () => {
    const board = await import('../../client/board.js');
    const network = await import('../../client/network.js');

    network.serverBoard = Array.from({ length: 8 }, () => Array(8).fill(0));

    const added = [];
    const mockScene = {
      add: vi.fn((m) => added.push(m)),
      remove: vi.fn(),
    };

    board.highlightValidMoves(mockScene, [{ file: 4, rank: 3 }]);
    const firstGeo = added[0].geometry;

    board.highlightValidMoves(mockScene, [{ file: 3, rank: 3 }]);
    const secondGeo = added[1].geometry;

    expect(firstGeo).toBe(secondGeo);
  });

  it('removes prior meshes before creating new ones', async () => {
    const board = await import('../../client/board.js');
    const network = await import('../../client/network.js');

    network.serverBoard = Array.from({ length: 8 }, () => Array(8).fill(0));

    const added = [];
    const removed = [];
    const mockScene = {
      add: vi.fn((m) => {
        m.parent = mockScene;
        added.push(m);
      }),
      remove: vi.fn((m) => removed.push(m)),
    };

    // First highlight: 2 meshes added
    board.highlightValidMoves(mockScene, [
      { file: 4, rank: 3 },
      { file: 3, rank: 3 },
    ]);
    expect(added.length).toBe(2);
    expect(removed.length).toBe(0);

    // Second highlight: prior 2 removed, 1 new added
    board.highlightValidMoves(mockScene, [{ file: 2, rank: 3 }]);
    expect(removed.length).toBe(2);
    expect(added.length).toBe(3);

    // Verify removed meshes are the ones from the first call
    expect(removed[0]).toBe(added[0]);
    expect(removed[1]).toBe(added[1]);
  });

  it('no resource accumulation after many highlight cycles', async () => {
    const board = await import('../../client/board.js');
    const network = await import('../../client/network.js');

    network.serverBoard = Array.from({ length: 8 }, () => Array(8).fill(0));
    network.serverBoard[3][4] = 7;

    const added = [];
    const removed = [];
    const mockScene = {
      add: vi.fn((m) => {
        m.parent = mockScene;
        added.push(m);
      }),
      remove: vi.fn((m) => removed.push(m)),
    };

    for (let i = 0; i < 10; i++) {
      board.highlightValidMoves(mockScene, [
        { file: 4, rank: 3 },
        { file: 3, rank: 3 },
      ]);
      board.highlightValidMoves(mockScene, [{ file: 2, rank: 3 }]);
    }

    // 10 cycles × (2 + 1) = 30 adds
    // Removes: first call of each cycle removes nothing (0 prior),
    // second call removes 2 from first call. So 9 × 2 + 9 × 1 = 27 removes
    // Actually: cycle 1: add 2, add 1 (removes 2) = 2 removes
    // cycle 2-10: add 2 (removes 1), add 1 (removes 2) = 3 removes each
    // Total: 2 + 9 × 3 = 29 removes
    expect(added.length).toBe(30);
    expect(removed.length).toBe(29);
  });

  it('valid and capture meshes reuse exact material references without cloning', async () => {
    const board = await import('../../client/board.js');
    const network = await import('../../client/network.js');

    network.serverBoard = Array.from({ length: 8 }, () => Array(8).fill(0));
    network.serverBoard[3][3] = 7;

    // Configure distinct sentinel materials
    const matValid = { _sentinel: 'valid' };
    const matCapture = { _sentinel: 'capture' };
    board.setMaterials(
      { _sentinel: 'light' },
      { _sentinel: 'dark' },
      { _sentinel: 'selected' },
      matValid,
      matCapture,
      { _sentinel: 'check' },
      { _sentinel: 'previous' }
    );

    const added = [];
    const mockScene = {
      add: vi.fn((m) => added.push(m)),
      remove: vi.fn(),
    };

    board.highlightValidMoves(mockScene, [
      { file: 4, rank: 3 }, // valid (empty)
      { file: 3, rank: 3 }, // capture
    ]);

    const validMesh = added.find((m) => m.position.x === 0.5);
    const captureMesh = added.find((m) => m.position.x === -0.5);

    // Assert exact material identity (not clones)
    expect(validMesh.material).toBe(matValid);
    expect(captureMesh.material).toBe(matCapture);
  });
});
