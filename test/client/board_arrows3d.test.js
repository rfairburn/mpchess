// ═══════════════════════════════════════════════════════════
//  3D BOARD — arrow geometry and material
// ═══════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../client/network.js', () => ({
  serverBoard: null,
  serverTurn: 'white',
  previousMove: null,
}));
vi.mock('../../client/chess.mjs', () => ({
  findKing: vi.fn(),
  isInCheck: vi.fn(),
}));

let mockArrows = [];
let arrowCallback = null;
vi.mock('../../client/arrows.js', () => ({
  getArrows: vi.fn(() => mockArrows),
  onArrowChange: vi.fn((cb) => {
    arrowCallback = cb;
  }),
  getArrowPath: vi.fn((f, t) => [f, t]),
}));

describe('3D board — arrow geometry', () => {
  beforeEach(() => {
    vi.resetModules();
    mockArrows.length = 0;
    arrowCallback = null;
  });

  it('initArrows3D creates arrow group with camera', async () => {
    const THREE = await import('three');
    const { initArrows3D } = await import('../../client/board.js');

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    initArrows3D(scene, camera);

    const arrowGroup = scene.children.find((c) => c.name === 'arrowGroup');
    expect(arrowGroup).toBeDefined();
    expect(arrowGroup.children).toHaveLength(0); // no arrows yet
  });

  it('arrow material is transparent with depthWrite false for renderOrder control', async () => {
    const THREE = await import('three');
    const arrows = await import('../../client/arrows.js');
    arrows.getArrows.mockReturnValue([
      { from: { file: 0, rank: 0 }, to: { file: 1, rank: 1 }, color: '#ffffff' },
    ]);

    const { initArrows3D } = await import('../../client/board.js');
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    initArrows3D(scene, camera);

    arrowCallback();

    const arrowGroup = scene.children.find((c) => c.name === 'arrowGroup');
    expect(arrowGroup.children.length).toBe(1);
    const mesh = arrowGroup.children[0];

    // Arrow must be in transparent pass so renderOrder works with highlights
    expect(mesh.material.transparent).toBe(true);
    expect(mesh.material.opacity).toBe(1);
    expect(mesh.material.depthWrite).toBe(false);
  });

  it('renders newer arrows above older arrows', async () => {
    const THREE = await import('three');
    const arrows = await import('../../client/arrows.js');
    arrows.getArrows.mockReturnValue([
      { from: { file: 0, rank: 0 }, to: { file: 1, rank: 1 }, color: '#fff' },
      { from: { file: 2, rank: 2 }, to: { file: 3, rank: 3 }, color: '#fff' },
    ]);

    const { initArrows3D } = await import('../../client/board.js');
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    initArrows3D(scene, camera);
    arrowCallback();

    const group = scene.children.find((child) => child.name === 'arrowGroup');
    expect(group.children.map((arrow) => arrow.renderOrder)).toEqual([1, 2]);
  });
});
