// ═══════════════════════════════════════════════════════════
//  3D BOARD — highlight rendering
// ═══════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const appSource = readFileSync(join(__dirname, '../../client/app.js'), 'utf-8');

vi.mock('../../client/network.js', () => ({
  onEvaluation: vi.fn(),
  serverEvaluation: null,
  serverBoard: null,
  serverTurn: 'white',
  previousMove: null,
}));
vi.mock('../../shared/chess.mjs', () => ({
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
  let boardModule = null;

  beforeEach(() => {
    vi.resetModules();
    mockHighlights.length = 0;
  });

  afterEach(() => {
    // Dispose the animation-frame loop from the last test
    if (boardModule && boardModule.disposeArrows3D) {
      boardModule.disposeArrows3D();
    }
    boardModule = null;
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

    boardModule = await import('../../client/board.js');
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    boardModule.initArrows3D(scene, camera);
    boardModule.initHighlights3D(scene);

    // Trigger both renders
    arrowCallback();
    highlightCallback();

    const arrowMesh = scene.children.find((c) => c.name === 'arrowGroup').children[0];
    const hlMesh = scene.children.find((c) => c.name === 'highlightGroup').children[0];

    // Highlight must render before arrow so arrow draws on top
    expect(hlMesh.renderOrder).toBeLessThan(arrowMesh.renderOrder);
  });
});

// ═══════════════════════════════════════════════════════════
//  Phase 3B — app.js premove material definitions (source-level)
//  The three.js mock does not retain the source hex, so the exact hue and
//  intensity wiring in app.js is asserted against the real source. This
//  mirrors the CSS-source assertions in board_2d_highlight_stacking.test.js.
// ═══════════════════════════════════════════════════════════

describe('app.js — premove material definitions (Phase 3B)', () => {
  const PREMOVE_MATERIALS = [
    'matPremoveSelected',
    'matPremoveMove',
    'matPremoveCapture',
    'matPremoveConfirmed',
  ];

  function materialBlock(name) {
    const re = new RegExp(
      `const ${name} = new THREE\\.MeshStandardMaterial\\(\\{[\\s\\S]*?\\}\\);`
    );
    const m = appSource.match(re);
    expect(m, `material ${name} not found in app.js`).toBeTruthy();
    return m[0];
  }

  function intensityOf(block) {
    const m = block.match(/emissiveIntensity:\s*([\d.]+)/);
    expect(m, 'emissiveIntensity not found').toBeTruthy();
    return parseFloat(m[1]);
  }

  it('defines all four premove materials with the deep royal blue hue 0x1e5ac8', () => {
    for (const name of PREMOVE_MATERIALS) {
      expect(materialBlock(name)).toContain('0x1e5ac8');
    }
  });

  it('uses a dimmer intensity for the choosing states than the confirmed fill', () => {
    const confirmed = intensityOf(materialBlock('matPremoveConfirmed'));
    for (const name of ['matPremoveSelected', 'matPremoveMove', 'matPremoveCapture']) {
      expect(confirmed).toBeGreaterThan(intensityOf(materialBlock(name)));
    }
  });

  it('never uses the bright Alt annotation blue (0x4488ff) or a brighter blue for premoves', () => {
    for (const name of PREMOVE_MATERIALS) {
      const block = materialBlock(name);
      expect(block).not.toContain('0x4488ff');
      expect(block).not.toContain('0x3366ff');
    }
  });

  it('passes all four premove materials to setBoardMaterials', () => {
    const call = appSource.match(/setBoardMaterials\(([\s\S]*?)\);/);
    expect(call, 'setBoardMaterials call not found').toBeTruthy();
    for (const name of PREMOVE_MATERIALS) {
      expect(call[1]).toContain(name);
    }
  });
});

// ═══════════════════════════════════════════════════════════
//  Phase 3B — confirmed premove squares (3D runtime behavior)
//  Covers: confirmation/restore/clear/replace, board rebuild, material
//  reset, deterministic precedence, and leak/duplicate-mesh guards.
// ═══════════════════════════════════════════════════════════

describe('3D board — confirmed premove squares (Phase 3B)', () => {
  let THREE, board, premove, selection, network, chess, orchestration;
  let scene, mats, matBorder;

  // e2–e4 premove used throughout: from (4,1) to (4,3)
  const PRE = { fromFile: 4, fromRank: 1, toFile: 4, toRank: 3 };

  function emptyBoard() {
    return Array(8)
      .fill(null)
      .map(() => Array(8).fill(0));
  }

  function makeMats(THREE) {
    const std = (color, emissive, emissiveIntensity) =>
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.7,
        emissive: new THREE.Color(emissive),
        emissiveIntensity,
      });
    return {
      light: new THREE.MeshStandardMaterial({ color: 0xf0d9b5, roughness: 0.7 }),
      dark: new THREE.MeshStandardMaterial({ color: 0xb58863, roughness: 0.7 }),
      selected: std(0xf0d9b5, 0x88aa00, 0.6),
      validMove: std(0xf0d9b5, 0x44bb44, 0.5),
      captureMove: std(0xb58863, 0xcc3333, 0.5),
      check: std(0xb58863, 0xff0000, 0.8),
      previousMove: std(0xf0d9b5, 0xe8a830, 0.45),
      premoveSelected: std(0xf0d9b5, 0x1e5ac8, 0.5),
      premoveMove: std(0xf0d9b5, 0x1e5ac8, 0.5),
      premoveCapture: std(0xb58863, 0x1e5ac8, 0.5),
      premoveConfirmed: std(0xf0d9b5, 0x1e5ac8, 0.8),
    };
  }

  async function setup() {
    THREE = await import('three');
    board = await import('../../client/board.js');
    premove = await import('../../client/premove.js');
    selection = await import('../../client/selection.js');
    network = await import('../../client/network.js');
    chess = await import('../../shared/chess.mjs');
    orchestration = await import('../../client/highlight-orchestration.js');

    network.serverBoard = emptyBoard();
    network.serverTurn = 'white';
    network.previousMove = null;
    chess.findKing.mockReturnValue(null);
    chess.isInCheck.mockReturnValue(false);

    mats = makeMats(THREE);
    matBorder = new THREE.MeshStandardMaterial({ color: 0x5c3a1e, roughness: 0.6 });

    scene = new THREE.Scene();
    board.setMaterials(
      mats.light,
      mats.dark,
      mats.selected,
      mats.validMove,
      mats.captureMove,
      mats.check,
      mats.previousMove,
      mats.premoveSelected,
      mats.premoveMove,
      mats.premoveCapture,
      mats.premoveConfirmed
    );
    board.createBoard(scene, matBorder);
  }

  function expectEmissive(file, rank, hex, intensity) {
    const m = board.squares[rank][file].material;
    expect(m.emissive.r).toBeCloseTo(((hex >> 16) & 255) / 255, 5);
    expect(m.emissive.g).toBeCloseTo(((hex >> 8) & 255) / 255, 5);
    expect(m.emissive.b).toBeCloseTo((hex & 255) / 255, 5);
    expect(m.emissiveIntensity).toBeCloseTo(intensity, 5);
  }

  function expectBase(file, rank) {
    const m = board.squares[rank][file].material;
    expect(m.emissive.r).toBe(0);
    expect(m.emissive.g).toBe(0);
    expect(m.emissive.b).toBe(0);
    expect(m.emissiveIntensity).toBe(0);
  }

  // Wire the shared orchestrator to the real 3D board renderers so tests can
  // exercise the production select/deselect/update flow end-to-end.
  function makeOrchestrator() {
    return orchestration.createHighlightOrchestrator({
      clearHighlights: board.clearHighlights,
      highlightPreviousMove: board.highlightPreviousMove,
      highlightSelected: board.highlightSelected,
      highlightValidMoves: (moves) => board.highlightValidMoves(scene, moves),
      highlightCheck: board.highlightCheck,
      highlightPremoveSelected: board.highlightPremoveSelected,
      highlightPremoveMoves: (moves) => board.highlightPremoveMoves(scene, moves),
    });
  }

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (premove) premove.clearPremove();
    if (selection) selection.clearSelection();
  });

  // ── Confirmation / restore / clear / replace ────────────

  it('confirmation fills both origin and destination with the confirmed material', async () => {
    await setup();
    premove.setPremove(PRE);

    expect(board.getPremoveConfirmedSquares()).toEqual(PRE);
    expectEmissive(PRE.fromFile, PRE.fromRank, 0x1e5ac8, 0.8);
    expectEmissive(PRE.toFile, PRE.toRank, 0x1e5ac8, 0.8);
    // A non-premove square is untouched
    expectBase(0, 0);
  });

  it('clearing the premove resets both squares to base (no stale fill)', async () => {
    await setup();
    premove.setPremove(PRE);
    expectEmissive(PRE.fromFile, PRE.fromRank, 0x1e5ac8, 0.8);

    premove.clearPremove();

    expect(board.getPremoveConfirmedSquares()).toBeNull();
    expectBase(PRE.fromFile, PRE.fromRank);
    expectBase(PRE.toFile, PRE.toRank);
  });

  it('re-setting the premove after a clear re-applies the fill (reconnect restore)', async () => {
    await setup();
    premove.setPremove(PRE);
    premove.clearPremove();
    expectBase(PRE.fromFile, PRE.fromRank);

    // Reconnect restore: the state handler re-sends the pending premove
    premove.setPremove(PRE);

    expectEmissive(PRE.fromFile, PRE.fromRank, 0x1e5ac8, 0.8);
    expectEmissive(PRE.toFile, PRE.toRank, 0x1e5ac8, 0.8);
  });

  it('replacing a premove drops the old fill and applies the new one', async () => {
    await setup();
    premove.setPremove(PRE);
    expectEmissive(PRE.fromFile, PRE.fromRank, 0x1e5ac8, 0.8);

    const next = { fromFile: 0, fromRank: 1, toFile: 0, toRank: 3 };
    premove.setPremove(next);

    // Old squares cleared, new squares filled
    expectBase(PRE.fromFile, PRE.fromRank);
    expectBase(PRE.toFile, PRE.toRank);
    expectEmissive(next.fromFile, next.fromRank, 0x1e5ac8, 0.8);
    expectEmissive(next.toFile, next.toRank, 0x1e5ac8, 0.8);
    expect(board.getPremoveConfirmedSquares()).toEqual(next);
  });

  it('a spectator (no premove state) sees no confirmed fill', async () => {
    await setup();
    expect(premove.getPremove()).toBeNull();
    expect(board.getPremoveConfirmedSquares()).toBeNull();
    expectBase(PRE.fromFile, PRE.fromRank);
    expectBase(PRE.toFile, PRE.toRank);
  });

  // ── Board rebuild & material reset ──────────────────────

  it('board rebuild (createBoard) re-applies the confirmed premove on fresh squares', async () => {
    await setup();
    premove.setPremove(PRE);
    expectEmissive(PRE.fromFile, PRE.fromRank, 0x1e5ac8, 0.8);

    // Simulate a full board rebuild into a fresh scene
    const scene2 = new THREE.Scene();
    board.createBoard(scene2, matBorder);

    // The fresh square meshes carry the confirmed fill
    expectEmissive(PRE.fromFile, PRE.fromRank, 0x1e5ac8, 0.8);
    expectEmissive(PRE.toFile, PRE.toRank, 0x1e5ac8, 0.8);
  });

  it('material reset (setMaterials) re-renders the confirmed premove with the new materials', async () => {
    await setup();
    premove.setPremove(PRE);
    expectEmissive(PRE.fromFile, PRE.fromRank, 0x1e5ac8, 0.8);

    // Theme change: a new confirmed material at a different intensity
    const newMats = makeMats(THREE);
    newMats.premoveConfirmed = new THREE.MeshStandardMaterial({
      color: 0xf0d9b5,
      roughness: 0.7,
      emissive: new THREE.Color(0x1e5ac8),
      emissiveIntensity: 0.9,
    });
    board.setMaterials(
      newMats.light,
      newMats.dark,
      newMats.selected,
      newMats.validMove,
      newMats.captureMove,
      newMats.check,
      newMats.previousMove,
      newMats.premoveSelected,
      newMats.premoveMove,
      newMats.premoveCapture,
      newMats.premoveConfirmed
    );

    // The confirmed squares now use the new material's intensity
    expectEmissive(PRE.fromFile, PRE.fromRank, 0x1e5ac8, 0.9);
    expectEmissive(PRE.toFile, PRE.toRank, 0x1e5ac8, 0.9);
  });

  // ── Deterministic precedence ────────────────────────────

  it('confirmed premove beats previous-move on a shared square', async () => {
    await setup();
    // Previous move a1–a2; premove a2–a4 share the a2 square
    network.previousMove = { fromFile: 0, fromRank: 0, toFile: 0, toRank: 1 };
    premove.setPremove({ fromFile: 0, fromRank: 1, toFile: 0, toRank: 3 });

    board.highlightPreviousMove();

    // a2 is the confirmed origin → confirmed wins over previous-move
    expectEmissive(0, 1, 0x1e5ac8, 0.8);
    // a1 is only a previous-move square → previous-move fill
    expectEmissive(0, 0, 0xe8a830, 0.45);
  });

  it('confirmed premove beats the current selection on a shared square', async () => {
    await setup();
    premove.setPremove(PRE);

    // Selecting the confirmed origin must not overwrite the confirmed fill
    board.highlightSelected(PRE.fromFile, PRE.fromRank);

    expectEmissive(PRE.fromFile, PRE.fromRank, 0x1e5ac8, 0.8);
  });

  it('check overwrites the confirmed premove fill (highest precedence)', async () => {
    await setup();
    premove.setPremove(PRE);
    expectEmissive(PRE.fromFile, PRE.fromRank, 0x1e5ac8, 0.8);

    // The king in check sits on the confirmed origin square
    chess.findKing.mockReturnValue({ file: PRE.fromFile, rank: PRE.fromRank });
    chess.isInCheck.mockReturnValue(true);
    board.highlightCheck();

    expectEmissive(PRE.fromFile, PRE.fromRank, 0xff0000, 0.8);
  });

  it('clearing a confirmed square restores the underlying previous-move/selection state', async () => {
    await setup();
    // Previous move e2–f2 shares only the premove origin (e2), not the
    // destination (e4), so the two underlying states can be distinguished.
    network.previousMove = { fromFile: 4, fromRank: 1, toFile: 5, toRank: 1 };
    premove.setPremove(PRE);
    expectEmissive(PRE.fromFile, PRE.fromRank, 0x1e5ac8, 0.8);

    premove.clearPremove();

    // The origin was also a previous-move square → previous-move restored
    expectEmissive(PRE.fromFile, PRE.fromRank, 0xe8a830, 0.45);
    // The destination was not a previous-move square → base
    expectBase(PRE.toFile, PRE.toRank);
  });

  it('check beats previous-move regardless of event order', async () => {
    await setup();
    // Previous move e2–e4; the in-check king sits on e4 (a previous-move square).
    network.previousMove = { fromFile: 4, fromRank: 1, toFile: 4, toRank: 3 };
    chess.findKing.mockReturnValue({ file: 4, rank: 3 });
    chess.isInCheck.mockReturnValue(true);

    // Order A: previous move first, then check.
    board.highlightPreviousMove();
    board.highlightCheck();
    expectEmissive(4, 3, 0xff0000, 0.8); // e4 = check
    expectEmissive(4, 1, 0xe8a830, 0.45); // e2 = previous move

    // Order B: check first, then previous move.
    board.clearHighlights();
    board.highlightCheck();
    board.highlightPreviousMove();
    expectEmissive(4, 3, 0xff0000, 0.8); // e4 = check (still wins)
    expectEmissive(4, 1, 0xe8a830, 0.45); // e2 = previous move
  });

  it('selection beats previous-move regardless of event order', async () => {
    await setup();
    // Previous move a2–b2; a2 is also the current selection.
    network.previousMove = { fromFile: 0, fromRank: 1, toFile: 1, toRank: 1 };
    selection.setSelectedSquare({ file: 0, rank: 1 }, []);

    // Order A: previous move first, then selection.
    board.highlightPreviousMove();
    board.highlightSelected(0, 1);
    expectEmissive(0, 1, 0x88aa00, 0.6); // a2 = selected
    expectEmissive(1, 1, 0xe8a830, 0.45); // b2 = previous move

    // Order B: selection first, then previous move.
    board.clearHighlights();
    board.highlightSelected(0, 1);
    board.highlightPreviousMove();
    expectEmissive(0, 1, 0x88aa00, 0.6); // a2 = selected (still wins)
    expectEmissive(1, 1, 0xe8a830, 0.45); // b2 = previous move
  });

  it('confirmed premove and check are order-independent (check always wins)', async () => {
    await setup();
    // The in-check king sits on the confirmed origin (4,1).
    chess.findKing.mockReturnValue({ file: 4, rank: 1 });
    chess.isInCheck.mockReturnValue(true);

    // Order A: confirm first, then check.
    premove.setPremove({ fromFile: 4, fromRank: 1, toFile: 4, toRank: 3 });
    board.highlightCheck();
    expectEmissive(4, 1, 0xff0000, 0.8); // check beats the confirmed fill

    // Order B: check first, then confirm (applyPremoveConfirmed must not
    // overwrite the existing check fill).
    premove.clearPremove();
    board.highlightCheck();
    premove.setPremove({ fromFile: 4, fromRank: 1, toFile: 4, toRank: 3 });
    expectEmissive(4, 1, 0xff0000, 0.8); // check still wins
  });

  it('clearing a confirmed square reveals check before selection (overlapping clear)', async () => {
    await setup();
    // The in-check king and the current selection both sit on the confirmed
    // origin (0,0); the previous move also touches it.
    network.previousMove = { fromFile: 0, fromRank: 0, toFile: 1, toRank: 0 };
    selection.setSelectedSquare({ file: 0, rank: 0 }, []);
    chess.findKing.mockReturnValue({ file: 0, rank: 0 });
    chess.isInCheck.mockReturnValue(true);

    premove.setPremove({ fromFile: 0, fromRank: 0, toFile: 0, toRank: 2 });
    // While confirmed, check already wins on (0,0) (check > confirmed).
    expectEmissive(0, 0, 0xff0000, 0.8);
    expectEmissive(0, 2, 0x1e5ac8, 0.8);

    premove.clearPremove();
    // Freed (0,0) reveals check (beats selection and previous move).
    expectEmissive(0, 0, 0xff0000, 0.8);
    // Freed (0,2) has no underlying state → base.
    expectBase(0, 2);
  });

  it('replacing a premove reveals selection before previous-move on a freed square', async () => {
    await setup();
    // Previous move (0,0)–(1,0) and the selection both sit on the confirmed
    // origin (0,0); the in-check king sits on the confirmed destination (0,2).
    network.previousMove = { fromFile: 0, fromRank: 0, toFile: 1, toRank: 0 };
    selection.setSelectedSquare({ file: 0, rank: 0 }, []);
    chess.findKing.mockReturnValue({ file: 0, rank: 2 });
    chess.isInCheck.mockReturnValue(true);

    premove.setPremove({ fromFile: 0, fromRank: 0, toFile: 0, toRank: 2 });
    board.highlightPreviousMove();
    // (0,0) confirmed (beats selection + previous move); (0,2) check (beats confirmed).
    expectEmissive(0, 0, 0x1e5ac8, 0.8);
    expectEmissive(0, 2, 0xff0000, 0.8);
    expectEmissive(1, 0, 0xe8a830, 0.45);

    // Replace with a non-overlapping premove.
    premove.setPremove({ fromFile: 5, fromRank: 5, toFile: 5, toRank: 7 });

    // Freed (0,0) reveals selection (beats previous move); freed (0,2) keeps check.
    expectEmissive(0, 0, 0x88aa00, 0.6);
    expectEmissive(0, 2, 0xff0000, 0.8);
    // The other previous-move square is unaffected.
    expectEmissive(1, 0, 0xe8a830, 0.45);
    // The new confirmed squares are filled.
    expectEmissive(5, 5, 0x1e5ac8, 0.8);
    expectEmissive(5, 7, 0x1e5ac8, 0.8);
    expect(board.getPremoveConfirmedSquares()).toEqual({
      fromFile: 5,
      fromRank: 5,
      toFile: 5,
      toRank: 7,
    });
  });

  // ── Check persists during selection (orchestrator flow) ──
  // Regression: the production select/deselect/update flow clears all squares
  // then redraws previous-move + selection. An active check on a square that
  // is neither the selection nor a previous-move/confirmed square must survive
  // (check outranks selection in the precedence), so the orchestrator re-
  // applies highlightCheck() on every selection path.

  it('selectPiece keeps the checked king highlighted when selecting a different piece', async () => {
    await setup();
    const orchestrator = makeOrchestrator();

    // In-check king on (4,0) (e1); the selected response piece is on a
    // different square (0,1) (a2).
    chess.findKing.mockReturnValue({ file: 4, rank: 0 });
    chess.isInCheck.mockReturnValue(true);
    selection.setSelectedSquare({ file: 0, rank: 1 }, []);

    orchestrator.selectPiece(0, 1, []);

    // The checked king keeps its check fill (different square from selection).
    expectEmissive(4, 0, 0xff0000, 0.8);
    // The selected piece shows the selection fill.
    expectEmissive(0, 1, 0x88aa00, 0.6);
  });

  it('selectPremove keeps the checked king highlighted when selecting a different piece', async () => {
    await setup();
    const orchestrator = makeOrchestrator();

    chess.findKing.mockReturnValue({ file: 4, rank: 0 });
    chess.isInCheck.mockReturnValue(true);
    selection.setSelectedSquare({ file: 0, rank: 1 }, [], 'premove');

    orchestrator.selectPremove(0, 1, []);

    // The checked king keeps its check fill.
    expectEmissive(4, 0, 0xff0000, 0.8);
    // The selected piece shows the premove-selected fill.
    expectEmissive(0, 1, 0x1e5ac8, 0.5);
  });

  it('updateHighlights keeps the checked king highlighted while a piece is selected', async () => {
    await setup();
    const orchestrator = makeOrchestrator();

    chess.findKing.mockReturnValue({ file: 4, rank: 0 });
    chess.isInCheck.mockReturnValue(true);
    selection.setSelectedSquare({ file: 0, rank: 1 }, []);

    orchestrator.updateHighlights();

    // The checked king keeps its check fill; the selection is also drawn.
    expectEmissive(4, 0, 0xff0000, 0.8);
    expectEmissive(0, 1, 0x88aa00, 0.6);
  });

  it('deselecting while in check still shows the checked king (regression)', async () => {
    await setup();
    const orchestrator = makeOrchestrator();

    chess.findKing.mockReturnValue({ file: 4, rank: 0 });
    chess.isInCheck.mockReturnValue(true);
    selection.setSelectedSquare({ file: 0, rank: 1 }, []);
    orchestrator.selectPiece(0, 1, []);
    expectEmissive(4, 0, 0xff0000, 0.8);

    orchestrator.deselect();

    // After deselect the checked king is still highlighted.
    expectEmissive(4, 0, 0xff0000, 0.8);
    // The former selection is back to base.
    expectBase(0, 1);
  });

  // ── Leak / duplicate-mesh guards ────────────────────────

  it('confirming a premove adds no meshes (square-material path, not overlay planes)', async () => {
    await setup();
    const before = scene.children.length;

    premove.setPremove(PRE);

    // No new scene children — the fill is a material copy on existing squares
    expect(scene.children.length).toBe(before);
  });

  it('premove candidate dots do not accumulate across re-renders', async () => {
    await setup();
    const base = scene.children.length;

    board.highlightPremoveMoves(scene, [
      { file: 4, rank: 2 },
      { file: 4, rank: 3 },
    ]);
    expect(scene.children.length).toBe(base + 2);

    // Re-render with a different candidate set — old dots are removed first
    board.highlightPremoveMoves(scene, [{ file: 0, rank: 2 }]);
    expect(scene.children.length).toBe(base + 1);

    // clearHighlights removes the dots
    board.clearHighlights();
    expect(scene.children.length).toBe(base);
  });

  it('clearing a highlighted square does not mutate shared materials or other squares (no Color leak)', async () => {
    await setup();

    // A confirmed premove on (0,0)/(0,2) — persistent state that must survive
    // a clear (this is "another square's state").
    premove.setPremove({ fromFile: 0, fromRank: 0, toFile: 0, toRank: 2 });
    expectEmissive(0, 0, 0x1e5ac8, 0.8);
    expectEmissive(0, 2, 0x1e5ac8, 0.8);

    // Select (3,3) and highlight it with the shared selected material.
    selection.setSelectedSquare({ file: 3, rank: 3 }, []);
    board.highlightSelected(3, 3);
    expectEmissive(3, 3, 0x88aa00, 0.6);

    // Deep-copy semantics (real Three.js): the highlighted square owns
    // independent Color instances, not the shared material's references.
    expect(board.squares[3][3].material.emissive).not.toBe(mats.selected.emissive);
    expect(board.squares[3][3].material.color).not.toBe(mats.selected.color);

    // Snapshot the shared selected material's emissive before the clear.
    const selEmissive = [
      mats.selected.emissive.r,
      mats.selected.emissive.g,
      mats.selected.emissive.b,
    ];

    // Clear the highlights — resets (3,3) to base and re-applies the
    // confirmed fill.
    board.clearHighlights();

    // (3,3) is back to base.
    expectBase(3, 3);
    // The shared selected material is NOT mutated by the clear.
    expect([mats.selected.emissive.r, mats.selected.emissive.g, mats.selected.emissive.b]).toEqual(
      selEmissive
    );
    expect(mats.selected.emissiveIntensity).toBeCloseTo(0.6, 5);
    // The confirmed premove squares (another square's state) are unaffected.
    expectEmissive(0, 0, 0x1e5ac8, 0.8);
    expectEmissive(0, 2, 0x1e5ac8, 0.8);
  });

  it('clearHighlights re-applies the confirmed premove (fill survives deselect)', async () => {
    await setup();
    premove.setPremove(PRE);
    expectEmissive(PRE.fromFile, PRE.fromRank, 0x1e5ac8, 0.8);

    // A deselect/clear cycle must not drop the confirmed fill
    board.clearHighlights();

    expectEmissive(PRE.fromFile, PRE.fromRank, 0x1e5ac8, 0.8);
    expectEmissive(PRE.toFile, PRE.toRank, 0x1e5ac8, 0.8);
  });
});
