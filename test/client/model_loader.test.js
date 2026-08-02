// ═══════════════════════════════════════════════════════════
//  MODEL LOADER — atomic, generation-aware loading tests
//  Tests deferred callbacks, overlapping loads, consecutive
//  reloads, and failure preservation.
// ═══════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock STLLoader with deferred callbacks
const deferredCallbacks = [];
vi.mock('three/addons/loaders/STLLoader.js', () => {
  return {
    STLLoader: class {
      load(url, onLoad, _onProgress, onError) {
        deferredCallbacks.push({ url, onLoad, onError });
      }
    },
  };
});

// Mock THREE
const Vector3 = class {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.z = 0;
  }
  set(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
};
vi.mock('three', () => ({
  default: { Vector3 },
  Vector3,
}));

// Create a mock geometry
function createMockGeometry(id) {
  const bbMin = { x: 0, y: 0, z: 0 };
  const bbMax = { x: 1, y: 1, z: 1 };
  return {
    id,
    disposed: false,
    boundingBox: {
      min: bbMin,
      max: bbMax,
      getSize: (v) => {
        v.x = 1;
        v.y = 1;
        v.z = 1;
        return v;
      },
    },
    scale: function (x, y, z) {
      return this;
    },
    translate: function () {
      return this;
    },
    computeBoundingBox: function () {
      return this;
    },
    computeVertexNormals: function () {
      return this;
    },
    dispose: function () {
      this.disposed = true;
    },
  };
}

describe('model loader — atomic, generation-aware', () => {
  beforeEach(() => {
    deferredCallbacks.length = 0;
    vi.resetModules();
  });

  it('should install geometries only on successful load', async () => {
    const pieces = await import('../../client/pieces.js');
    const { loadPieceModels } = pieces;

    const scene = {
      remove: vi.fn(),
      add: vi.fn(),
    };
    const onReady = vi.fn();

    loadPieceModels(scene, onReady);

    // Resolve all deferred callbacks
    deferredCallbacks.forEach((cb, i) => {
      cb.onLoad(createMockGeometry(`geo-${i}`));
    });

    expect(onReady).toHaveBeenCalled();
    // modelsLoaded should be true after successful load
    pieces.setModelsLoaded(true);
    expect(pieces.modelsLoaded).toBe(true);
  });

  it('should discard stale initial-load callback after reload', async () => {
    const pieces = await import('../../client/pieces.js');
    const { loadPieceModels, reloadPieceModels } = pieces;

    const scene = {
      remove: vi.fn(),
      add: vi.fn(),
    };
    const onLoad1 = vi.fn();
    const onLoad2 = vi.fn();

    // Start initial load
    loadPieceModels(scene, onLoad1);
    const initialCallbacks = [...deferredCallbacks];
    deferredCallbacks.length = 0;

    // Start reload before initial load completes
    reloadPieceModels(scene, onLoad2);
    const reloadCallbacks = [...deferredCallbacks];
    deferredCallbacks.length = 0;

    // Create geometries for each generation
    const initialGeos = initialCallbacks.map((_, i) => createMockGeometry(`initial-${i}`));
    const reloadGeos = reloadCallbacks.map((_, i) => createMockGeometry(`reload-${i}`));

    // Complete reload first (newest generation)
    reloadCallbacks.forEach((cb, i) => {
      cb.onLoad(reloadGeos[i]);
    });
    expect(onLoad2).toHaveBeenCalled();

    // Now complete initial load — should be discarded (stale)
    initialCallbacks.forEach((cb, i) => {
      cb.onLoad(initialGeos[i]);
    });
    expect(onLoad1).toHaveBeenCalled();

    // Stale initial geometries should be disposed
    expect(initialGeos.every((g) => g.disposed)).toBe(true);
    // Reload geometries should NOT be disposed (they were installed)
    expect(reloadGeos.every((g) => !g.disposed)).toBe(true);
  });

  it('should only install the latest of consecutive reloads', async () => {
    const pieces = await import('../../client/pieces.js');
    const { reloadPieceModels } = pieces;

    const scene = {
      remove: vi.fn(),
      add: vi.fn(),
    };
    const onReady1 = vi.fn();
    const onReady2 = vi.fn();

    // Start first reload
    reloadPieceModels(scene, onReady1);
    const reload1Callbacks = [...deferredCallbacks];
    deferredCallbacks.length = 0;

    // Start second reload before first completes
    reloadPieceModels(scene, onReady2);
    const reload2Callbacks = [...deferredCallbacks];
    deferredCallbacks.length = 0;

    // Create geometries for each generation
    const r1Geos = reload1Callbacks.map((_, i) => createMockGeometry(`r1-${i}`));
    const r2Geos = reload2Callbacks.map((_, i) => createMockGeometry(`r2-${i}`));

    // Complete second reload FIRST — should install (latest)
    reload2Callbacks.forEach((cb, i) => {
      cb.onLoad(r2Geos[i]);
    });
    expect(onReady2).toHaveBeenCalled();
    // Latest geometries should NOT be disposed
    expect(r2Geos.every((g) => !g.disposed)).toBe(true);

    // Complete first reload AFTER — should be discarded (stale)
    reload1Callbacks.forEach((cb, i) => {
      cb.onLoad(r1Geos[i]);
    });
    expect(onReady1).toHaveBeenCalled();

    // Stale first-reload geometries should be disposed
    expect(r1Geos.every((g) => g.disposed)).toBe(true);
    // Latest second-reload geometries should STILL NOT be disposed
    expect(r2Geos.every((g) => !g.disposed)).toBe(true);
  });

  it('should preserve active cache on load failure', async () => {
    const pieces = await import('../../client/pieces.js');
    const { loadPieceModels, reloadPieceModels } = pieces;

    const scene = {
      remove: vi.fn(),
      add: vi.fn(),
    };
    const onReady1 = vi.fn();
    const onReady2 = vi.fn();

    // Initial load succeeds
    loadPieceModels(scene, onReady1);
    const initialCallbacks = [...deferredCallbacks];
    deferredCallbacks.length = 0;
    const initialGeos = initialCallbacks.map((_, i) => createMockGeometry(`initial-${i}`));
    initialCallbacks.forEach((cb, i) => {
      cb.onLoad(initialGeos[i]);
    });
    expect(onReady1).toHaveBeenCalled();

    // Start reload that will fail
    reloadPieceModels(scene, onReady2);
    const reloadCallbacks = [...deferredCallbacks];
    deferredCallbacks.length = 0;

    // Trigger failure on first piece
    if (reloadCallbacks[0]) {
      reloadCallbacks[0].onError(new Error('Load failed'));
    }
    expect(onReady2).toHaveBeenCalled();

    // Simulate a late callback arriving after failure
    const lateGeo = createMockGeometry('late');
    if (reloadCallbacks[1]) {
      reloadCallbacks[1].onLoad(lateGeo);
    }
    // Late geometry should be disposed
    expect(lateGeo.disposed).toBe(true);

    // Active cache should still have geometries from initial load (undisposed)
    expect(initialGeos.every((g) => !g.disposed)).toBe(true);
    // modelsLoaded should still be true
    expect(pieces.modelsLoaded).toBe(true);
  });

  it('should dispose temporary geometries on failure', async () => {
    const pieces = await import('../../client/pieces.js');
    const { reloadPieceModels } = pieces;

    const scene = {
      remove: vi.fn(),
      add: vi.fn(),
    };
    const onReady = vi.fn();

    // Start reload
    reloadPieceModels(scene, onReady);
    const reloadCallbacks = [...deferredCallbacks];
    deferredCallbacks.length = 0;

    // Simulate partial load then failure
    const partialGeo = createMockGeometry('partial');
    if (reloadCallbacks[0]) {
      reloadCallbacks[0].onLoad(partialGeo);
    }
    // Fail on second piece
    if (reloadCallbacks[1]) {
      reloadCallbacks[1].onError(new Error('Load failed'));
    }

    expect(onReady).toHaveBeenCalled();
    // The partial geometry should be disposed
    expect(partialGeo.disposed).toBe(true);
  });
});

describe('piece set extensions — production', () => {
  it('should return webp extension for monarchy set', async () => {
    const pieces = await import('../../client/pieces.js');
    pieces.setSvgPieceSet('monarchy');
    expect(pieces.getPieceSetExtension()).toBe('webp');
    expect(pieces.getPieceSvgUrl(1)).toBe('files/pieces/2d/monarchy/wP.webp');
    expect(pieces.getPieceAssetUrl('bQ')).toBe('files/pieces/2d/monarchy/bQ.webp');
  });

  it('should return svg extension for default set', async () => {
    const pieces = await import('../../client/pieces.js');
    pieces.setSvgPieceSet('mpchess');
    expect(pieces.getPieceSetExtension()).toBe('svg');
    expect(pieces.getPieceSvgUrl(1)).toBe('files/pieces/2d/mpchess/wP.svg');
    expect(pieces.getPieceAssetUrl('wP')).toBe('files/pieces/2d/mpchess/wP.svg');
  });
});
