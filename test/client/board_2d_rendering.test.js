// ═══════════════════════════════════════════════════════════
//  2D BOARD — black perspective rendering regression test
//  Separate file to avoid mobile-mocks.js vi.mock conflict.
// ═══════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../client/network.js', () => ({
  myRole: 'black',
  serverBoard: null,
  serverTurn: 'white',
  serverPromotingPiece: null,
  serverGameOver: false,
  serverGameResult: null,
  moveHistory: [],
  previousMove: null,
  seatStatus: {},
  tokenKey: (color) => `mpchess_session_${color}`,
  halfmoveClock: 0,
  threefoldCount: 0,
  canClaimDraw: false,
  sendPromotion: vi.fn(),
  sendRestart: vi.fn(),
  sendConcede: vi.fn(),
  sendLeave: vi.fn(),
  sendExportFen: vi.fn(),
  sendExportPgn: vi.fn(),
  sendImportFen: vi.fn(),
  sendOfferDraw: vi.fn(),
  sendDrawResponse: vi.fn(),
  sendClaimDraw: vi.fn(),
  onStateUpdate: vi.fn(),
  onRestart: vi.fn(),
  onError: vi.fn(),
  onInfo: vi.fn(),
  onDrawOffer: vi.fn(),
  onDrawResult: vi.fn(),
  onDrawOfferCancelled: vi.fn(),
  onPlayerLeft: vi.fn(),
  onFenImportWarning: vi.fn(),
  onPromotion: vi.fn(),
}));

vi.mock('../../client/capabilities.js', () => ({
  isTouchDevice: () => false,
  isCoarsePointer: () => false,
  isMobilePhone: () => false,
  isMobileLayout: () => false,
}));

vi.mock('../../client/ui.js', () => ({
  showError: vi.fn(),
  setThreeScene: vi.fn(),
}));

vi.mock('../../client/sound.js', () => ({
  playMove: vi.fn(),
}));

describe('board_2d black perspective rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = `
      <div id="board-2d-overlay"><div id="board-2d-container"></div></div>
    `;

    // Mock ResizeObserver (not available in JSDOM)
    if (!globalThis.window.ResizeObserver) {
      globalThis.window.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    }
  });

  it('reverses file order and keeps bottom-right square light', async () => {
    const { toggle2DBoard } = await import('../../client/board_2d.js');
    const network = await import('../../client/network.js');

    // Place white rook at a8 (rank=7, file=0) and black rook at h8 (rank=7, file=7)
    network.serverBoard = Array(8)
      .fill(null)
      .map(() => Array(8).fill(0));
    network.serverBoard[7][0] = 4; // white rook at a8
    network.serverBoard[7][7] = 10; // black rook at h8

    toggle2DBoard();

    const grid = document.querySelector('.board2d-grid');
    const squares = grid.querySelectorAll('.board2d-square');

    // Flipped: bottom row (displayRank 7) = rank 8
    // File reversal: display file 0 = h-file, display file 7 = a-file
    const bottomRow = Array.from(squares).slice(56, 64);

    // Bottom-left (display file 0) = h1 = black rook
    const bottomLeftPiece = bottomRow[0].querySelector('.board2d-piece');
    expect(bottomLeftPiece?.src).toContain('bR.svg');

    // Bottom-right (display file 7) = a1 = white rook
    const bottomRightPiece = bottomRow[7].querySelector('.board2d-piece');
    expect(bottomRightPiece?.src).toContain('wR.svg');

    // White-on-right: bottom-right square must be light
    expect(bottomRow[7].classList.contains('light')).toBe(true);
  });
});
