// ═══════════════════════════════════════════════════════════
//  3D BOARD — confirmed premove destination ghost (Phase 3D)
//  Focused tests: create/update/replace/clear/restore, model-set
//  rebuild, board rebuild, opacity/depthWrite/transparency,
//  non-interactivity (raycast disabled, absent from pieceMeshes),
//  no source-material mutation, shared-geometry preservation
//  (never disposed by ghost cleanup), owned-material disposal
//  (exactly once per ghost), and no duplicate scene nodes.
// ═══════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Deferred STLLoader mock — drives the real model load/reload path so
// PIECE_CACHE is populated through production code.
const deferredCallbacks = [];
vi.mock('three/addons/loaders/STLLoader.js', () => ({
  STLLoader: class {
    load(url, onLoad, _onProgress, onError) {
      deferredCallbacks.push({ url, onLoad, onError });
    }
  },
}));

vi.mock('../../client/network.js', () => ({
  serverBoard: null,
  myRole: 'white',
  debugEnabled: false,
  onStateUpdate: vi.fn(),
  onRestart: vi.fn(),
  onPromotion: vi.fn(),
}));

vi.mock('../../client/board.js', () => ({
  clearHighlights: vi.fn(),
  highlightCheck: vi.fn(),
  highlightPreviousMove: vi.fn(),
}));

// Piece IDs: 1-6 white (pawn..king), 7-12 black
const W_PAWN = 1;
const B_PAWN = 7;

function emptyBoard() {
  return Array(8)
    .fill(null)
    .map(() => Array(8).fill(0));
}

// Mock geometry compatible with pieces.js processGeometry()
function makeGeometry(id) {
  return {
    id,
    disposed: false,
    boundingBox: {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 1, y: 1, z: 1 },
      getSize(v) {
        v.x = 1;
        v.y = 1;
        v.z = 1;
        return v;
      },
    },
    translate() {
      return this;
    },
    scale() {
      return this;
    },
    computeBoundingBox() {
      return this;
    },
    computeVertexNormals() {
      return this;
    },
    dispose() {
      this.disposed = true;
    },
  };
}

// PIECE_TYPES order in pieces.js
const PIECE_TYPES = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];

describe('3D board — confirmed premove ghost (Phase 3D)', () => {
  let THREE, pieces, premove, network;
  let scene, matWhite, matBlack;
  let geos; // geometries installed into PIECE_CACHE

  // e2–e4 pawn premove
  const PRE = { fromFile: 4, fromRank: 1, toFile: 4, toRank: 3 };
  // a2–b4 knight premove (replace target)
  const PRE2 = { fromFile: 0, fromRank: 1, toFile: 1, toRank: 3 };

  function ghostNode() {
    return scene.children.find((c) => c.name === 'premoveGhost');
  }

  function ghostCount() {
    return scene.children.filter((c) => c.name === 'premoveGhost').length;
  }

  function installModels(setName) {
    // Resolve all pending deferred load callbacks with fresh geometries
    geos = PIECE_TYPES.map((t) => makeGeometry(`${setName}-${t}`));
    deferredCallbacks.forEach((cb, i) => cb.onLoad(geos[i]));
    deferredCallbacks.length = 0;
  }

  beforeEach(async () => {
    vi.resetModules();
    deferredCallbacks.length = 0;

    THREE = await import('three');
    network = await import('../../client/network.js');
    pieces = await import('../../client/pieces.js');
    premove = await import('../../client/premove.js');

    network.serverBoard = emptyBoard();
    network.myRole = 'white'; // reset (the mock property persists across tests)
    scene = new THREE.Scene();
    pieces.setScene(scene);
    matWhite = new THREE.MeshStandardMaterial({ color: 0xf0e6d0 });
    matBlack = new THREE.MeshStandardMaterial({ color: 0x3d2b1f });
    pieces.setMaterials(matWhite, matBlack);

    // Load the initial model set through the real loader path
    pieces.loadPieceModels(scene, () => {});
    installModels('set-a');
    expect(pieces.modelsLoaded).toBe(true);
  });

  afterEach(() => {
    premove.clearPremove();
    pieces.pieceMeshes.length = 0;
  });

  // ── Create ─────────────────────────────────────────────

  it('renders no ghost without a confirmed premove', () => {
    expect(ghostNode()).toBeUndefined();
  });

  it('renders exactly one ghost at the destination with the origin piece geometry', () => {
    network.serverBoard[1][4] = W_PAWN; // white pawn on e2
    premove.setPremove(PRE);

    const ghost = ghostNode();
    expect(ghost).toBeDefined();
    expect(ghostCount()).toBe(1);
    // destination e4: world (0.5, y, 0.5)
    expect(ghost.position.x).toBeCloseTo(0.5, 6);
    expect(ghost.position.z).toBeCloseTo(0.5, 6);
    // small safe vertical offset above the piece base (0.01)
    expect(ghost.position.y).toBeGreaterThan(0.01);
    expect(ghost.position.y).toBeLessThan(0.1);
    // white pieces face -z (rotation.y = PI), like real pieces
    expect(ghost.rotation.y).toBeCloseTo(Math.PI, 6);

    const mesh = ghost.children[0];
    expect(mesh).toBeDefined();
    // shared PIECE_CACHE pawn geometry — not a clone
    expect(mesh.geometry).toBe(geos[0]);
  });

  it('uses the black orientation for a black premoved piece', () => {
    network.myRole = 'black'; // this client is the black player
    network.serverBoard[6][0] = B_PAWN; // black pawn on a7
    premove.setPremove({ fromFile: 0, fromRank: 6, toFile: 0, toRank: 4 });

    const ghost = ghostNode();
    expect(ghost).toBeDefined();
    expect(ghost.rotation.y).toBeCloseTo(0, 6);
    expect(ghost.children[0].geometry).toBe(geos[0]); // pawn geometry
  });

  // ── Material independence ──────────────────────────────

  it('ghost material is an independent transparent clone (opacity ~0.45, depthWrite false)', () => {
    network.serverBoard[1][4] = W_PAWN;
    premove.setPremove(PRE);

    const mat = ghostNode().children[0].material;
    expect(mat).not.toBe(matWhite);
    expect(mat.transparent).toBe(true);
    expect(mat.opacity).toBeCloseTo(0.45, 6);
    expect(mat.depthWrite).toBe(false);
    // color copied from the source material
    expect(mat.color.r).toBeCloseTo(matWhite.color.r, 6);
    expect(mat.color.g).toBeCloseTo(matWhite.color.g, 6);
    expect(mat.color.b).toBeCloseTo(matWhite.color.b, 6);
  });

  it('does not mutate the shared source material', () => {
    network.serverBoard[1][4] = W_PAWN;
    premove.setPremove(PRE);

    // The shared white material must keep its opaque, depth-writing state
    expect(matWhite.transparent).toBe(false);
    expect(matWhite.opacity).toBe(1);
    expect(matWhite.depthWrite).toBe(true);
    expect(matBlack.transparent).toBe(false);
    expect(matBlack.opacity).toBe(1);
    expect(matBlack.depthWrite).toBe(true);

    // Mutating the ghost material must not leak into the source
    const mat = ghostNode().children[0].material;
    mat.opacity = 0.1;
    mat.depthWrite = true;
    expect(matWhite.opacity).toBe(1);
    expect(matWhite.depthWrite).toBe(true);
  });

  // ── Non-interactivity ──────────────────────────────────

  it('ghost mesh is not a raycast target and is absent from pieceMeshes', () => {
    network.serverBoard[1][4] = W_PAWN;
    premove.setPremove(PRE);

    const mesh = ghostNode().children[0];
    expect(typeof mesh.raycast).toBe('function');
    expect(mesh.raycast()).toBeUndefined(); // no-op, never throws
    // the ghost is a visual overlay, not a board piece
    expect(pieces.pieceMeshes).toHaveLength(0);
  });

  // ── Replace / clear / restore ──────────────────────────

  it('replacing the premove moves the ghost and disposes the old owned material once', () => {
    network.serverBoard[1][4] = W_PAWN;
    network.serverBoard[1][0] = 2; // white knight on a2
    premove.setPremove(PRE);
    const ghost1 = ghostNode();
    const mat1 = ghost1.children[0].material;
    const matSpy = vi.spyOn(mat1, 'dispose');

    premove.setPremove(PRE2);

    expect(ghostCount()).toBe(1);
    const ghost2 = ghostNode();
    expect(ghost2).not.toBe(ghost1);
    // new destination b4: world (-2.5, y, 0.5)
    expect(ghost2.position.x).toBeCloseTo(-2.5, 6);
    expect(ghost2.position.z).toBeCloseTo(0.5, 6);
    expect(ghost2.children[0].geometry).toBe(geos[1]); // knight geometry
    expect(matSpy).toHaveBeenCalledTimes(1);
    // the old ghost is detached from the scene
    expect(ghost1.parent).toBeNull();
  });

  it('clearing the premove removes the ghost and disposes the owned material', () => {
    network.serverBoard[1][4] = W_PAWN;
    premove.setPremove(PRE);
    const mat = ghostNode().children[0].material;
    const matSpy = vi.spyOn(mat, 'dispose');

    premove.clearPremove();

    expect(ghostNode()).toBeUndefined();
    expect(matSpy).toHaveBeenCalledTimes(1);
  });

  it('clear then re-set (reconnect restore) re-creates the ghost with a fresh material', () => {
    network.serverBoard[1][4] = W_PAWN;
    premove.setPremove(PRE);
    const mat1 = ghostNode().children[0].material;

    premove.clearPremove();
    expect(ghostNode()).toBeUndefined();

    premove.setPremove(PRE);
    const ghost = ghostNode();
    expect(ghost).toBeDefined();
    expect(ghost.children[0].material).not.toBe(mat1);
    expect(ghost.children[0].material.transparent).toBe(true);
    expect(ghost.children[0].material.opacity).toBeCloseTo(0.45, 6);
  });

  it('set/clear cycles never leave more than one ghost node', () => {
    network.serverBoard[1][4] = W_PAWN; // white pawn e2
    network.serverBoard[1][0] = 2; // white knight a2
    for (let cycle = 0; cycle < 3; cycle++) {
      premove.setPremove(PRE);
      expect(ghostCount()).toBe(1);
      premove.setPremove(PRE2);
      expect(ghostCount()).toBe(1);
      premove.clearPremove();
      expect(ghostCount()).toBe(0);
    }
  });

  it('repeated identical premove sets do not duplicate the ghost', () => {
    network.serverBoard[1][4] = W_PAWN;
    premove.setPremove(PRE);
    premove.setPremove({ ...PRE }); // no-op (same value)
    premove.setPremove({ ...PRE, promotion: null }); // no-op (same value)
    expect(ghostCount()).toBe(1);
  });

  // ── Shared geometry preservation ───────────────────────

  it('ghost cleanup never disposes the shared source geometry', () => {
    network.serverBoard[1][4] = W_PAWN;
    premove.setPremove(PRE);
    const geo = geos[0];
    const geoSpy = vi.spyOn(geo, 'dispose');

    premove.setPremove(PRE2); // replace
    premove.clearPremove(); // clear
    premove.setPremove(PRE); // restore

    expect(geoSpy).not.toHaveBeenCalled();
    expect(ghostCount()).toBe(1);
    expect(ghostNode().children[0].geometry).toBe(geo);
  });

  // ── Board / piece rebuild ──────────────────────────────

  it('a board rebuild (state update) keeps exactly one ghost at the destination', () => {
    network.serverBoard[1][4] = W_PAWN;
    premove.setPremove(PRE);
    const ghost1 = ghostNode();

    // Simulate the state-update rebuild path
    pieces.rebuildPieces(scene);

    expect(ghostCount()).toBe(1);
    const ghost = ghostNode();
    expect(ghost.position.x).toBeCloseTo(0.5, 6);
    expect(ghost.position.z).toBeCloseTo(0.5, 6);
    expect(ghost.children[0].geometry).toBe(geos[0]);
    // idempotent: the unchanged ghost is not needlessly recreated
    expect(ghost).toBe(ghost1);
  });

  it('a rebuild after the origin piece is captured drops the ghost (no crash)', () => {
    network.serverBoard[1][4] = W_PAWN;
    premove.setPremove(PRE);
    expect(ghostNode()).toBeDefined();

    // Opponent captures the premoved pawn: the source square now holds the
    // opponent's capturing piece (not 0) during the state update that
    // precedes premoveDiscarded. Must not ghost the opponent's piece.
    network.serverBoard[1][4] = B_PAWN; // opponent captured onto e2
    pieces.rebuildPieces(scene);

    expect(ghostNode()).toBeUndefined();
  });

  it('a rebuild with the destination occupied keeps the real piece untouched and the ghost above it', () => {
    network.serverBoard[1][4] = W_PAWN; // white pawn e2
    network.serverBoard[3][4] = B_PAWN; // black pawn e4 (capture target)
    pieces.rebuildPieces(scene); // real pieces on the board
    premove.setPremove(PRE);

    const ghost = ghostNode();
    expect(ghost).toBeDefined();
    const realPiece = pieces.pieceMeshes.find((p) => p.file === 4 && p.rank === 3);
    expect(realPiece).toBeDefined();
    // the real piece keeps its shared material and square position
    expect(realPiece.mesh.children[0].material).toBe(matBlack);
    expect(realPiece.mesh.position.x).toBeCloseTo(0.5, 6);
    expect(realPiece.mesh.position.z).toBeCloseTo(0.5, 6);
    expect(realPiece.mesh.position.y).toBeCloseTo(0.01, 6);
    // the ghost sits slightly above the real piece (no z-fighting)
    expect(ghost.position.y).toBeGreaterThan(realPiece.mesh.position.y);
    expect(ghostCount()).toBe(1);
  });

  // ── Model-set change ───────────────────────────────────

  it('a model-set reload rebuilds the ghost with the new geometry and disposes the old owned material', () => {
    network.serverBoard[1][4] = W_PAWN;
    premove.setPremove(PRE);
    const ghost1 = ghostNode();
    const mat1 = ghost1.children[0].material;
    const matSpy = vi.spyOn(mat1, 'dispose');
    const oldPawnGeo = geos[0];

    // Reload a different model set through the real loader path
    pieces.reloadPieceModels(scene, () => {});
    installModels('set-b');

    expect(ghostCount()).toBe(1);
    const ghost = ghostNode();
    expect(ghost).not.toBe(ghost1);
    expect(ghost.children[0].geometry).toBe(geos[0]); // new pawn geometry
    expect(ghost.children[0].geometry).not.toBe(oldPawnGeo);
    expect(ghost.children[0].material).not.toBe(mat1);
    expect(ghost.children[0].material.transparent).toBe(true);
    expect(ghost.children[0].material.opacity).toBeCloseTo(0.45, 6);
    expect(ghost.children[0].material.depthWrite).toBe(false);
    expect(matSpy).toHaveBeenCalledTimes(1);
    // the old ghost's shared geometry was disposed by the cache swap
    // (existing installCache behavior) — ghost cleanup must not double-dispose
    expect(oldPawnGeo.disposed).toBe(true);
    // the new geometry is alive
    expect(geos[0].disposed).toBe(false);
  });

  it('a model-set reload with no pending premove creates no ghost', () => {
    pieces.reloadPieceModels(scene, () => {});
    installModels('set-b');
    expect(ghostNode()).toBeUndefined();
  });

  // ── Scene switch ───────────────────────────────────────

  it('setScene moves the ghost to the new scene and disposes the old owned material', () => {
    network.serverBoard[1][4] = W_PAWN;
    premove.setPremove(PRE);
    const ghost1 = ghostNode();
    const mat1 = ghost1.children[0].material;
    const matSpy = vi.spyOn(mat1, 'dispose');

    const scene2 = new THREE.Scene();
    pieces.setScene(scene2);

    expect(ghost1.parent).toBeNull();
    expect(scene.children.find((c) => c.name === 'premoveGhost')).toBeUndefined();
    const ghost2 = scene2.children.find((c) => c.name === 'premoveGhost');
    expect(ghost2).toBeDefined();
    expect(ghost2.children[0].material).not.toBe(mat1);
    expect(matSpy).toHaveBeenCalledTimes(1);
    expect(ghost2.children[0].geometry).toBe(geos[0]); // shared geometry kept
  });

  it('setScene with the same scene is a no-op (no ghost churn)', () => {
    network.serverBoard[1][4] = W_PAWN;
    premove.setPremove(PRE);
    const ghost1 = ghostNode();
    const mat1 = ghost1.children[0].material;
    const matSpy = vi.spyOn(mat1, 'dispose');

    pieces.setScene(scene);

    expect(ghostNode()).toBe(ghost1);
    expect(matSpy).not.toHaveBeenCalled();
  });

  // ── Spectator / privacy ────────────────────────────────

  it('a client with null premove state (spectator/opponent) renders no ghost', () => {
    // serverBoard carries the full position, but this client has no
    // private premove state — nothing may be rendered.
    network.serverBoard[1][4] = W_PAWN;
    expect(premove.getPremove()).toBeNull();
    expect(ghostNode()).toBeUndefined();
  });

  it('out-of-range premove coordinates do not crash or render a ghost', () => {
    network.serverBoard[1][4] = W_PAWN; // valid origin piece on e2
    // Out-of-range origin: no ghost
    premove.setPremove({ fromFile: 9, fromRank: 1, toFile: 4, toRank: 3 });
    expect(ghostNode()).toBeUndefined();
    // Out-of-range destination with a VALID origin: must not place a ghost
    // off-board (the blocking case — origin lookup alone would pass)
    premove.setPremove({ fromFile: 4, fromRank: 1, toFile: 9, toRank: 3 });
    expect(ghostNode()).toBeUndefined();
    premove.setPremove({ fromFile: 4, fromRank: 1, toFile: 4, toRank: -1 });
    expect(ghostNode()).toBeUndefined();
    // A valid premove after malformed ones still renders correctly
    premove.setPremove(PRE);
    expect(ghostCount()).toBe(1);
    expect(ghostNode().children[0].geometry).toBe(geos[0]);
  });

  it('a promotion premove renders the pawn ghost at the destination (promotion field ignored)', () => {
    network.serverBoard[6][4] = W_PAWN; // white pawn on e7
    premove.setPremove({ fromFile: 4, fromRank: 6, toFile: 4, toRank: 7, promotion: 'queen' });

    const ghost = ghostNode();
    expect(ghost).toBeDefined();
    expect(ghostCount()).toBe(1);
    // destination e8: world (0.5, y, -3.5)
    expect(ghost.position.x).toBeCloseTo(0.5, 6);
    expect(ghost.position.z).toBeCloseTo(-3.5, 6);
    // the ghost continues to depict the originating pawn — the promotion
    // value is already stored on the premove (chosen in the picker) and is
    // consumed at execution, not while waiting
    expect(ghost.children[0].geometry).toBe(geos[0]);

    // Changing only the promotion field is a no-op for the ghost (same
    // destination/type/color key) — no duplicate node, no re-clone
    premove.setPremove({ fromFile: 4, fromRank: 6, toFile: 4, toRank: 7, promotion: null });
    expect(ghostCount()).toBe(1);
    expect(ghostNode()).toBe(ghost);
  });

  it('a premove set before the models finish loading renders the ghost once they load', async () => {
    // Reconnect-restore race: the state message (carrying the premove) can
    // arrive before the 3D models finish loading. The ghost must appear once
    // the models load, without a manual re-set.
    vi.resetModules();
    deferredCallbacks.length = 0;

    THREE = await import('three');
    network = await import('../../client/network.js');
    pieces = await import('../../client/pieces.js');
    premove = await import('../../client/premove.js');

    network.serverBoard = emptyBoard();
    network.myRole = 'white';
    scene = new THREE.Scene();
    pieces.setScene(scene);
    matWhite = new THREE.MeshStandardMaterial({ color: 0xf0e6d0 });
    matBlack = new THREE.MeshStandardMaterial({ color: 0x3d2b1f });
    pieces.setMaterials(matWhite, matBlack);

    // Premove confirmed while the models are still loading
    network.serverBoard[1][4] = W_PAWN; // white pawn on e2
    premove.setPremove(PRE);
    expect(pieces.modelsLoaded).toBe(false);
    expect(ghostNode()).toBeUndefined();

    // Models finish loading through the real loader path
    pieces.loadPieceModels(scene, () => {});
    installModels('set-a');

    expect(pieces.modelsLoaded).toBe(true);
    expect(ghostCount()).toBe(1);
    const ghost = ghostNode();
    expect(ghost.position.x).toBeCloseTo(0.5, 6);
    expect(ghost.position.z).toBeCloseTo(0.5, 6);
    expect(ghost.children[0].geometry).toBe(geos[0]);
  });
});
