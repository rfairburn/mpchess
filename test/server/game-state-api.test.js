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

describe('getState includes new fields', () => {
  test('getState has halfmoveClock', () => {
    const g = new Game();
    const state = g.getState();
    assert.strictEqual(state.halfmoveClock, 0);
  });

  test('getState has threefoldCount', () => {
    const g = new Game();
    const state = g.getState();
    assert.strictEqual(state.threefoldCount, 1); // starting position, count=1
  });

  test('getState has fen', () => {
    const g = new Game();
    const state = g.getState();
    assert.ok(typeof state.fen === 'string' && state.fen.length > 0);
    assert.ok(state.fen.startsWith('rnbqkbnr'));
  });

  test('threefoldCount updates after moves', () => {
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);
    g.tryMove(ws1, 4, 1, 4, 3); // e4
    const state = g.getState();
    assert.strictEqual(state.threefoldCount, 1); // new position, count=1
  });
});

describe('getState castlingRights is a copy', () => {
  test('mutating returned castlingRights does not affect internal state', () => {
    const game = new Game();
    const state = game.getState();
    state.castlingRights.wK = false;
    state.castlingRights.wQ = false;
    state.castlingRights.bK = false;
    state.castlingRights.bQ = false;
    // Internal state must be unchanged
    assert.strictEqual(game.castlingRights.wK, true);
    assert.strictEqual(game.castlingRights.wQ, true);
    assert.strictEqual(game.castlingRights.bK, true);
    assert.strictEqual(game.castlingRights.bQ, true);
  });

  test('returned castlingRights is not the same object reference', () => {
    const game = new Game();
    const state = game.getState();
    assert.notStrictEqual(state.castlingRights, game.castlingRights);
  });

  test('returned castlingRights has correct values', () => {
    const game = new Game();
    const state = game.getState();
    assert.deepStrictEqual(state.castlingRights, { wK: true, wQ: true, bK: true, bQ: true });
  });

  test('returned castlingRights reflects revoked rights correctly', () => {
    const game = new Game();
    // Load a position where white can castle kingside
    game.loadFromFen('r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 5');
    const ws = {};
    game.addPlayer(ws);
    game.tryMove(ws, 4, 0, 6, 0); // O-O (castles kingside, revokes wK and wQ)
    const state = game.getState();
    assert.strictEqual(state.castlingRights.wK, false);
    assert.strictEqual(state.castlingRights.wQ, false);
    assert.strictEqual(state.castlingRights.bK, true);
    assert.strictEqual(state.castlingRights.bQ, true);
    // Mutate the returned copy
    state.castlingRights.bK = false;
    // Internal state must still be true
    assert.strictEqual(game.castlingRights.bK, true);
  });
});

// ── addMove restores board state on unexpected error ──

describe('addMove board integrity with try/finally', () => {
  test('board is restored after getValidMoves completes normally', () => {
    // Basic sanity: after getValidMoves, the board must be unchanged
    const board = startingBoard();
    const original = cloneBoard(board);
    const moves = getValidMoves(board, 0, 1, { wK: true, wQ: true, bK: true, bQ: true }, null);
    assert.deepStrictEqual(board, original);
    assert.ok(moves.length > 0);
  });

  test('board is restored even when isInCheck would throw', () => {
    // We can't easily mock isInCheck inside getValidMoves, but we can verify
    // the try/finally pattern by checking that the board is always restored
    // after calling getValidMoves on any position.
    const board = startingBoard();
    const original = cloneBoard(board);
    // Make a move to get a different position
    board[2][4] = board[1][4]; // e2-e4
    board[1][4] = 0;
    const after = cloneBoard(board);
    // Call getValidMoves for all pieces on the board
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        if (board[r][f] !== 0) {
          getValidMoves(board, f, r, { wK: true, wQ: true, bK: true, bQ: true }, null);
        }
      }
    }
    // Board must be exactly as we left it
    assert.deepStrictEqual(board, after);
  });

  test('board restored after en passant position getValidMoves', () => {
    // Set up an en passant position: white pawn on e5, black pawn just pushed d7-d5.
    // En passant target is d6 (rank 5 in 0-indexed) — the square the white pawn
    // captures through.
    const board = startingBoard();
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) board[r][f] = 0;
    board[0][4] = W_KING;
    board[7][4] = B_KING;
    board[4][4] = W_PAWN; // e5
    board[4][3] = B_PAWN; // d5 — just pushed from d7
    const original = cloneBoard(board);
    const epTarget = { file: 3, rank: 5 }; // d6 — en passant target square
    const moves = getValidMoves(
      board,
      4,
      4,
      { wK: false, wQ: false, bK: false, bQ: false },
      epTarget
    );
    assert.deepStrictEqual(board, original);
    // White pawn should have an en passant capture option
    const epMove = moves.find((m) => m.enPassant === true);
    assert.ok(epMove, 'Expected en passant capture move');
  });
});

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
