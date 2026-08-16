// ═══════════════════════════════════════════════════════════
//  CHAINED-CAPTURE 3D STALE-MESH RACE — regression tests
//
// Rapid premove chains (e.g. 7...Qxe2+ 8.Kxe2) drain on the server in one
// tick and are broadcast as move, state, move, state — all before a single
// client animation frame. The old code:
//   1. picked the capture victim by destination position only, so the
//      second capture re-faded the already-fading white queen (first in
//      pieceMeshes) instead of the incoming black queen, which was never
//      faded and stranded under the white king;
//   2. tracked animation ownership as one Set membership per piece, so a
//      finishing slide could unprotect a piece whose fade was still
//      running (and vice versa), letting rebuildPieces mutate/remove the
//      fading mesh and letting fade completion delete a replacement.
//
// These tests drive the REAL network.js message flow (move → state →
// promotion → restart) and the REAL pieces.js animation/rebuild code,
// ticking the animation loop deterministically (same loop as app.js).
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

// Piece IDs: 1-6 white (pawn..king), 7-12 black (pawn..king)
const W_PAWN = 1;
const W_QUEEN = 5;
const W_KING = 6;
const B_PAWN = 7;
const B_ROOK = 10;
const B_QUEEN = 11;
const B_KING = 12;

// PIECE_TYPES order in pieces.js
const PIECE_TYPES = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];

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

describe('chained-capture 3D stale-mesh race', () => {
  let THREE, pieces, network;
  let scene, matWhite, matBlack;
  let geos; // geometries installed into PIECE_CACHE

  function installModels(setName) {
    // Resolve all pending deferred load callbacks with fresh geometries
    geos = PIECE_TYPES.map((t) => makeGeometry(`${setName}-${t}`));
    deferredCallbacks.forEach((cb, i) => cb.onLoad(geos[i]));
    deferredCallbacks.length = 0;
  }

  // ── Real network message flow ──────────────────────────

  function sendState(board, extra = {}) {
    network.handleServerMessage({
      data: JSON.stringify({
        type: 'state',
        role: extra.role || 'white',
        board,
        turn: 'white',
        castlingRights: { wK: false, wQ: false, bK: false, bQ: false },
        enPassantTarget: null,
        lastMove: null,
        ...extra,
      }),
    });
  }

  function sendMove(m) {
    network.handleServerMessage({
      data: JSON.stringify({
        type: 'move',
        color: 'white',
        premove: false,
        castled: null,
        enPassant: false,
        captured: false,
        ...m,
      }),
    });
  }

  function sendPromotion(pieceType, file, rank, color) {
    network.handleServerMessage({
      data: JSON.stringify({ type: 'promotion', pieceType, file, rank, color }),
    });
  }

  function sendRestart() {
    network.handleServerMessage({ data: JSON.stringify({ type: 'restart' }) });
  }

  // Same loop as app.js: tick every animation, drop the completed ones.
  function tick(time) {
    for (let i = pieces.animations.length - 1; i >= 0; i--) {
      if (pieces.animations[i].update(time)) {
        pieces.animations.splice(i, 1);
      }
    }
  }

  function entryAt(file, rank) {
    return pieces.pieceMeshes.find((p) => p.file === file && p.rank === rank);
  }

  function scenePieceMeshes() {
    return scene.children;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    deferredCallbacks.length = 0;

    // Stub WebSocket so network.js doesn't throw on import
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

    THREE = await import('three');
    network = await import('../../client/network.js');
    pieces = await import('../../client/pieces.js');

    scene = new THREE.Scene();
    pieces.setScene(scene);
    matWhite = new THREE.MeshStandardMaterial({ color: 0xf0e6d0 });
    matBlack = new THREE.MeshStandardMaterial({ color: 0x3d2b1f });
    pieces.setMaterials(matWhite, matBlack);

    // Mirror app.js: the move event drives animateMove
    network.onMove((msg) => {
      pieces.animateMove(
        scene,
        msg.fromFile,
        msg.fromRank,
        msg.toFile,
        msg.toRank,
        msg.castled,
        msg.enPassant,
        msg.captured
      );
    });

    // Load the initial model set through the real loader path
    pieces.loadPieceModels(scene, () => {});
    installModels('set-a');
    expect(pieces.modelsLoaded).toBe(true);
    // Establish serverBoard through the real state-message flow
    sendState(emptyBoard());
  });

  afterEach(() => {
    pieces.pieceMeshes.length = 0;
    pieces.animations.length = 0;
    pieces._animatingPieces.clear();
    vi.restoreAllMocks();
  });

  // ── The exact repro: 7...Qxe2+ 8.Kxe2 ──────────────────

  it('Qxe2+ then Kxe2 back-to-back leaves exactly one white king and no stale queen mesh', () => {
    // Position after 6.Qe2: white queen e2, black queen e7, white king e1
    const board7pre = emptyBoard();
    board7pre[1][4] = W_QUEEN;
    board7pre[6][4] = B_QUEEN;
    board7pre[0][4] = W_KING;
    sendState(board7pre);
    expect(pieces.pieceMeshes).toHaveLength(3);

    // 7...Qxe2+ — move arrives, state follows, no frame in between
    const t0 = performance.now();
    sendMove({ fromFile: 4, fromRank: 6, toFile: 4, toRank: 1, captured: true, color: 'black' });

    // Both queens are logically on e2 now — identify by color
    const bq = pieces.pieceMeshes.find((p) => p.type === 'queen' && p.color === 'black');
    const wq = pieces.pieceMeshes.find((p) => p.type === 'queen' && p.color === 'white');
    const wk = pieces.pieceMeshes.find((p) => p.type === 'king');
    expect(bq).toBeDefined();
    expect(wq).toBeDefined();
    expect(wk).toBeDefined();
    // First capture faded the white queen; black queen is sliding
    expect(wq.mesh.children[0].material).not.toBe(matWhite);
    expect(wq.mesh.children[0].material.transparent).toBe(true);
    expect(pieces._animOpCount(bq)).toBe(1); // slide
    expect(pieces._animOpCount(wq)).toBe(1); // fade

    // State after Qxe2+: e2 = black queen
    const board7post = emptyBoard();
    board7post[1][4] = B_QUEEN;
    board7post[0][4] = W_KING;
    sendState(board7post);
    // No duplicates created while both queens animate on e2
    expect(pieces.pieceMeshes).toHaveLength(3);
    expect(scenePieceMeshes()).toHaveLength(3);

    // 8.Kxe2 — before any frame completed the first capture
    const wqClone = wq.mesh.children[0].material;
    sendMove({ fromFile: 4, fromRank: 0, toFile: 4, toRank: 1, captured: true, color: 'white' });

    // The second capture must target the BLACK queen (pre-move serverBoard
    // says e2 holds the black queen), not the already-fading white queen
    expect(bq.mesh.children[0].material).not.toBe(matBlack);
    expect(bq.mesh.children[0].material.transparent).toBe(true);
    // The white queen's fade material is untouched (not re-cloned)
    expect(wq.mesh.children[0].material).toBe(wqClone);
    // Black queen now owns two overlapping operations: slide + fade
    expect(pieces._animOpCount(bq)).toBe(2);
    expect(pieces._animOpCount(wk)).toBe(1);

    // State after Kxe2: e2 = white king
    const board8post = emptyBoard();
    board8post[1][4] = W_KING;
    sendState(board8post);
    // Reconciliation must not create a fourth mesh on e2
    expect(pieces.pieceMeshes).toHaveLength(3);
    expect(scenePieceMeshes()).toHaveLength(3);

    // Frames complete (zero-delay chain: all of the above happened first)
    tick(performance.now() + 500);

    // Exactly the authoritative pieces remain: one white king on e2
    expect(pieces.pieceMeshes).toHaveLength(1);
    const king = pieces.pieceMeshes[0];
    expect(king.type).toBe('king');
    expect(king.color).toBe('white');
    expect(king.file).toBe(4);
    expect(king.rank).toBe(1);
    expect(pieces.pieceMeshes.some((p) => p.type === 'queen')).toBe(false);
    // No stale meshes in the scene
    expect(scenePieceMeshes()).toHaveLength(1);
    expect(scenePieceMeshes()[0]).toBe(king.mesh);
    // All animation ownership released
    expect(pieces._animatingPieces.size).toBe(0);
    expect(pieces.animations).toHaveLength(0);
  });

  it('the second capture targets the black queen, not the already-fading white queen', () => {
    const board7pre = emptyBoard();
    board7pre[1][4] = W_QUEEN;
    board7pre[6][4] = B_QUEEN;
    board7pre[0][4] = W_KING;
    sendState(board7pre);

    sendMove({ fromFile: 4, fromRank: 6, toFile: 4, toRank: 1, captured: true, color: 'black' });
    const board7post = emptyBoard();
    board7post[1][4] = B_QUEEN;
    board7post[0][4] = W_KING;
    sendState(board7post);

    const bq = pieces.pieceMeshes.find((p) => p.type === 'queen' && p.color === 'black');
    const wq = pieces.pieceMeshes.find((p) => p.type === 'queen' && p.color === 'white');
    const wqClone = wq.mesh.children[0].material; // faded by move 7

    sendMove({ fromFile: 4, fromRank: 0, toFile: 4, toRank: 1, captured: true, color: 'white' });

    // Black queen got a NEW fade (cloned material, transparent)
    expect(bq.mesh.children[0].material).not.toBe(matBlack);
    expect(bq.mesh.children[0].material.transparent).toBe(true);
    // White queen was NOT re-faded: same material instance as after move 7
    expect(wq.mesh.children[0].material).toBe(wqClone);
    // Ownership: black queen protected by both slide and fade
    expect(pieces._animOpCount(bq)).toBe(2);
    expect(pieces._animOpCount(wq)).toBe(1);

    // Completing only the slide must NOT unprotect the black queen while
    // its fade is still running (reference-counted ownership)
    const bqSlide = pieces.animations[0]; // pushed first, by move 7
    expect(bqSlide.update(performance.now() + 500)).toBe(true);
    pieces.animations.splice(0, 1);
    expect(pieces._animatingPieces.has(bq)).toBe(true);
    expect(pieces._animOpCount(bq)).toBe(1);

    // Remaining animations complete
    tick(performance.now() + 500);
    expect(pieces._animatingPieces.size).toBe(0);
    expect(pieces.pieceMeshes).toHaveLength(1);
    expect(pieces.pieceMeshes[0].type).toBe('king');
  });

  it('the second capture arriving mid-animation still fades the true victim and converges to one king', () => {
    // Controlled monotonic clock: 7...Qxe2+ starts at t=0, one frame
    // renders at t=150, 8.Kxe2 starts at t=150 (after that frame), and
    // everything completes at t=451 (301ms after the second move).
    const clock = { now: 0 };
    vi.spyOn(performance, 'now').mockImplementation(() => clock.now);

    const board7pre = emptyBoard();
    board7pre[1][4] = W_QUEEN;
    board7pre[6][4] = B_QUEEN;
    board7pre[0][4] = W_KING;
    sendState(board7pre);

    // 7...Qxe2+ at t=0 — move then state, no frame in between
    sendMove({ fromFile: 4, fromRank: 6, toFile: 4, toRank: 1, captured: true, color: 'black' });
    const board7post = emptyBoard();
    board7post[1][4] = B_QUEEN;
    board7post[0][4] = W_KING;
    sendState(board7post);

    const bq = pieces.pieceMeshes.find((p) => p.type === 'queen' && p.color === 'black');
    const wq = pieces.pieceMeshes.find((p) => p.type === 'queen' && p.color === 'white');
    const wk = pieces.pieceMeshes.find((p) => p.type === 'king');
    const wqFadeMat = wq.mesh.children[0].material; // cloned by move 7

    // One frame at t=150: black queen mid-slide (arc), white queen mid-fade
    clock.now = 150;
    tick(150);
    expect(pieces.animations).toHaveLength(2);
    expect(bq.mesh.position.y).toBeGreaterThan(0.01);
    expect(wq.mesh.children[0].material.opacity).toBeLessThan(1);

    // 8.Kxe2 arrives at t=150, after that frame, while the first capture
    // is still animating
    sendMove({ fromFile: 4, fromRank: 0, toFile: 4, toRank: 1, captured: true, color: 'white' });

    // The victim is the mid-flight BLACK queen, not the fading white queen
    expect(bq.mesh.children[0].material).not.toBe(matBlack);
    expect(bq.mesh.children[0].material.transparent).toBe(true);
    expect(wq.mesh.children[0].material).toBe(wqFadeMat); // not re-cloned
    expect(pieces._animOpCount(bq)).toBe(2); // slide + fade
    expect(pieces._animOpCount(wq)).toBe(1);
    expect(pieces._animOpCount(wk)).toBe(1);

    // State after Kxe2: e2 = white king
    const board8post = emptyBoard();
    board8post[1][4] = W_KING;
    sendState(board8post);
    expect(pieces.pieceMeshes).toHaveLength(3);

    // All overlapping animations complete at t=451
    clock.now = 451;
    tick(451);
    expect(pieces.pieceMeshes).toHaveLength(1);
    const king = pieces.pieceMeshes[0];
    expect(king.type).toBe('king');
    expect(king.color).toBe('white');
    expect(king.file).toBe(4);
    expect(king.rank).toBe(1);
    expect(king.mesh.position.y).toBeCloseTo(0.01, 6); // at rest, not mid-arc
    expect(pieces.pieceMeshes.some((p) => p.type === 'queen')).toBe(false);
    expect(scenePieceMeshes()).toHaveLength(1);
    expect(scenePieceMeshes()[0]).toBe(king.mesh);
    expect(pieces._animatingPieces.size).toBe(0);
    expect(pieces.animations).toHaveLength(0);
  });

  it('the black-role local client converges to the same single king after the same burst', () => {
    // The user repro shows BOTH local tabs (white seat and black seat)
    // stranding stale queens. The mesh pipeline is role-independent, but
    // the black seat must converge identically after the same
    // move-before-state burst.
    // Controlled monotonic clock: both moves start at t=0 (zero-delay
    // burst), everything completes at t=301.
    const clock = { now: 0 };
    vi.spyOn(performance, 'now').mockImplementation(() => clock.now);

    const board7pre = emptyBoard();
    board7pre[1][4] = W_QUEEN;
    board7pre[6][4] = B_QUEEN;
    board7pre[0][4] = W_KING;
    sendState(board7pre, { role: 'black' });

    sendMove({ fromFile: 4, fromRank: 6, toFile: 4, toRank: 1, captured: true, color: 'black' });
    const board7post = emptyBoard();
    board7post[1][4] = B_QUEEN;
    board7post[0][4] = W_KING;
    sendState(board7post, { role: 'black' });

    sendMove({ fromFile: 4, fromRank: 0, toFile: 4, toRank: 1, captured: true, color: 'white' });
    const board8post = emptyBoard();
    board8post[1][4] = W_KING;
    sendState(board8post, { role: 'black' });

    clock.now = 301;
    tick(301);

    // Identical convergence: one authoritative white king on e2, no queens
    expect(pieces.pieceMeshes).toHaveLength(1);
    const king = pieces.pieceMeshes[0];
    expect(king.type).toBe('king');
    expect(king.color).toBe('white');
    expect(king.file).toBe(4);
    expect(king.rank).toBe(1);
    expect(king.mesh.position.y).toBeCloseTo(0.01, 6);
    expect(pieces.pieceMeshes.some((p) => p.type === 'queen')).toBe(false);
    expect(scenePieceMeshes()).toHaveLength(1);
    expect(scenePieceMeshes()[0]).toBe(king.mesh);
    expect(pieces._animatingPieces.size).toBe(0);
    expect(pieces.animations).toHaveLength(0);
  });

  // ── Rebuild between overlapping slide/fade completions ─

  it('a state update between overlapping slide/fade completions keeps the fading victim protected and creates no duplicate', () => {
    // White queen d5 captures black pawn e6
    const boardPre = emptyBoard();
    boardPre[4][3] = W_QUEEN; // d5
    boardPre[5][4] = B_PAWN; // e6
    sendState(boardPre);

    const t0 = performance.now();
    sendMove({ fromFile: 3, fromRank: 4, toFile: 4, toRank: 5, captured: true, color: 'white' });
    const wq = pieces.pieceMeshes.find((p) => p.type === 'queen');
    const bp = pieces.pieceMeshes.find((p) => p.type === 'pawn');
    expect(pieces._animOpCount(wq)).toBe(1); // slide
    expect(pieces._animOpCount(bp)).toBe(1); // fade

    // Halfway through both animations
    tick(t0 + 150);
    expect(pieces.animations).toHaveLength(2);

    // State update arrives mid-animation: e6 = white queen, d5 = empty
    const boardPost = emptyBoard();
    boardPost[5][4] = W_QUEEN;
    sendState(boardPost);

    // The fading victim is still protected — not removed, not duplicated
    expect(pieces._animatingPieces.has(bp)).toBe(true);
    expect(pieces.pieceMeshes).toContain(bp);
    expect(scene.children).toContain(bp.mesh);
    expect(pieces.pieceMeshes).toHaveLength(2);
    expect(scenePieceMeshes()).toHaveLength(2);
    // No duplicate queen created at e6 while the real one slides in
    expect(pieces.pieceMeshes.filter((p) => p.type === 'queen')).toHaveLength(1);

    // Animations complete
    tick(t0 + 301);
    expect(pieces.pieceMeshes).toHaveLength(1);
    expect(pieces.pieceMeshes[0].type).toBe('queen');
    expect(pieces.pieceMeshes[0].file).toBe(4);
    expect(pieces.pieceMeshes[0].rank).toBe(5);
    expect(scenePieceMeshes()).toHaveLength(1);
    expect(scenePieceMeshes()[0]).toBe(pieces.pieceMeshes[0].mesh);
    expect(pieces._animatingPieces.size).toBe(0);
  });

  it('a force rebuild replacing a fading victim mesh is not undone by the fade completion', () => {
    // Qxe2+ position: white queen e2 (victim), black queen e7, white king e1
    const boardPre = emptyBoard();
    boardPre[1][4] = W_QUEEN;
    boardPre[6][4] = B_QUEEN;
    boardPre[0][4] = W_KING;
    sendState(boardPre);

    const t0 = performance.now();
    sendMove({ fromFile: 4, fromRank: 6, toFile: 4, toRank: 1, captured: true, color: 'black' });
    const wq = pieces.pieceMeshes.find((p) => p.type === 'queen' && p.color === 'white');
    const bq = pieces.pieceMeshes.find((p) => p.type === 'queen' && p.color === 'black');
    const wqMesh = wq.mesh;
    const bqMesh = bq.mesh;

    // Mid-fade: the white queen is lifted and semi-transparent
    tick(t0 + 150);
    expect(wqMesh.children[0].material.opacity).toBeLessThan(1);

    // Force rebuild (promotion-style) with a board where e2 = king.
    // The white queen entry is replaced in place; the black queen entry is
    // removed. The in-flight fades must not touch the replacement.
    const boardPost = emptyBoard();
    boardPost[1][4] = W_KING;
    sendState(boardPost); // normal rebuild — animating pieces are skipped
    // The non-animating king (e1) is gone from the board; both animating
    // queens are still protected on e2.
    expect(pieces.pieceMeshes).toHaveLength(2);
    pieces.rebuildPieces(scene, true);

    // The white queen entry now carries a king mesh at the canonical base
    // height; the black queen mesh is gone from the scene.
    expect(wq.type).toBe('king');
    expect(wq.mesh).not.toBe(wqMesh);
    expect(wq.mesh.position.y).toBeCloseTo(0.01, 6);
    expect(scene.children).toContain(wq.mesh);
    expect(scene.children).not.toContain(bqMesh);
    expect(scene.children).not.toContain(wqMesh);
    expect(pieces.pieceMeshes).toHaveLength(1);

    // Fades complete: they must remove nothing (their meshes are gone or
    // replaced) and must not delete the replacement king mesh.
    tick(t0 + 301);
    expect(scene.children).toContain(wq.mesh);
    expect(pieces.pieceMeshes).toContain(wq);
    expect(pieces.pieceMeshes).toHaveLength(1);
    expect(pieces.pieceMeshes.some((p) => p.type === 'queen')).toBe(false);
    expect(pieces._animatingPieces.size).toBe(0);
    expect(pieces.animations).toHaveLength(0);
  });

  // ── Cancellation: model-set rebuild and restart ────────

  it('a model-set rebuild mid-capture cancels stale operations without stranding or deleting meshes', () => {
    const boardPre = emptyBoard();
    boardPre[4][3] = W_QUEEN; // d5
    boardPre[5][4] = B_PAWN; // e6
    sendState(boardPre);

    const t0 = performance.now();
    sendMove({ fromFile: 3, fromRank: 4, toFile: 4, toRank: 5, captured: true, color: 'white' });
    tick(t0 + 150); // mid slide + fade
    expect(pieces.animations).toHaveLength(2);

    const bp = pieces.pieceMeshes.find((p) => p.type === 'pawn');
    const cloneMat = bp.mesh.children[0].material;
    const cloneSpy = vi.spyOn(cloneMat, 'dispose');
    const oldPawnGeo = geos[0];

    // Reload a different model set through the real loader path
    pieces.reloadPieceModels(scene, () => {});
    installModels('set-b');

    // All stale operations cancelled; nothing left in flight
    expect(pieces.animations).toHaveLength(0);
    expect(pieces._animatingPieces.size).toBe(0);
    // The scene holds exactly the freshly rebuilt pieces, on the NEW
    // geometry — no stale/double meshes
    expect(pieces.pieceMeshes).toHaveLength(2);
    expect(scenePieceMeshes()).toHaveLength(2);
    for (const pm of pieces.pieceMeshes) {
      expect(scene.children).toContain(pm.mesh);
      expect(pm.mesh.children[0].geometry).toBe(geos[PIECE_TYPES.indexOf(pm.type)]);
    }
    // The cancelled fade's owned material was disposed exactly once
    expect(cloneSpy).toHaveBeenCalledTimes(1);
    // Old cache disposed, new cache alive
    expect(oldPawnGeo.disposed).toBe(true);
    expect(geos[0].disposed).toBe(false);

    // Ticking after the rebuild is a no-op — no stale callback can delete
    // the replacement meshes
    tick(performance.now() + 500);
    expect(pieces.pieceMeshes).toHaveLength(2);
    expect(scenePieceMeshes()).toHaveLength(2);
    for (const pm of pieces.pieceMeshes) {
      expect(scene.children).toContain(pm.mesh);
    }
  });

  it('a restart mid-capture cancels stale operations and rebuilds exactly the authoritative pieces', () => {
    const boardPre = emptyBoard();
    boardPre[4][3] = W_QUEEN; // d5
    boardPre[5][4] = B_PAWN; // e6
    sendState(boardPre);

    const t0 = performance.now();
    sendMove({ fromFile: 3, fromRank: 4, toFile: 4, toRank: 5, captured: true, color: 'white' });
    tick(t0 + 150); // mid slide + fade
    expect(pieces.animations).toHaveLength(2);

    const bp = pieces.pieceMeshes.find((p) => p.type === 'pawn');
    const cloneMat = bp.mesh.children[0].material;
    const cloneSpy = vi.spyOn(cloneMat, 'dispose');
    const oldQueenMesh = pieces.pieceMeshes.find((p) => p.type === 'queen').mesh;

    // Server restarts the game: new state, then the restart message
    const boardRestart = emptyBoard();
    boardRestart[0][0] = W_KING; // a1
    boardRestart[0][7] = B_KING; // h1
    sendState(boardRestart);
    sendRestart();

    // Stale operations cancelled; scene holds exactly the new position
    expect(pieces.animations).toHaveLength(0);
    expect(pieces._animatingPieces.size).toBe(0);
    expect(pieces.pieceMeshes).toHaveLength(2);
    expect(scenePieceMeshes()).toHaveLength(2);
    expect(scene.children).not.toContain(oldQueenMesh);
    expect(scene.children).not.toContain(bp.mesh);
    const types = pieces.pieceMeshes.map((p) => p.type).sort();
    expect(types).toEqual(['king', 'king']);
    // The cancelled fade's owned material was disposed exactly once
    expect(cloneSpy).toHaveBeenCalledTimes(1);

    // Ticking after the restart is a no-op
    tick(performance.now() + 500);
    expect(pieces.pieceMeshes).toHaveLength(2);
    expect(scenePieceMeshes()).toHaveLength(2);
  });

  // ── Ordinary capture / en passant / promotion regressions ──

  it('ordinary capture: victim fades out and is removed, capturer lands flat', () => {
    const boardPre = emptyBoard();
    boardPre[0][0] = 4; // white rook a1
    boardPre[1][0] = B_PAWN; // black pawn a2
    sendState(boardPre);

    const t0 = performance.now();
    sendMove({ fromFile: 0, fromRank: 0, toFile: 0, toRank: 1, captured: true, color: 'white' });
    const wr = pieces.pieceMeshes.find((p) => p.type === 'rook');
    const bp = pieces.pieceMeshes.find((p) => p.type === 'pawn');
    const bpMesh = bp.mesh;
    const cloneMat = bp.mesh.children[0].material;
    const cloneSpy = vi.spyOn(cloneMat, 'dispose');

    const boardPost = emptyBoard();
    boardPost[1][0] = 4;
    sendState(boardPost);
    expect(pieces.pieceMeshes).toHaveLength(2);

    tick(t0 + 301);
    expect(pieces.pieceMeshes).toHaveLength(1);
    expect(pieces.pieceMeshes[0].type).toBe('rook');
    expect(pieces.pieceMeshes[0].file).toBe(0);
    expect(pieces.pieceMeshes[0].rank).toBe(1);
    expect(pieces.pieceMeshes[0].mesh.position.y).toBeCloseTo(0.01, 6);
    expect(scene.children).toHaveLength(1);
    expect(scene.children).not.toContain(bpMesh);
    expect(cloneSpy).toHaveBeenCalledTimes(1);
    // Shared material untouched
    expect(matBlack.transparent).toBe(false);
    expect(pieces._animatingPieces.size).toBe(0);
  });

  it('en passant: the pawn on the adjacent rank fades out, not the destination square', () => {
    // Black just double-stepped d7-d5 (victim on d5, rank 4); white pawn e5
    // captures en passant onto d6 (rank 5).
    const boardPre = emptyBoard();
    boardPre[4][4] = W_PAWN; // white pawn e5
    boardPre[4][3] = B_PAWN; // black pawn d5 (the EP victim)
    sendState(boardPre);

    const t0 = performance.now();
    sendMove({
      fromFile: 4,
      fromRank: 4,
      toFile: 3,
      toRank: 5,
      captured: true,
      enPassant: true,
      color: 'white',
    });
    const wp = pieces.pieceMeshes.find((p) => p.type === 'pawn' && p.color === 'white');
    const epVictim = pieces.pieceMeshes.find((p) => p.type === 'pawn' && p.color === 'black');
    // The d5 pawn (rank 4, adjacent to the destination) is the victim
    expect(epVictim.rank).toBe(4);
    expect(epVictim.mesh.children[0].material.transparent).toBe(true);
    expect(pieces._animOpCount(epVictim)).toBe(1);
    expect(pieces._animOpCount(wp)).toBe(1);

    const boardPost = emptyBoard();
    boardPost[5][3] = W_PAWN;
    sendState(boardPost);
    expect(pieces.pieceMeshes).toHaveLength(2);

    tick(t0 + 301);
    expect(pieces.pieceMeshes).toHaveLength(1);
    const landed = pieces.pieceMeshes[0];
    expect(landed.type).toBe('pawn');
    expect(landed.color).toBe('white');
    expect(landed.file).toBe(3);
    expect(landed.rank).toBe(5);
    expect(scene.children).toHaveLength(1);
    expect(pieces._animatingPieces.size).toBe(0);
  });

  it('promotion capture: the promoted piece survives the victim fade and lands on the promotion square', () => {
    const boardPre = emptyBoard();
    boardPre[6][4] = W_PAWN; // white pawn e7
    boardPre[7][3] = B_ROOK; // black rook d8
    sendState(boardPre);

    const t0 = performance.now();
    sendMove({ fromFile: 4, fromRank: 6, toFile: 3, toRank: 7, captured: true, color: 'white' });
    const wp = pieces.pieceMeshes.find((p) => p.type === 'pawn' && p.color === 'white');
    const br = pieces.pieceMeshes.find((p) => p.type === 'rook');
    const wpMesh = wp.mesh;
    const brMesh = br.mesh;
    expect(br.mesh.children[0].material.transparent).toBe(true); // rook fading

    // State: pawn placed on d8, promotion pending
    const boardPost = emptyBoard();
    boardPost[7][3] = W_PAWN;
    sendState(boardPost);
    expect(pieces.pieceMeshes).toHaveLength(2);

    // Mid-animation: promotion confirmed (force rebuild)
    tick(t0 + 150);
    sendPromotion('queen', 3, 7, 'white');

    // The pawn entry is replaced by a queen mesh at the canonical base
    // height; the fading rook mesh is removed from the scene.
    expect(wp.type).toBe('queen');
    expect(wp.mesh).not.toBe(wpMesh);
    expect(wp.mesh.position.y).toBeCloseTo(0.01, 6);
    expect(scene.children).toContain(wp.mesh);
    expect(scene.children).not.toContain(wpMesh);
    expect(scene.children).not.toContain(brMesh);
    expect(pieces.pieceMeshes.filter((p) => p.type === 'queen')).toHaveLength(1);
    expect(pieces.pieceMeshes.some((p) => p.type === 'rook')).toBe(false);

    // Slide + fade complete: the queen must still be in the scene (the
    // fade only removes the mesh instance it started with) and at d8.
    tick(t0 + 301);
    expect(pieces.pieceMeshes).toHaveLength(1);
    const queen = pieces.pieceMeshes[0];
    expect(queen.type).toBe('queen');
    expect(queen.file).toBe(3);
    expect(queen.rank).toBe(7);
    expect(scene.children).toHaveLength(1);
    expect(scene.children[0]).toBe(queen.mesh);
    expect(queen.mesh.position.y).toBeCloseTo(0.01, 6);
    expect(pieces._animatingPieces.size).toBe(0);
  });
});
