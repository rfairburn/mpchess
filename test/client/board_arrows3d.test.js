// ═══════════════════════════════════════════════════════════
//  3D BOARD — arrow geometry
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
vi.mock('../../client/arrows.js', () => ({
  getArrows: vi.fn(() => []),
  onArrowChange: vi.fn(),
  getArrowPath: vi.fn((f, t) => [f, t]),
}));

describe('3D board — arrow geometry', () => {
  beforeEach(() => {
    vi.resetModules();
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
});
