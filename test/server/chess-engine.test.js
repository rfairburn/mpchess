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
  getPremoveMoves,
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

describe('Piece constants and helpers', () => {
  test('pieceColor identifies white pieces', () => {
    assert.strictEqual(pieceColor(W_PAWN), 'white');
    assert.strictEqual(pieceColor(W_KING), 'white');
    assert.strictEqual(pieceColor(0), null);
  });

  test('pieceColor identifies black pieces', () => {
    assert.strictEqual(pieceColor(B_PAWN), 'black');
    assert.strictEqual(pieceColor(B_KING), 'black');
  });

  test('pieceType returns correct type strings', () => {
    assert.strictEqual(pieceType(W_KNIGHT), 'knight');
    assert.strictEqual(pieceType(B_QUEEN), 'queen');
    assert.strictEqual(pieceType(W_PAWN), 'pawn');
    assert.strictEqual(pieceType(0), null);
  });

  test('isOwn / isEnemy', () => {
    assert.strictEqual(isOwn(W_PAWN, 'white'), true);
    assert.strictEqual(isOwn(B_PAWN, 'white'), false);
    assert.strictEqual(isEnemy(B_PAWN, 'white'), true);
    assert.strictEqual(isEnemy(W_PAWN, 'white'), false);
  });
});

describe('Starting board', () => {
  test('white back rank has correct pieces', () => {
    const b = startingBoard();
    assert.strictEqual(b[0][0], W_ROOK);
    assert.strictEqual(b[0][1], W_KNIGHT);
    assert.strictEqual(b[0][2], W_BISHOP);
    assert.strictEqual(b[0][3], W_QUEEN);
    assert.strictEqual(b[0][4], W_KING);
  });

  test('black back rank has correct pieces', () => {
    const b = startingBoard();
    assert.strictEqual(b[7][0], B_ROOK);
    assert.strictEqual(b[7][4], B_KING);
    assert.strictEqual(b[7][7], B_ROOK);
  });

  test('pawn ranks are correct', () => {
    const b = startingBoard();
    for (let f = 0; f < 8; f++) {
      assert.strictEqual(b[1][f], W_PAWN);
      assert.strictEqual(b[6][f], B_PAWN);
    }
  });

  test('cloneBoard produces independent copy', () => {
    const b = startingBoard();
    const c = cloneBoard(b);
    c[0][0] = 0;
    assert.strictEqual(b[0][0], W_ROOK);
  });
});

describe('Move generation — basic pieces', () => {
  test('white pawn at e2 can move to e3 and e4', () => {
    const b = startingBoard();
    const moves = getValidMoves(b, 4, 1, { wK: true, wQ: true, bK: true, bQ: true }, null);
    const targets = moves.map((m) => `${m.file},${m.rank}`);
    assert.ok(targets.includes('4,2'), 'e3 should be valid');
    assert.ok(targets.includes('4,3'), 'e4 should be valid');
  });

  test('white king in center has 8 possible moves on empty board', () => {
    const b = Array.from({ length: 8 }, () => Array(8).fill(0));
    b[4][4] = W_KING;
    const moves = getValidMoves(b, 4, 4, {}, null);
    assert.strictEqual(moves.length, 8);
  });

  test('knight has correct L-shaped moves', () => {
    const b = Array.from({ length: 8 }, () => Array(8).fill(0));
    b[3][3] = W_KNIGHT;
    const moves = getValidMoves(b, 3, 3, {}, null);
    assert.strictEqual(moves.length, 8);
  });

  test('bishop moves diagonally and stops before own piece', () => {
    const b = Array.from({ length: 8 }, () => Array(8).fill(0));
    b[4][4] = W_BISHOP;
    b[6][6] = W_PAWN; // blocks at (6,6)
    const moves = getValidMoves(b, 4, 4, {}, null);
    const diag = moves.filter((m) => m.file > 4 && m.rank > 4);
    assert.strictEqual(diag.length, 1, 'should reach (5,5) but stop before (6,6)');
    assert.strictEqual(diag[0].file, 5);
    assert.strictEqual(diag[0].rank, 5);
  });
});

describe('Check detection', () => {
  test('king is not in check at start', () => {
    const b = startingBoard();
    assert.strictEqual(isInCheck(b, 'white'), false);
    assert.strictEqual(isInCheck(b, 'black'), false);
  });

  test('queen delivers check', () => {
    const b = Array.from({ length: 8 }, () => Array(8).fill(0));
    b[0][4] = W_KING;
    b[0][0] = B_QUEEN;
    assert.strictEqual(isInCheck(b, 'white'), true);
  });

  test('bishop delivers check on diagonal', () => {
    const b = Array.from({ length: 8 }, () => Array(8).fill(0));
    b[0][4] = W_KING; // e1
    b[4][0] = B_BISHOP; // a5 — diagonal a5-e1 hits king
    assert.strictEqual(isInCheck(b, 'white'), true);
  });

  test('pawn delivers check', () => {
    const b = Array.from({ length: 8 }, () => Array(8).fill(0));
    b[0][4] = W_KING;
    b[1][3] = B_PAWN;
    assert.strictEqual(isInCheck(b, 'white'), true);
  });
});

describe('Castling', () => {
  test('white king-side castling is available when path is clear', () => {
    const b = Array.from({ length: 8 }, () => Array(8).fill(0));
    b[0][4] = W_KING;
    b[0][7] = W_ROOK;
    const moves = getValidMoves(b, 4, 0, { wK: true, wQ: true, bK: true, bQ: true }, null);
    const ks = moves.find((m) => m.castle === 'K');
    assert.ok(ks, 'king-side castle should be available');
    assert.strictEqual(ks.file, 6);
  });

  test('white queen-side castling is available when path is clear', () => {
    const b = Array.from({ length: 8 }, () => Array(8).fill(0));
    b[0][4] = W_KING;
    b[0][0] = W_ROOK;
    const moves = getValidMoves(b, 4, 0, { wK: true, wQ: true, bK: true, bQ: true }, null);
    const qs = moves.find((m) => m.castle === 'Q');
    assert.ok(qs, 'queen-side castle should be available');
    assert.strictEqual(qs.file, 2);
  });

  test('castling unavailable when rights are cleared', () => {
    const b = startingBoard();
    const moves = getValidMoves(b, 4, 0, { wK: false, wQ: false, bK: true, bQ: true }, null);
    assert.strictEqual(
      moves.find((m) => m.castle),
      undefined
    );
  });

  test('castling unavailable when path is blocked', () => {
    const b = startingBoard();
    b[0][5] = W_PAWN; // block king-side
    const moves = getValidMoves(b, 4, 0, { wK: true, wQ: true, bK: true, bQ: true }, null);
    assert.strictEqual(
      moves.find((m) => m.castle === 'K'),
      undefined
    );
  });

  test('castling unavailable when king is in check', () => {
    const b = startingBoard();
    // Put a black bishop on b4 to check e1
    b[2][1] = B_BISHOP;
    const moves = getValidMoves(b, 4, 0, { wK: true, wQ: true, bK: true, bQ: true }, null);
    assert.strictEqual(
      moves.find((m) => m.castle),
      undefined
    );
  });
});

describe('Castling rights — P0 fix regression tests', () => {
  test('king moving one square revokes BOTH castling rights', () => {
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);

    // Clear the board so king can move freely
    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[0][4] = W_KING;
    g.board[0][0] = W_ROOK;
    g.board[0][7] = W_ROOK;
    g.turn = 'white';
    g.castlingRights = { wK: true, wQ: true, bK: false, bQ: false };

    // King moves one square
    const result = g.tryMove(ws1, 4, 0, 3, 0);
    assert.strictEqual(result.ok, true);
    // Both rights should be revoked
    assert.strictEqual(g.castlingRights.wK, false, 'wK should be false after king moves');
    assert.strictEqual(g.castlingRights.wQ, false, 'wQ should be false after king moves');
  });

  test('black king moving one square revokes castling rights', () => {
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[7][4] = B_KING;
    g.board[7][0] = B_ROOK;
    g.board[7][7] = B_ROOK;
    g.turn = 'black';
    g.castlingRights = { wK: false, wQ: false, bK: true, bQ: true };

    const result = g.tryMove(ws2, 4, 7, 5, 7);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(g.castlingRights.bK, false);
    assert.strictEqual(g.castlingRights.bQ, false);
  });
});

describe('En passant', () => {
  test('en passant target is set after two-square pawn push', () => {
    const { game, white } = makeGame();
    game.tryMove(white, 4, 1, 4, 3); // e4
    assert.ok(game.enPassantTarget);
    assert.strictEqual(game.enPassantTarget.file, 4);
    assert.strictEqual(game.enPassantTarget.rank, 2);
  });

  test('en passant capture is available', () => {
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);

    // White pawn at f4 (rank 3), en passant target at e5 (rank 4)
    // White pawn captures forward-left: rank 3→4, file 5→4
    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[3][5] = W_PAWN; // f4 (rank 3, file 5)
    g.board[3][4] = B_PAWN; // e4 (rank 3, file 4) — the captured pawn
    g.enPassantTarget = { file: 4, rank: 4 }; // e5 — where white pawn moves to
    g.turn = 'white';

    const moves = getValidMoves(g.board, 5, 3, g.castlingRights, g.enPassantTarget);
    const ep = moves.find((m) => m.enPassant === true);
    assert.ok(ep, 'en passant capture should be available');
    assert.strictEqual(ep.file, 4);
    assert.strictEqual(ep.rank, 4);
  });

  test('en passant target is cleared after a non-double-pawn move', () => {
    const { game, white, black } = makeGame();
    game.tryMove(white, 4, 1, 4, 3); // e4
    assert.ok(game.enPassantTarget);
    game.tryMove(black, 4, 6, 4, 4); // e5 (double push: rank 6→4)
    assert.ok(game.enPassantTarget, 'en passant target set after e5');
    // Now white moves a knight (not a double pawn push)
    game.tryMove(white, 1, 0, 2, 2); // Nc3 (b1→c3: file 1→2, rank 0→2)
    // After a non-double-pawn move, en passant target should be cleared
    assert.strictEqual(game.enPassantTarget, null);
  });
});

describe('Promotion — P0 fix regression tests', () => {
  test('promotion to queen works', () => {
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);

    // Set up white pawn one square from promotion
    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[6][4] = W_PAWN;
    g.turn = 'white';

    const result = g.tryMove(ws1, 4, 6, 4, 7);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.promotion, true);

    g.completePromotion(ws1, 'queen');
    assert.strictEqual(g.board[7][4], W_QUEEN);
  });

  test('promotion to rook works', () => {
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[6][4] = W_PAWN;
    g.turn = 'white';

    g.tryMove(ws1, 4, 6, 4, 7);
    g.completePromotion(ws1, 'rook');
    assert.strictEqual(g.board[7][4], W_ROOK);
  });

  test('promotion to bishop works', () => {
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[6][4] = W_PAWN;
    g.turn = 'white';

    g.tryMove(ws1, 4, 6, 4, 7);
    g.completePromotion(ws1, 'bishop');
    assert.strictEqual(g.board[7][4], W_BISHOP);
  });

  test('promotion to knight works', () => {
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[6][4] = W_PAWN;
    g.turn = 'white';

    g.tryMove(ws1, 4, 6, 4, 7);
    g.completePromotion(ws1, 'knight');
    assert.strictEqual(g.board[7][4], W_KNIGHT);
  });

  test('invalid promotion pieceType returns false and does not corrupt board', () => {
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[6][4] = W_PAWN;
    g.turn = 'white';

    g.tryMove(ws1, 4, 6, 4, 7);
    const result = g.completePromotion(ws1, 'king');
    assert.strictEqual(result, false, 'invalid pieceType should return false');
    assert.ok(!Number.isNaN(g.board[7][4]), 'board should not contain NaN');
  });

  test('undefined promotion pieceType returns false', () => {
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[6][4] = W_PAWN;
    g.turn = 'white';

    g.tryMove(ws1, 4, 6, 4, 7);
    const result = g.completePromotion(ws1, undefined);
    assert.strictEqual(result, false);
    assert.ok(!Number.isNaN(g.board[7][4]));
  });

  test('black pawn promotes correctly', () => {
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[1][4] = B_PAWN;
    g.turn = 'black';

    g.tryMove(ws2, 4, 1, 4, 0);
    g.completePromotion(ws2, 'queen');
    assert.strictEqual(g.board[0][4], B_QUEEN);
  });

  test('promotion via capture revokes captured rook castling rights (white pawn takes black rook on a8)', () => {
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[6][1] = W_PAWN; // b7 — white pawn
    g.board[7][0] = B_ROOK; // a8 — black rook on home square
    g.board[7][4] = B_KING; // e8
    g.turn = 'white';
    g.castlingRights = { wK: false, wQ: false, bK: true, bQ: true };

    // b7xa8 — promotion capture
    const result = g.tryMove(ws1, 1, 6, 0, 7);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.promotion, true);

    g.completePromotion(ws1, 'queen');
    assert.strictEqual(g.board[7][0], W_QUEEN, 'queen at a8');
    assert.strictEqual(g.castlingRights.bQ, false, 'bQ revoked after capturing rook on a8');
    assert.strictEqual(g.castlingRights.bK, true, 'bK unchanged');
  });

  test('promotion via capture revokes captured rook castling rights (black pawn takes white rook on h1)', () => {
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[1][6] = B_PAWN; // g2 — black pawn
    g.board[0][7] = W_ROOK; // h1 — white rook on home square
    g.board[0][4] = W_KING; // e1
    g.turn = 'black';
    g.castlingRights = { wK: true, wQ: true, bK: false, bQ: false };

    // g2xh1 — promotion capture
    const result = g.tryMove(ws2, 6, 1, 7, 0);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.promotion, true);

    g.completePromotion(ws2, 'knight');
    assert.strictEqual(g.board[0][7], B_KNIGHT, 'knight at h1');
    assert.strictEqual(g.castlingRights.wK, false, 'wK revoked after capturing rook on h1');
    assert.strictEqual(g.castlingRights.wQ, true, 'wQ unchanged');
  });

  test('promotion without capture does not affect castling rights', () => {
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[6][4] = W_PAWN; // e7
    g.board[7][4] = B_KING; // e8
    g.turn = 'white';
    g.castlingRights = { wK: false, wQ: false, bK: true, bQ: true };

    // Pawn pushes straight to e8 — but e8 has the king, so it's a capture.
    // Use a different file for the promotion to avoid capturing.
    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[6][3] = W_PAWN; // d7
    g.board[7][4] = B_KING; // e8
    g.turn = 'white';
    g.castlingRights = { wK: false, wQ: false, bK: true, bQ: true };

    const result = g.tryMove(ws1, 3, 6, 3, 7); // d7-d8, no capture
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.promotion, true);

    g.completePromotion(ws1, 'queen');
    assert.strictEqual(g.castlingRights.bK, true, 'bK unchanged');
    assert.strictEqual(g.castlingRights.bQ, true, 'bQ unchanged');
  });
});

describe('Checkmate and stalemate', () => {
  test('back-rank checkmate is detected', () => {
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);

    // White king on e1 trapped by own pieces. Queen on e8, knight on c3 protects e2.
    // Qe2# — king can't capture queen (protected by knight), no escape squares.
    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[0][4] = W_KING; // e1
    g.board[0][3] = W_ROOK; // d1 (blocks escape)
    g.board[0][5] = W_ROOK; // f1 (blocks escape)
    g.board[1][3] = W_PAWN; // d2 (blocks escape)
    g.board[1][5] = W_PAWN; // f2 (blocks escape)
    g.board[7][4] = B_QUEEN; // e8
    g.board[2][2] = B_KNIGHT; // c3 (protects e2)
    g.turn = 'black';
    g.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };

    const result = g.tryMove(ws2, 4, 7, 4, 1); // Qe2#
    assert.strictEqual(result.ok, true);
    assert.strictEqual(g.gameOver, true);
    assert.ok(g.gameResult.startsWith('game.checkmate'));
  });

  test('stalemate is detected', () => {
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);

    // King on a1, black knights control a2 and b1, black king blocks b2
    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[0][0] = W_KING; // a1
    g.board[0][2] = B_KNIGHT; // c1 — controls a2, b3
    g.board[1][3] = B_KNIGHT; // d2 — controls b1, b3, c4, e4, f3, f1
    g.board[2][1] = B_KING; // c3 — controls b2, b3, c2, c4, d2, d3, d4, b4
    g.turn = 'white';
    g.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };

    // King at a1: a2 controlled by c1 knight, b1 controlled by d2 knight, b2 controlled by c3 king
    // King is not in check (no piece attacks a1)
    const inCheck = isInCheck(g.board, 'white');
    assert.strictEqual(inCheck, false, `king should not be in check`);
    const hasMoves = hasAnyMoves(g.board, 'white', g.castlingRights, null);
    assert.strictEqual(hasMoves, false, `king should have no legal moves`);

    g.checkGameEnd();
    assert.strictEqual(g.gameOver, true, `should be game over`);
    assert.strictEqual(g.gameResult, 'game.stalemate', `should be stalemate: ${g.gameResult}`);
  });
});

describe('Defense-in-depth — tryMove handles garbage input gracefully', () => {
  // These test that the Game engine doesn't crash on bad input.
  // The primary bounds check lives in the WebSocket message handler,
  // but tryMove should also fail safely as a last line of defense.

  test('out-of-bounds indices fail gracefully (no crash)', () => {
    const { game, white } = makeGame();
    const result = game.tryMove(white, 9, 1, 4, 2);
    assert.strictEqual(result.ok, false);
  });

  test('negative indices fail gracefully (no crash)', () => {
    const { game, white } = makeGame();
    const result = game.tryMove(white, -1, 1, 4, 2);
    assert.strictEqual(result.ok, false);
  });

  test('string indices fail gracefully (no crash)', () => {
    const { game, white } = makeGame();
    const result = game.tryMove(white, 'e', 1, 4, 2);
    assert.strictEqual(result.ok, false);
  });

  test('server-side WebSocket bounds validator rejects invalid values', () => {
    // Simulates the server-side validation:
    // ![fromFile, fromRank, toFile, toRank].every(v => Number.isInteger(v) && v >= 0 && v <= 7)
    const valid = (v) => Number.isInteger(v) && v >= 0 && v <= 7;

    assert.ok([4, 1, 4, 2].every(valid), 'valid indices pass');
    assert.ok(![9, 1, 4, 2].every(valid), 'out-of-range rejected');
    assert.ok(![-1, 1, 4, 2].every(valid), 'negative rejected');
    assert.ok(!['e', 1, 4, 2].every(valid), 'string rejected');
    assert.ok(![4.5, 1, 4, 2].every(valid), 'float rejected');
    assert.ok(![null, 1, 4, 2].every(valid), 'null rejected');
  });

  test('server-side promotion validator rejects invalid piece types', () => {
    const validTypes = ['queen', 'rook', 'bishop', 'knight'];

    assert.ok(validTypes.includes('queen'));
    assert.ok(!validTypes.includes('king'));
    assert.ok(!validTypes.includes('pawn'));
    assert.ok(!validTypes.includes(undefined));
    assert.ok(!validTypes.includes(''));
  });
});

describe('getPremoveMoves — premove candidate generator', () => {
  const NO_RIGHTS = { wK: false, wQ: false, bK: false, bQ: false };

  // Build an empty board and place pieces via a map of "file,rank":piece.
  function boardWith(pieces) {
    const b = Array.from({ length: 8 }, () => Array(8).fill(0));
    for (const [key, p] of Object.entries(pieces)) {
      const [f, r] = key.split(',').map(Number);
      b[r][f] = p;
    }
    return b;
  }

  function hasTarget(moves, f, r) {
    return moves.some((m) => m.file === f && m.rank === r);
  }

  test('premoved recapture: friendly-occupied destination is a candidate (not legal)', () => {
    // White rook d1, friendly pawn d2 blocks the d-file.
    const b = boardWith({
      '4,0': W_KING,
      '3,0': W_ROOK,
      '3,1': W_PAWN,
      '4,7': B_KING,
    });
    const legal = getValidMoves(b, 3, 0, NO_RIGHTS, null);
    const pre = getPremoveMoves(b, 3, 0, NO_RIGHTS, null);
    assert.ok(!hasTarget(legal, 3, 1), 'd2 (friendly) must not be a legal move');
    assert.ok(hasTarget(pre, 3, 1), 'd2 (friendly) must be a premove candidate');
  });

  test('pin that disappears: pinned piece off-line moves are candidates (not legal)', () => {
    // White rook e4 pinned to king e1 by black queen e8.
    const b = boardWith({
      '4,0': W_KING,
      '4,3': W_ROOK,
      '4,7': B_QUEEN,
      '0,7': B_KING,
    });
    const legal = getValidMoves(b, 4, 3, NO_RIGHTS, null);
    const pre = getPremoveMoves(b, 4, 3, NO_RIGHTS, null);
    assert.ok(!hasTarget(legal, 3, 3), 'd4 (off the pin line) must not be legal');
    assert.ok(!hasTarget(legal, 5, 3), 'f4 (off the pin line) must not be legal');
    assert.ok(hasTarget(pre, 3, 3), 'd4 must be a premove candidate');
    assert.ok(hasTarget(pre, 5, 3), 'f4 must be a premove candidate');
  });

  test('pawn destination vacated: one-step onto enemy-occupied square is a candidate', () => {
    // White pawn d2, black knight d3 (the one-step destination).
    const b = boardWith({
      '4,0': W_KING,
      '3,1': W_PAWN,
      '3,2': B_KNIGHT,
      '4,7': B_KING,
    });
    const legal = getValidMoves(b, 3, 1, NO_RIGHTS, null);
    const pre = getPremoveMoves(b, 3, 1, NO_RIGHTS, null);
    assert.ok(!hasTarget(legal, 3, 2), 'd3 (enemy-occupied) must not be a legal pawn advance');
    assert.ok(hasTarget(pre, 3, 2), 'd3 must be a premove candidate (opponent may vacate)');
  });

  test('pawn one-step onto friendly-occupied square is NOT a candidate', () => {
    // White pawn e2, friendly pawn e3.
    const b = boardWith({
      '4,0': W_KING,
      '4,1': W_PAWN,
      '4,2': W_PAWN,
      '4,7': B_KING,
    });
    const pre = getPremoveMoves(b, 4, 1, NO_RIGHTS, null);
    assert.ok(!hasTarget(pre, 4, 2), 'e3 (friendly) must not be a premove candidate');
  });

  test('pawn capture appears for every diagonal occupancy (empty/enemy/friendly)', () => {
    // White pawn e4; test the d5 and f5 diagonals under each occupancy.
    for (const diag of [3, 5]) {
      for (const [label, piece] of [
        ['empty', 0],
        ['enemy', B_KNIGHT],
        ['friendly', W_KNIGHT],
      ]) {
        const b = boardWith({
          '4,0': W_KING,
          '4,3': W_PAWN,
          '4,7': B_KING,
        });
        if (piece !== 0) b[4][diag] = piece; // rank 4, file = diag
        const pre = getPremoveMoves(b, 4, 3, NO_RIGHTS, null);
        assert.ok(hasTarget(pre, diag, 4), `(${label}) diagonal must be a premove candidate`);
      }
    }
  });

  test('pawn two-step occupancy: emitted set matches the rule exactly', () => {
    // White pawn e2 (starting rank). Intermediate e3 (4,2), destination e4 (4,3).
    const E = EMPTY;
    const EN = B_KNIGHT;
    const OW = W_KNIGHT;
    const cases = [
      [E, E, true], // empty/empty
      [EN, E, true], // enemy/empty
      [E, EN, true], // empty/enemy
      [EN, EN, false], // enemy/enemy — one move cannot vacate two squares
      [OW, E, false], // friendly path square
      [E, OW, false], // friendly path square
      [OW, OW, false], // friendly path squares
      [OW, EN, false], // friendly path square
      [EN, OW, false], // friendly path square
    ];
    for (const [mid, dest, expected] of cases) {
      const b = boardWith({ '0,0': W_KING, '0,7': B_KING, '4,1': W_PAWN });
      if (mid !== E) b[2][4] = mid;
      if (dest !== E) b[3][4] = dest;
      const pre = getPremoveMoves(b, 4, 1, NO_RIGHTS, null);
      const emitted = hasTarget(pre, 4, 3);
      assert.strictEqual(
        emitted,
        expected,
        `two-step e4 with mid=${mid}, dest=${dest} should be ${expected ? 'emitted' : 'not emitted'}`
      );
    }
  });

  test('still excluded: sliding blocker and off-board squares are not candidates', () => {
    // Rook d1 behind friendly pawns d2 and d3 — slide stops at d2.
    const b = boardWith({
      '4,0': W_KING,
      '3,0': W_ROOK,
      '3,1': W_PAWN,
      '3,2': W_PAWN,
      '4,7': B_KING,
    });
    const pre = getPremoveMoves(b, 3, 0, NO_RIGHTS, null);
    assert.ok(hasTarget(pre, 3, 1), 'd2 (first friendly blocker) is a candidate');
    assert.ok(!hasTarget(pre, 3, 2), 'd3 (behind the blocker) is not a candidate');

    // Rook a1 — no off-board candidates.
    const b2 = boardWith({
      '0,0': W_ROOK,
      '4,0': W_KING,
      '4,7': B_KING,
    });
    const pre2 = getPremoveMoves(b2, 0, 0, NO_RIGHTS, null);
    for (const m of pre2) {
      assert.ok(m.file >= 0 && m.file < 8 && m.rank >= 0 && m.rank < 8, 'no off-board candidate');
    }
  });

  test('castling while in check: castle candidates present (structural checks only)', () => {
    // White king e1 in check from black queen b4; rooks a1 and h1, rights intact.
    const b = boardWith({
      '4,0': W_KING,
      '0,0': W_ROOK,
      '7,0': W_ROOK,
      '1,3': B_QUEEN,
      '4,7': B_KING,
    });
    const rights = { wK: true, wQ: true, bK: false, bQ: false };
    const legal = getValidMoves(b, 4, 0, rights, null);
    const pre = getPremoveMoves(b, 4, 0, rights, null);
    assert.ok(!legal.some((m) => m.castle), 'no legal castle while in check');
    assert.ok(
      pre.some((m) => m.castle === 'K'),
      'king-side castle must be a premove candidate'
    );
    assert.ok(
      pre.some((m) => m.castle === 'Q'),
      'queen-side castle must be a premove candidate'
    );
  });

  test('en passant is a premove candidate when the target is set', () => {
    // White pawn f4, black pawn e4 just pushed; EP target e5.
    const b = boardWith({
      '4,0': W_KING,
      '5,3': W_PAWN,
      '4,3': B_PAWN,
      '4,7': B_KING,
    });
    const ep = { file: 4, rank: 4 };
    const pre = getPremoveMoves(b, 5, 3, NO_RIGHTS, ep);
    assert.ok(
      pre.some((m) => m.enPassant === true && m.file === 4 && m.rank === 4),
      'en passant must be a premove candidate'
    );
  });

  test('non-drift battery: premove − legal is exactly the intended permissive set, per piece', () => {
    const ALL_RIGHTS = { wK: true, wQ: true, bK: true, bQ: true };
    // For each position, `expected` maps a piece square "file,rank" to the exact
    // sorted set of premove-only moves (getPremoveMoves − getValidMoves). Every
    // entry is a legitimate permissive addition per plan §4.1: a friendly-occupied
    // recapture, a king-safety-skipped move, a permissive pawn move, a pin-removed
    // move, or castling-while-in-check. Empty arrays assert there are NO unexpected
    // extras for that piece. Every occupied square must appear in `expected`.
    const positions = [
      // open: starting position (blocked pieces → recaptures; pawns → empty diagonals)
      {
        name: 'open',
        board: startingBoard(),
        rights: ALL_RIGHTS,
        ep: null,
        expected: {
          '0,0': ['0,1', '1,0'],
          '1,0': ['3,1'],
          '2,0': ['1,1', '3,1'],
          '3,0': ['2,0', '2,1', '3,1', '4,0', '4,1'],
          '4,0': ['3,0', '3,1', '4,1', '5,0', '5,1'],
          '5,0': ['4,1', '6,1'],
          '6,0': ['4,1'],
          '7,0': ['6,0', '7,1'],
          '0,1': ['1,2'],
          '1,1': ['0,2', '2,2'],
          '2,1': ['1,2', '3,2'],
          '3,1': ['2,2', '4,2'],
          '4,1': ['3,2', '5,2'],
          '5,1': ['4,2', '6,2'],
          '6,1': ['5,2', '7,2'],
          '7,1': ['6,2'],
          '0,6': ['1,5'],
          '1,6': ['0,5', '2,5'],
          '2,6': ['1,5', '3,5'],
          '3,6': ['2,5', '4,5'],
          '4,6': ['3,5', '5,5'],
          '5,6': ['4,5', '6,5'],
          '6,6': ['5,5', '7,5'],
          '7,6': ['6,5'],
          '0,7': ['0,6', '1,7'],
          '1,7': ['3,6'],
          '2,7': ['1,6', '3,6'],
          '3,7': ['2,6', '2,7', '3,6', '4,6', '4,7'],
          '4,7': ['3,6', '3,7', '4,6', '5,6', '5,7'],
          '5,7': ['4,6', '6,6'],
          '6,7': ['4,6'],
          '7,7': ['6,7', '7,6'],
        },
      },
      // midgame
      {
        name: 'midgame',
        board: boardWith({
          '4,0': W_KING,
          '7,0': W_ROOK,
          '3,0': W_QUEEN,
          '4,3': W_PAWN,
          '6,3': W_BISHOP,
          '4,7': B_KING,
          '0,7': B_ROOK,
          '3,4': B_QUEEN,
          '3,3': B_PAWN,
          '1,2': B_KNIGHT,
        }),
        rights: { wK: true, wQ: false, bK: true, bQ: false },
        ep: null,
        expected: {
          '3,0': ['4,0', '6,3'],
          '4,0': ['3,0', '3,1'],
          '7,0': ['4,0'],
          '1,2': ['3,3'],
          '3,3': ['2,2', '4,2'],
          '4,3': ['5,4'],
          '6,3': ['3,0'],
          '3,4': ['0,7', '1,2', '3,3'],
          '0,7': ['4,7'],
          '4,7': ['3,6'],
        },
      },
      // endgame
      {
        name: 'endgame',
        board: boardWith({
          '0,0': W_KING,
          '2,1': W_BISHOP,
          '7,7': B_KING,
          '5,6': B_KNIGHT,
        }),
        rights: NO_RIGHTS,
        ep: null,
        expected: {
          '0,0': [],
          '2,1': [],
          '5,6': ['7,7'],
          '7,7': ['7,6'],
        },
      },
      // pinned
      {
        name: 'pinned',
        board: boardWith({
          '4,0': W_KING,
          '4,3': W_ROOK,
          '4,7': B_QUEEN,
          '0,7': B_KING,
        }),
        rights: NO_RIGHTS,
        ep: null,
        expected: {
          '4,0': [],
          '4,3': ['0,3', '1,3', '2,3', '3,3', '4,0', '5,3', '6,3', '7,3'],
          '0,7': [],
          '4,7': ['0,7'],
        },
      },
      // in check (castling available)
      {
        name: 'incheck',
        board: boardWith({
          '4,0': W_KING,
          '0,0': W_ROOK,
          '7,0': W_ROOK,
          '1,3': B_QUEEN,
          '4,7': B_KING,
        }),
        rights: { wK: true, wQ: true, bK: false, bQ: false },
        ep: null,
        expected: {
          '0,0': ['0,1', '0,2', '0,3', '0,4', '0,5', '0,6', '0,7', '1,0', '2,0', '3,0', '4,0'],
          '4,0': ['2,0,Q', '3,1', '6,0,K'],
          '7,0': ['4,0', '5,0', '6,0', '7,1', '7,2', '7,3', '7,4', '7,5', '7,6', '7,7'],
          '1,3': [],
          '4,7': [],
        },
      },
      // en passant available
      {
        name: 'ep',
        board: boardWith({
          '4,0': W_KING,
          '5,3': W_PAWN,
          '4,3': B_PAWN,
          '4,7': B_KING,
        }),
        rights: NO_RIGHTS,
        ep: { file: 4, rank: 4 },
        expected: {
          '4,0': [],
          '4,3': ['3,2', '5,2'],
          '5,3': ['6,4'],
          '4,7': [],
        },
      },
    ];

    const key = (m) =>
      `${m.file},${m.rank}${m.enPassant ? ',ep' : ''}${m.castle ? ',' + m.castle : ''}`;

    for (const { name, board, rights, ep, expected } of positions) {
      // The expected map must cover exactly the occupied squares: no silent
      // fallback for a forgotten piece, no stale/typo'd keys left behind.
      const occupied = [];
      for (let r = 0; r < 8; r++)
        for (let f = 0; f < 8; f++) if (board[r][f] !== 0) occupied.push(`${f},${r}`);
      assert.deepStrictEqual(
        Object.keys(expected).sort(),
        [...occupied].sort(),
        `[${name}] expected map keys must match the occupied squares exactly`
      );
      for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
          if (board[r][f] === 0) continue;
          const sq = `${f},${r}`;
          const legal = getValidMoves(board, f, r, rights, ep);
          const pre = getPremoveMoves(board, f, r, rights, ep);
          const preKeys = new Set(pre.map(key));
          // Direction 1: every legal move is a premove candidate (no missing legal moves).
          for (const m of legal) {
            assert.ok(
              preKeys.has(key(m)),
              `[${name}] legal move ${key(m)} for piece at ${sq} missing from premove set`
            );
          }
          // Direction 2: the premove-only moves are exactly the intended permissive set.
          const legalKeys = new Set(legal.map(key));
          const actual = pre
            .filter((m) => !legalKeys.has(key(m)))
            .map(key)
            .sort();
          const want = [...expected[sq]].sort();
          assert.deepStrictEqual(
            actual,
            want,
            `[${name}] premove−legal for piece at ${sq} = [${actual.join(', ')}], expected [${want.join(', ')}]`
          );
        }
      }
    }
  });

  test('non-drift: premove set adds only permissive moves (exact set on a recapture position)', () => {
    // Rook d1 with friendly pawn d2. The white king sits on e3, off the rook's
    // d-file / rank-1 paths, so the only friendly-occupied candidate is d2.
    // Premove = legal rook moves + d2 (the recapture). Nothing else.
    const b = boardWith({
      '4,2': W_KING,
      '3,0': W_ROOK,
      '3,1': W_PAWN,
      '4,7': B_KING,
    });
    const legal = getValidMoves(b, 3, 0, NO_RIGHTS, null);
    const pre = getPremoveMoves(b, 3, 0, NO_RIGHTS, null);
    const legalKeys = new Set(legal.map((m) => `${m.file},${m.rank}`));
    const extra = pre
      .filter((m) => !legalKeys.has(`${m.file},${m.rank}`))
      .map((m) => `${m.file},${m.rank}`)
      .sort();
    assert.deepStrictEqual(
      extra,
      ['3,1'],
      'the only extra premove candidate must be the d2 recapture'
    );
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
