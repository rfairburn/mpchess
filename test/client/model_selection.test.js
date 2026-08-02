import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Regression test: verify that loadPieceModels() requests the correct
// STL URLs based on the MODEL_SET configuration.

vi.mock('../../client/board.js', () => ({
  clearHighlights: vi.fn(),
  highlightCheck: vi.fn(),
  highlightPreviousMove: vi.fn(),
}));

vi.mock('../../client/ui.js', () => ({
  menuOpen: false,
  helpOpen: false,
  showMenu: vi.fn(),
  hideMenu: vi.fn(),
  updateMouseModeDisplay: vi.fn(),
  hidePromotionPicker: vi.fn(),
  hideConcedeConfirm: vi.fn(),
  mouseSensitivity: 0.002,
  showError: vi.fn(),
  showInfo: vi.fn(),
}));

vi.mock('../../client/controls.js', () => ({
  setCameraForRole: vi.fn(),
}));

describe('loadPieceModels — model set selection', () => {
  // Use mutable objects so closures in mocks always reference the same container
  const state = { urls: [], scales: [] };

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    state.urls.length = 0;
    state.scales.length = 0;

    // Mock STLLoader to capture URLs and scale calls
    vi.doMock('three/addons/loaders/STLLoader.js', () => {
      const mockGeometry = {
        computeBoundingBox: vi.fn(),
        boundingBox: {
          getSize: vi.fn().mockReturnValue({ x: 1, y: 1, z: 1 }),
          min: { x: 0, y: 0, z: 0 },
          max: { x: 1, y: 1, z: 1 },
        },
        scale: vi.fn((...args) => {
          state.scales.push(args);
        }),
        translate: vi.fn(),
        computeVertexNormals: vi.fn(),
      };
      return {
        STLLoader: vi.fn().mockImplementation(function () {
          return {
            load: vi.fn((url, onLoad) => {
              state.urls.push(url);
              if (onLoad) onLoad(mockGeometry);
            }),
          };
        }),
      };
    });

    // Stub WebSocket
    globalThis.WebSocket = class {
      constructor() {
        this.readyState = 1;
      }
      send() {}
      close() {}
    };

    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      },
      writable: true,
    });

    Object.defineProperty(globalThis, 'location', {
      value: { protocol: 'http:', host: 'localhost:3000' },
      writable: true,
    });

    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads all six STL files from the configured MODEL_SET directory', async () => {
    const pieces = await import('../../client/pieces.js');

    // Verify the default MODEL_SET
    expect(pieces.getModelSet()).toBe('simple-classic');

    const readyCalled = vi.fn();
    pieces.loadPieceModels({}, readyCalled);

    // All six piece URLs should have been requested
    expect(state.urls).toHaveLength(6);

    const expectedPieces = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
    for (const piece of expectedPieces) {
      expect(state.urls).toContain(`files/pieces/3d/simple-classic/${piece}.stl`);
    }

    // onReady should have been called
    expect(readyCalled).toHaveBeenCalledTimes(1);
  });

  it('loads from a different MODEL_SET when configured', async () => {
    const pieces = await import('../../client/pieces.js');

    // Switch to chuckamcknight
    pieces.setModelSet('chuckamcknight');

    const readyCalled = vi.fn();
    pieces.loadPieceModels({}, readyCalled);

    expect(state.urls).toHaveLength(6);

    const expectedPieces = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
    for (const piece of expectedPieces) {
      expect(state.urls).toContain(`files/pieces/3d/chuckamcknight/${piece}.stl`);
    }
  });

  it('applies smaller scale factor to pawns (0.55) than other pieces (0.7)', async () => {
    const pieces = await import('../../client/pieces.js');

    const readyCalled = vi.fn();
    pieces.loadPieceModels({}, readyCalled);

    // PIECE_TYPES order: pawn, knight, bishop, rook, queen, king
    const lastScales = state.scales.slice(-6);
    expect(lastScales).toHaveLength(6);

    const expected = [0.55, 0.7, 0.7, 0.7, 0.7, 0.7];
    for (let i = 0; i < 6; i++) {
      expect(lastScales[i]).toEqual([expected[i], expected[i], expected[i]]);
    }
  });
});

describe('SVG piece set — configuration', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('defaults to mpchess set', async () => {
    const pieces = await import('../../client/pieces.js');
    expect(pieces.getSvgPieceSet()).toBe('mpchess');
  });

  it('maps all 12 piece IDs to correct SVG filenames', async () => {
    const pieces = await import('../../client/pieces.js');

    const expected = {
      1: 'wP.svg',
      2: 'wN.svg',
      3: 'wB.svg',
      4: 'wR.svg',
      5: 'wQ.svg',
      6: 'wK.svg',
      7: 'bP.svg',
      8: 'bN.svg',
      9: 'bB.svg',
      10: 'bR.svg',
      11: 'bQ.svg',
      12: 'bK.svg',
    };
    for (const [id, fileName] of Object.entries(expected)) {
      const url = pieces.getPieceSvgUrl(Number(id));
      expect(url).toBe(`files/pieces/2d/mpchess/${fileName}`);
    }
  });

  it('setSvgPieceSet changes the directory in generated URLs', async () => {
    const pieces = await import('../../client/pieces.js');
    pieces.setSvgPieceSet('maestro');
    expect(pieces.getSvgPieceSet()).toBe('maestro');
    expect(pieces.getPieceSvgUrl(1)).toBe('files/pieces/2d/maestro/wP.svg');
    expect(pieces.getPieceSvgUrl(12)).toBe('files/pieces/2d/maestro/bK.svg');
  });
});
