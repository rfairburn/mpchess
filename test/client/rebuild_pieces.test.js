import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';

// Regression test for: rebuildPieces de-duplication overwrites entries in
// a position map without removing the discarded mesh from the scene, leaving
// orphaned meshes that accumulate across rebuild cycles.
//
// These tests drive the real client/network.js and client/pieces.js to verify
// the production rebuildPieces path de-duplicates correctly.

vi.mock('../../client/board.js', () => ({
  clearHighlights: vi.fn(),
  highlightCheck: vi.fn(),
}));

vi.mock('../../client/ui.js', () => ({
  menuOpen: false,
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

describe('rebuildPieces — duplicate mesh de-duplication', () => {
  let network;
  let pieces;
  let scene;

  function makeBoard() {
    return Array.from({ length: 8 }, () => Array(8).fill(0));
  }

  function makePieceMesh(type, color, file, rank) {
    const mesh = new THREE.Group();
    const child = new THREE.Mesh(
      null,
      color === 'white'
        ? new THREE.MeshStandardMaterial({ color: 0xffffff })
        : new THREE.MeshStandardMaterial({ color: 0x000000 })
    );
    mesh.add(child);
    mesh.position.set(file - 3.5, 0.01, 3.5 - rank);
    return { mesh, file, rank, type, color };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

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

    // Import the real network.js
    network = await import('../../client/network.js');

    // Import pieces.js — it registers onStateUpdate/onRestart/onPromotion callbacks
    pieces = await import('../../client/pieces.js');

    scene = new THREE.Scene();
    pieces.setScene(scene);

    pieces.setMaterials(
      new THREE.MeshStandardMaterial({ color: 0xffffff }),
      new THREE.MeshStandardMaterial({ color: 0x000000 })
    );

    // Mark models as loaded so rebuildPieces doesn't return early.
    // Use the setter because Object.defineProperty on the module namespace
    // cannot update a local `export let` binding.
    pieces.setModelsLoaded(true);
    pieces.pieceMeshes.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('removes orphaned mesh from scene when de-duplicating pieces at the same position', () => {
    // ServerBoard: single white rook at h1 (file=7, rank=0) — W_ROOK = 4
    const board = makeBoard();
    board[0][7] = 4;
    Object.defineProperty(network, 'serverBoard', {
      value: board,
      writable: true,
      configurable: true,
    });

    // Simulate the bug: two pieceMeshes entries at the same position
    const whiteRook = makePieceMesh('rook', 'white', 7, 0);
    const blackRook = makePieceMesh('rook', 'black', 7, 0);
    pieces.pieceMeshes.push(whiteRook, blackRook);
    scene.add(whiteRook.mesh);
    scene.add(blackRook.mesh);

    expect(pieces.pieceMeshes.length).toBe(2);
    expect(scene.children.length).toBe(2);

    pieces.rebuildPieces(scene);

    // Only one piece should remain
    expect(pieces.pieceMeshes.length).toBe(1);
    expect(pieces.pieceMeshes[0].type).toBe('rook');
    expect(pieces.pieceMeshes[0].color).toBe('white');

    // The orphaned mesh must be removed from the scene
    expect(scene.children.length).toBe(1);
    expect(scene.children[0]).toBe(pieces.pieceMeshes[0].mesh);
  });

  it('keeps the last duplicate when multiple pieces share a position', () => {
    // ServerBoard: white queen at e1 (file=4, rank=0) — W_QUEEN = 5
    const board = makeBoard();
    board[0][4] = 5;
    Object.defineProperty(network, 'serverBoard', {
      value: board,
      writable: true,
      configurable: true,
    });

    // Three meshes at e1: two stale, one correct
    const stale1 = makePieceMesh('pawn', 'white', 4, 0);
    const stale2 = makePieceMesh('bishop', 'black', 4, 0);
    const correct = makePieceMesh('queen', 'white', 4, 0);
    pieces.pieceMeshes.push(stale1, stale2, correct);
    scene.add(stale1.mesh);
    scene.add(stale2.mesh);
    scene.add(correct.mesh);

    expect(scene.children.length).toBe(3);

    pieces.rebuildPieces(scene);

    // Only the correct piece remains
    expect(pieces.pieceMeshes.length).toBe(1);
    expect(pieces.pieceMeshes[0].type).toBe('queen');
    expect(pieces.pieceMeshes[0].color).toBe('white');

    // Orphaned meshes removed from scene
    expect(scene.children.length).toBe(1);
  });

  it('does not remove meshes for pieces at different positions', () => {
    // Two pieces at different positions — no de-dup needed
    const board = makeBoard();
    board[0][0] = 4; // white rook at a1 — W_ROOK = 4
    board[0][7] = 10; // black rook at h1 — B_ROOK = 10
    Object.defineProperty(network, 'serverBoard', {
      value: board,
      writable: true,
      configurable: true,
    });

    const rookA = makePieceMesh('rook', 'white', 0, 0);
    const rookH = makePieceMesh('rook', 'black', 7, 0);
    pieces.pieceMeshes.push(rookA, rookH);
    scene.add(rookA.mesh);
    scene.add(rookH.mesh);

    pieces.rebuildPieces(scene);

    expect(pieces.pieceMeshes.length).toBe(2);
    expect(scene.children.length).toBe(2);
  });
});
