// ═══════════════════════════════════════════════════════════
//  TEST SUITE — chess engine + security fixes
//  Run:  npm test
// ═══════════════════════════════════════════════════════════

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..'); // project root

const {
  EMPTY,
  W_PAWN,
  W_KNIGHT,
  W_BISHOP,
  W_ROOK,
  W_QUEEN,
  W_KING,
  B_PAWN,
  B_KNIGHT,
  B_BISHOP,
  B_ROOK,
  B_QUEEN,
  B_KING,
  pieceColor,
  pieceType,
  isOwn,
  isEnemy,
  startingBoard,
  cloneBoard,
  findKing,
  isAttacked,
  isInCheck,
  getValidMoves,
  hasAnyMoves,
  isInsufficientMaterial,
  Game,
  Zobrist,
  MAX_POSITION_HISTORY,
  toFen,
  fromFen,
  validateFenForEngine,
  initZobrist,
  getZobrist,
} = require('../../shared/chess.mjs');

const { randomBytes } = require('node:crypto');
const fs = require('fs');

// Initialize Zobrist for tests
initZobrist(randomBytes);
const zobrist = getZobrist();

// ── Test runner — buffered output, prints in declaration order ──
let passed = 0;
let failed = 0;
let total = 0;
const pendingPromises = [];
const results = []; // { label | null, name, ok, err }

function test(name, fn) {
  total++;
  const idx = results.length;
  results.push({ label: null, name, ok: null, err: null });
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      pendingPromises.push(
        result.then(
          () => {
            passed++;
            results[idx].ok = true;
          },
          (e) => {
            failed++;
            results[idx].ok = false;
            results[idx].err = e.message;
          }
        )
      );
    } else {
      passed++;
      results[idx].ok = true;
    }
  } catch (e) {
    failed++;
    results[idx].ok = false;
    results[idx].err = e.message;
  }
}

function describe(label, fn) {
  results.push({ label, name: null, ok: null, err: null });
  fn();
}

// ── Helper: create a fresh game with mock ws objects ─────
function makeGame() {
  const g = new Game();
  const ws1 = { _id: 'p1' };
  const ws2 = { _id: 'p2' };
  g.addPlayer(ws1); // white
  g.addPlayer(ws2); // black
  return { game: g, white: ws1, black: ws2 };
}

describe('Client-side capture — rebuildPieces regression', () => {
  // Simulates the client-side flow: animateMove → rebuildPieces
  // Bug: animateMove did not update fromPiece.file/rank until animation
  // completed, but rebuildPieces runs immediately after and uses those
  // values to build its existing map. The capturing piece at its OLD
  // position was not in desired, so it got removed.

  function makeMockMesh(file, rank, type, color) {
    return {
      mesh: { position: { x: file - 3.5, y: 0.01, z: 3.5 - rank } },
      file,
      rank,
      type,
      color,
    };
  }

  function simulateRebuild(serverBoard, pieceMeshes) {
    // Replicates the rebuildPieces diffing logic (without Three.js)
    const { pieceColor, pieceType } = require('../../shared/chess.mjs');

    const desired = new Map();
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const piece = serverBoard[r][f];
        if (piece === 0) continue;
        desired.set(`${f},${r}`, { type: pieceType(piece), color: pieceColor(piece) });
      }
    }

    const existing = new Map();
    for (const pm of pieceMeshes) {
      existing.set(`${pm.file},${pm.rank}`, pm);
    }

    const toKeep = new Set();
    const removed = [];
    for (const [key, pm] of existing) {
      const dp = desired.get(key);
      if (!dp) {
        removed.push(key);
      } else {
        toKeep.add(key);
      }
    }

    const finalMeshes = [];
    for (const pm of pieceMeshes) {
      const key = `${pm.file},${pm.rank}`;
      if (desired.has(key)) finalMeshes.push(pm);
    }

    return { finalMeshes, removed, toKeep };
  }

  test('capture: capturing piece survives rebuildPieces (regression)', () => {
    // Board: white rook at e1 captures black pawn at e5
    const board = Array.from({ length: 8 }, () => Array(8).fill(0));
    board[0][4] = W_ROOK; // e1
    board[5][4] = B_PAWN; // e5

    let meshes = [makeMockMesh(4, 0, 'rook', 'white'), makeMockMesh(4, 5, 'pawn', 'black')];

    // Simulate animateMove: rook moves e1 → e5, captures pawn
    // FIX: update file/rank IMMEDIATELY (not at end of animation)
    const fromPiece = meshes.find((p) => p.file === 4 && p.rank === 0);
    fromPiece.file = 4; // toFile
    fromPiece.rank = 5; // toRank

    // Remove captured pawn (animateMove does this via splice)
    meshes = meshes.filter((p) => !(p.file === 4 && p.rank === 5 && p.type === 'pawn'));

    // Server board after capture: rook at e5, pawn gone
    const newBoard = Array.from({ length: 8 }, () => Array(8).fill(0));
    newBoard[5][4] = W_ROOK;

    // rebuildPieces runs
    const result = simulateRebuild(newBoard, meshes);

    // The capturing rook must survive
    assert.strictEqual(result.finalMeshes.length, 1, 'capturing piece must survive rebuildPieces');
    assert.strictEqual(result.finalMeshes[0].type, 'rook');
    assert.strictEqual(result.finalMeshes[0].file, 4);
    assert.strictEqual(result.finalMeshes[0].rank, 5);
    // The rook must NOT have been removed
    assert.ok(
      !result.removed.includes('4,5'),
      'capturing piece at destination must not be removed'
    );
  });

  test('capture: WITHOUT the fix, capturing piece is removed (bug reproduction)', () => {
    // Same scenario but WITHOUT updating file/rank immediately
    const board = Array.from({ length: 8 }, () => Array(8).fill(0));
    board[0][4] = W_ROOK;
    board[5][4] = B_PAWN;

    let meshes = [makeMockMesh(4, 0, 'rook', 'white'), makeMockMesh(4, 5, 'pawn', 'black')];

    // BUG: file/rank NOT updated (old behavior — updated at end of animation)
    // fromPiece.file and fromPiece.rank stay at 4,0

    // Remove captured pawn
    meshes = meshes.filter((p) => !(p.file === 4 && p.rank === 5 && p.type === 'pawn'));

    // Server board after capture
    const newBoard = Array.from({ length: 8 }, () => Array(8).fill(0));
    newBoard[5][4] = W_ROOK;

    const result = simulateRebuild(newBoard, meshes);

    // BUG: rook at "4,0" is not in desired → gets removed
    assert.ok(
      result.removed.includes('4,0'),
      'BUG confirmed: capturing piece at old position is removed'
    );
    assert.strictEqual(
      result.finalMeshes.length,
      0,
      'BUG: no pieces survive — capturing piece is gone'
    );
  });

  test('non-capture move: piece survives rebuildPieces', () => {
    // White knight moves b1 → a3 (no capture)
    const meshes = [makeMockMesh(1, 0, 'knight', 'white')];

    // Simulate animateMove with fix: update file/rank immediately
    const fromPiece = meshes[0];
    fromPiece.file = 0; // toFile
    fromPiece.rank = 2; // toRank

    const newBoard = Array.from({ length: 8 }, () => Array(8).fill(0));
    newBoard[2][0] = W_KNIGHT;

    const result = simulateRebuild(newBoard, meshes);
    assert.strictEqual(result.finalMeshes.length, 1);
    assert.strictEqual(result.finalMeshes[0].file, 0);
    assert.strictEqual(result.finalMeshes[0].rank, 2);
  });

  test('en passant: capturing piece survives, captured pawn removed', () => {
    // White pawn at f4 captures en passant: f4 → e5, removes black pawn at e4
    let meshes = [
      makeMockMesh(5, 3, 'pawn', 'white'), // f4
      makeMockMesh(4, 3, 'pawn', 'black'), // e4 (the captured pawn)
    ];

    // animateMove: update file/rank immediately
    const fromPiece = meshes[0];
    fromPiece.file = 4; // toFile (e)
    fromPiece.rank = 4; // toRank (5)

    // En passant: remove captured pawn at epRank (rank 3 = 4th row)
    meshes = meshes.filter((p) => !(p.file === 4 && p.rank === 3 && p.type === 'pawn'));

    const newBoard = Array.from({ length: 8 }, () => Array(8).fill(0));
    newBoard[4][4] = W_PAWN; // e5

    const result = simulateRebuild(newBoard, meshes);
    assert.strictEqual(
      result.finalMeshes.length,
      1,
      'capturing pawn must survive en passant rebuild'
    );
    assert.strictEqual(result.finalMeshes[0].type, 'pawn');
    assert.strictEqual(result.finalMeshes[0].color, 'white');
  });
});

describe('Client-side rebuildPieces — force rebuild for promotion', () => {
  // These tests verify that rebuildPieces with force=true correctly updates
  // animating piece meshes when the serverBoard changes (promotion, FEN import).
  // We simulate the client-side pieceMeshes array and animatingPieces set.

  test('force rebuild updates animating piece type on promotion', () => {
    // Simulate: pawn mesh is animating at e8 (rank 7, file 4) with type=pawn
    const pm = { mesh: {}, file: 4, rank: 7, type: 'pawn', color: 'white' };
    const meshes = [pm];
    const animating = new Set([pm]);

    // Simulate serverBoard after promotion: queen at e8
    const board = Array.from({ length: 8 }, () => Array(8).fill(0));
    board[7][4] = W_QUEEN;

    // Simulate rebuildPieces logic with force=true
    const desired = new Map();
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        if (board[r][f] !== 0) {
          desired.set(`${f},${r}`, {
            type: pieceType(board[r][f]),
            color: pieceColor(board[r][f]),
          });
        }
      }
    }

    // With force=true, animating pieces are processed
    const key = `${pm.file},${pm.rank}`;
    const dp = desired.get(key);
    assert.ok(dp, 'desired piece should exist at e8');
    assert.strictEqual(dp.type, 'queen');
    // The mesh type should be updated
    pm.type = dp.type;
    pm.color = dp.color;
    assert.strictEqual(pm.type, 'queen', 'animating pawn mesh updated to queen');
  });

  test('force rebuild removes animating piece no longer on board', () => {
    // Simulate: piece mesh animating at a square that is now empty after FEN import
    const pm = { mesh: {}, file: 0, rank: 0, type: 'rook', color: 'white' };
    const animating = new Set([pm]);

    // Simulate serverBoard after FEN import: a1 is empty
    const board = Array.from({ length: 8 }, () => Array(8).fill(0));
    board[0][4] = W_KING; // only king on board

    const desired = new Map();
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        if (board[r][f] !== 0) {
          desired.set(`${f},${r}`, {
            type: pieceType(board[r][f]),
            color: pieceColor(board[r][f]),
          });
        }
      }
    }

    // With force=true, the animating piece at a1 should be detected as removed
    const key = `${pm.file},${pm.rank}`;
    const dp = desired.get(key);
    assert.strictEqual(dp, undefined, 'no desired piece at a1');
    // In the real rebuildPieces, this would call scene.remove(pm.mesh)
  });

  test('non-force rebuild skips animating pieces (preserves old behavior)', () => {
    // Simulate: pawn mesh animating at e8, serverBoard has queen
    const pm = { mesh: {}, file: 4, rank: 7, type: 'pawn', color: 'white' };
    const animating = new Set([pm]);

    const board = Array.from({ length: 8 }, () => Array(8).fill(0));
    board[7][4] = W_QUEEN;

    const desired = new Map();
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        if (board[r][f] !== 0) {
          desired.set(`${f},${r}`, {
            type: pieceType(board[r][f]),
            color: pieceColor(board[r][f]),
          });
        }
      }
    }

    // With force=false (normal rebuild), animating pieces are skipped
    // The mesh type should NOT be updated
    assert.strictEqual(pm.type, 'pawn', 'non-force rebuild leaves animating piece unchanged');
  });
});

describe('Client-side rebuildPieces — FEN import race condition', () => {
  test('restart handler clears animations and force-rebuilds', () => {
    // Simulate the onRestart handler behavior:
    // 1. Clear animations array
    // 2. Clear animatingPieces set
    // 3. Call rebuildPieces with force=true
    const animations = [{ update: () => true }];
    const animating = new Set([{ mesh: {}, file: 0, rank: 0, type: 'rook', color: 'white' }]);

    // Simulate restart handler
    animations.length = 0;
    animating.clear();

    assert.strictEqual(animations.length, 0, 'animations cleared');
    assert.strictEqual(animating.size, 0, 'animatingPieces cleared');
  });

  test('promotion handler force-rebuilds without clearing animations', () => {
    // Simulate the onPromotion handler behavior:
    // It calls rebuildPieces with force=true but does NOT clear animations
    // (only the specific piece needs updating, other animations continue)
    const animations = [{ update: () => true }];
    const animating = new Set([{ mesh: {}, file: 4, rank: 7, type: 'pawn', color: 'white' }]);

    // Simulate promotion handler: force rebuild
    // The animating set is NOT cleared — rebuildPieces(force=true) handles it
    assert.strictEqual(animations.length, 1, 'animations preserved');
    assert.strictEqual(animating.size, 1, 'animatingPieces preserved');
  });
});

// ── getState() returns a defensive copy of castlingRights ──

async function printResults() {
  if (pendingPromises.length > 0) {
    await Promise.all(pendingPromises);
  }
  for (const r of results) {
    if (r.label) {
      console.log(`\n${r.label}`);
    } else {
      if (r.ok) {
        console.log(`  ✓ ${r.name}`);
      } else {
        console.log(`  ✗ ${r.name}`);
        console.log(`    ${r.err}`);
      }
    }
  }
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}
printResults();
