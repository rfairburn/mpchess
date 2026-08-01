// ═══════════════════════════════════════════════════════════
//  3D BOARD — highlight rendering
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
let arrowCallback = null;
vi.mock('../../client/arrows.js', () => ({
  getArrows: vi.fn(() => []),
  onArrowChange: vi.fn((cb) => {
    arrowCallback = cb;
  }),
  getArrowPath: vi.fn((f, t) => [f, t]),
}));

// Mock highlights module so we can control what getHighlights returns
const mockHighlights = [];
let highlightCallback = null;
vi.mock('../../client/highlights.js', () => ({
  getHighlights: vi.fn(() => mockHighlights),
  onHighlightChange: vi.fn((cb) => {
    highlightCallback = cb;
  }),
}));

describe('3D board — highlight rendering', () => {
  beforeEach(() => {
    vi.resetModules();
    mockHighlights.length = 0;
  });

  it('initHighlights3D creates highlight group added to scene', async () => {
    const THREE = await import('three');
    const board = await import('../../client/board.js');

    const scene = new THREE.Scene();
    board.initHighlights3D(scene);

    const group = scene.children.find((c) => c.name === 'highlightGroup');
    expect(group).toBeDefined();
    expect(group.children).toHaveLength(0);
  });

  it('renders a plane mesh per highlight', async () => {
    const THREE = await import('three');
    const hl = await import('../../client/highlights.js');
    hl.getHighlights.mockReturnValue([{ file: 3, rank: 4, color: '#ff4444' }]);

    const board = await import('../../client/board.js');
    const scene = new THREE.Scene();
    board.initHighlights3D(scene);

    // Trigger render
    highlightCallback();

    const group = scene.children.find((c) => c.name === 'highlightGroup');
    expect(group.children.length).toBe(1);
  });

  it('highlight plane has correct position for square', async () => {
    const THREE = await import('three');
    const hl = await import('../../client/highlights.js');
    hl.getHighlights.mockReturnValue([{ file: 3, rank: 4, color: '#ff4444' }]);

    const board = await import('../../client/board.js');
    const scene = new THREE.Scene();
    board.initHighlights3D(scene);

    highlightCallback();

    const mesh = scene.children.find((c) => c.name === 'highlightGroup').children[0];
    expect(mesh.position.x).toBe(3 - 3.5);
    expect(mesh.position.z).toBe(3.5 - 4);
  });

  it('highlight Y is below arrow Y to avoid coloring arrows', async () => {
    const THREE = await import('three');
    const hl = await import('../../client/highlights.js');
    hl.getHighlights.mockReturnValue([{ file: 0, rank: 0, color: '#fff' }]);

    const board = await import('../../client/board.js');
    const scene = new THREE.Scene();
    board.initHighlights3D(scene);

    highlightCallback();

    const mesh = scene.children.find((c) => c.name === 'highlightGroup').children[0];
    // ARROW_Y = 0.065, HIGHLIGHT_Y = 0.042 (0.001 above square)
    expect(mesh.position.y).toBeLessThan(0.065);
    expect(mesh.position.y).toBeCloseTo(0.042, 4);
  });

  it('highlight plane is rotated flat on the board', async () => {
    const THREE = await import('three');
    const hl = await import('../../client/highlights.js');
    hl.getHighlights.mockReturnValue([{ file: 0, rank: 0, color: '#fff' }]);

    const board = await import('../../client/board.js');
    const scene = new THREE.Scene();
    board.initHighlights3D(scene);

    highlightCallback();

    const mesh = scene.children.find((c) => c.name === 'highlightGroup').children[0];
    expect(mesh.rotation.x).toBe(-Math.PI / 2);
  });

  it('shared geometry is reused across multiple highlights', async () => {
    const THREE = await import('three');
    const hl = await import('../../client/highlights.js');
    hl.getHighlights.mockReturnValue([
      { file: 0, rank: 0, color: '#ff0000' },
      { file: 1, rank: 1, color: '#00ff00' },
    ]);

    const board = await import('../../client/board.js');
    const scene = new THREE.Scene();
    board.initHighlights3D(scene);

    highlightCallback();

    const group = scene.children.find((c) => c.name === 'highlightGroup');
    expect(group.children.length).toBe(2);
    expect(group.children[0].geometry).toBe(group.children[1].geometry);
  });

  it('highlight renderOrder is lower than arrow renderOrder', async () => {
    const THREE = await import('three');
    const hl = await import('../../client/highlights.js');
    hl.getHighlights.mockReturnValue([{ file: 0, rank: 0, color: '#fff' }]);

    const arrows = await import('../../client/arrows.js');
    arrows.getArrows.mockReturnValue([
      { from: { file: 0, rank: 0 }, to: { file: 1, rank: 1 }, color: '#fff' },
    ]);

    const board = await import('../../client/board.js');
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    board.initArrows3D(scene, camera);
    board.initHighlights3D(scene);

    // Trigger both renders
    arrowCallback();
    highlightCallback();

    const arrowMesh = scene.children.find((c) => c.name === 'arrowGroup').children[0];
    const hlMesh = scene.children.find((c) => c.name === 'highlightGroup').children[0];

    // Highlight must render before arrow so arrow draws on top
    expect(hlMesh.renderOrder).toBeLessThan(arrowMesh.renderOrder);
  });
});
