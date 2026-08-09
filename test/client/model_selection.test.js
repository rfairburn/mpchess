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
  settingsOpen: false,
  helpOpen: false,
  showMenu: vi.fn(),
  hideMenu: vi.fn(),
  updateMouseModeDisplay: vi.fn(),
  hidePromotionPicker: vi.fn(),
  hideConcedeConfirm: vi.fn(),
  mouseSensitivity: 0.002,
  showError: vi.fn(),
  setThreeScene: vi.fn(),
  showInfo: vi.fn(),
}));

vi.mock('../../client/controls.js', () => ({
  setCameraForRole: vi.fn(),
}));

describe('loadPieceModels — model set selection', () => {
  // Use mutable objects so closures in mocks always reference the same container
  const state = { urls: [], scales: [] };
  // Shared mock geometry so tests can modify it before import
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

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    state.urls.length = 0;
    state.scales.length = 0;
    // Restore mockGeometry defaults for test isolation
    mockGeometry.boundingBox.getSize.mockReturnValue({ x: 1, y: 1, z: 1 });
    delete mockGeometry.attributes;
    mockGeometry.translate.mockReset();

    // Mock STLLoader to capture URLs and scale calls
    vi.doMock('three/addons/loaders/STLLoader.js', () => {
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

    // Pawn scale should be smaller than other pieces (0.55 target vs 0.7 target)
    const pawnScale = lastScales[0][0];
    const otherScale = lastScales[1][0];
    expect(pawnScale).toBeLessThan(otherScale);
    // Ratio should match 0.55/0.7
    expect(pawnScale / otherScale).toBeCloseTo(0.55 / 0.7, 4);
  });

  it('scales and centers from base geometry, not full bounding box', async () => {
    // Build a mock geometry with an offset octagonal base and wider upper protrusion.
    // Base: 8 vertices at y=0, radius 0.5, centered at (1, 0, 1)
    // Upper: 4 vertices at y=1, radius 1.0, centered at (1, 1, 1)
    const baseR = 0.5;
    const baseCx = 1,
      baseCz = 1;
    const positions = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      positions.push(baseCx + baseR * Math.cos(a), 0, baseCz + baseR * Math.sin(a));
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      positions.push(baseCx + 1.0 * Math.cos(a), 1, baseCz + 1.0 * Math.sin(a));
    }

    const captured = { translates: [] };
    // Configure shared mock geometry for this test
    mockGeometry.boundingBox.getSize.mockReturnValue({ x: 3, y: 1, z: 3 });
    mockGeometry.attributes = {
      position: {
        count: 12,
        array: new Float32Array(positions),
        getX: (i) => positions[i * 3],
        getY: (i) => positions[i * 3 + 1],
        getZ: (i) => positions[i * 3 + 2],
      },
    };
    mockGeometry.translate.mockImplementation(function (...args) {
      captured.translates.push(args);
      return this;
    });

    const pieces = await import('../../client/pieces.js');
    pieces.loadPieceModels({}, vi.fn());

    // First translate should center on base center (1, 1), not bbox center (1.5, 1.5)
    expect(captured.translates[0]).toEqual([-baseCx, 0, -baseCz]);

    // Scale should use base diameter (0.5 * 2 = 1.0), not bbox width (3)
    // First piece loaded is "pawn" which uses targetSize 0.55
    const lastScales = state.scales.slice(-6);
    const scaleFactor = lastScales[0][0];
    expect(scaleFactor).toBeCloseTo(0.55 / (baseR * 2), 4);
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
