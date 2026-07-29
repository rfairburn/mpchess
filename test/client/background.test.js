import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';

// Mock heavy dependencies before they're imported
vi.mock('../../client/board.js', () => ({
  createBoard: vi.fn(),
  setMaterials: vi.fn(),
  createLabels: vi.fn(),
  clearHighlights: vi.fn(),
  highlightCheck: vi.fn(),
  highlightValidMoves: vi.fn(),
  highlightSelected: vi.fn(),
  highlightPreviousMove: vi.fn(),
}));

vi.mock('../../client/pieces.js', () => ({
  setMaterials: vi.fn(),
  loadPieceModels: vi.fn((_scene, cb) => cb && cb()),
  animations: [],
  setScene: vi.fn(),
  animateMove: vi.fn(),
}));

vi.mock('../../client/ui.js', () => ({
  updateMouseModeDisplay: vi.fn(),
}));

vi.mock('../../client/controls.js', () => ({
  setRenderer: vi.fn(),
  setScene: vi.fn(),
  setClickHandler: vi.fn(),
  setDragHandlers: vi.fn(),
  keys: {},
  yaw: 0,
  pitch: 0,
  mouseLookOn: false,
  getJoystickVector: () => ({ x: 0, y: 0 }),
  getVJoyValue: () => 0,
}));

vi.mock('../../client/sound.js', () => ({
  init: vi.fn(),
}));

vi.mock('../../client/network.js', () => ({
  onMove: vi.fn(),
  serverBoard: null,
  serverTurn: null,
  previousMove: null,
}));

vi.mock('../../client/chess.mjs', () => ({
  findKing: vi.fn(),
  isInCheck: vi.fn(),
}));

describe('Scene background texture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads background.png via TextureLoader', async () => {
    await import('../../client/app.js');
    // Re-import the mock to get the tracking arrays after resetModules
    const mock = await import('three');
    expect(mock.textureLoaderCalls).toContain('./files/background.png');
  });

  it('sets EquirectangularReflectionMapping on the background texture', async () => {
    await import('../../client/app.js');
    const mock = await import('three');
    const bgTexture = mock.textureLoaderInstances.find(
      (t) => t.mapping === THREE.EquirectangularReflectionMapping
    );
    expect(bgTexture).toBeDefined();
  });

  it('assigns the loaded texture as scene.background', async () => {
    await import('../../client/app.js');
    const mock = await import('three');
    const scene = mock.sceneInstances[0];
    expect(scene.background).toBe(mock.textureLoaderInstances[0]);
  });
});
