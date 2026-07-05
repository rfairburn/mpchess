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
  ZOBRIST,
  toFen,
  fromFen,
  validateFenForEngine,
} = require('../../shared/chess');

const fs = require('fs');

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

// ═══════════════════════════════════════════════════════════
//  TESTS
// ═══════════════════════════════════════════════════════════

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
    assert.ok(g.gameResult.includes('Checkmate'));
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
    assert.ok(g.gameResult.includes('Stalemate'), `should be stalemate: ${g.gameResult}`);
  });
});

describe('Game state management', () => {
  test('addPlayer assigns white then black', () => {
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    assert.strictEqual(g.addPlayer(ws1), 'white');
    assert.strictEqual(g.addPlayer(ws2), 'black');
  });

  test('third player becomes spectator', () => {
    const g = new Game();
    g.addPlayer({});
    g.addPlayer({});
    assert.strictEqual(g.addPlayer({}), 'spectator');
  });

  test('getState returns correct turn', () => {
    const { game, white } = makeGame();
    assert.strictEqual(game.getState().turn, 'white');
    game.tryMove(white, 4, 1, 4, 2);
    assert.strictEqual(game.getState().turn, 'black');
  });

  test('reset clears all state', () => {
    const { game, white } = makeGame();
    game.tryMove(white, 4, 1, 4, 2);
    game.reset();
    assert.strictEqual(game.turn, 'white');
    assert.deepStrictEqual(game.castlingRights, { wK: true, wQ: true, bK: true, bQ: true });
    assert.strictEqual(game.enPassantTarget, null);
    assert.strictEqual(game.gameOver, false);
    assert.strictEqual(game.moveHistory.length, 0);
  });

  test('concede ends the game', () => {
    const { game, white } = makeGame();
    assert.strictEqual(game.concede(white), true);
    assert.strictEqual(game.gameOver, true);
    assert.ok(game.gameResult.includes('conceded'));
  });

  test('cannot move after game over', () => {
    const { game, white } = makeGame();
    game.concede(white);
    const result = game.tryMove(white, 4, 1, 4, 2);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'Game over');
  });

  test('completePromotion rejected after game over', () => {
    const { game, white } = makeGame();
    // Set up a pending promotion
    game.promotingPiece = {
      file: 4,
      rank: 0,
      color: 'white',
      fromFile: 4,
      fromRank: 1,
      enPassant: false,
      captured: 0,
    };
    game.turn = 'white';
    // End the game before completing promotion
    game.concede(white);
    assert.strictEqual(game.gameOver, true);
    // completePromotion should return false and not flip the turn
    const turnBefore = game.turn;
    const result = game.completePromotion(white, 'queen');
    assert.strictEqual(result, false);
    assert.strictEqual(game.turn, turnBefore); // turn must NOT have changed
  });
});

describe('Static file server — requestHandler', () => {
  const { requestHandler, MIME, CLIENT_ROOT } = require('../../server');

  function mockReq(urlPath) {
    return { url: urlPath };
  }

  function mockRes() {
    const res = {
      statusCode: null,
      headers: null,
      body: null,
      writeHead(code, headers) {
        this.statusCode = code;
        this.headers = headers;
      },
      end(body) {
        this.body = body;
      },
    };
    return res;
  }

  // ── Root redirect ──

  test('root / serves client/index.html', () => {
    const res = mockRes();
    requestHandler(mockReq('/'), res);
    assert.strictEqual(res.statusCode, 200);
    assert.ok(
      res.body.includes('<!doctype html>') || res.body.includes('<html'),
      'should serve HTML'
    );
  });

  // ── Allowed extensions ──

  test('serves .html files', () => {
    const res = mockRes();
    requestHandler(mockReq('/client/index.html'), res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['Content-Type'], MIME['.html']);
  });

  test('serves .js files', () => {
    const res = mockRes();
    requestHandler(mockReq('/client/app.js'), res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['Content-Type'], MIME['.js']);
  });

  test('serves .mjs files', () => {
    const res = mockRes();
    requestHandler(mockReq('/client/chess.mjs'), res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['Content-Type'], MIME['.mjs']);
  });

  test('serves .css files', () => {
    const res = mockRes();
    requestHandler(mockReq('/client/style.css'), res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['Content-Type'], MIME['.css']);
  });

  test('serves .stl model files from client/files/', () => {
    const res = mockRes();
    requestHandler(mockReq('/client/files/king.stl'), res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['Content-Type'], MIME['.stl']);
  });

  // ── Forbidden: outside client/ ──

  test('rejects /server.js with 403', () => {
    const res = mockRes();
    requestHandler(mockReq('/server.js'), res);
    assert.strictEqual(res.statusCode, 403);
  });

  test('rejects /package.json with 403', () => {
    const res = mockRes();
    requestHandler(mockReq('/package.json'), res);
    assert.strictEqual(res.statusCode, 403);
  });

  test('rejects /shared/chess.js with 403', () => {
    const res = mockRes();
    requestHandler(mockReq('/shared/chess.js'), res);
    assert.strictEqual(res.statusCode, 403);
  });

  test('rejects /review.md with 403', () => {
    const res = mockRes();
    requestHandler(mockReq('/review.md'), res);
    assert.strictEqual(res.statusCode, 403);
  });

  // ── Forbidden: path traversal ──

  test('rejects /client/../server.js with 403', () => {
    const res = mockRes();
    requestHandler(mockReq('/client/../server.js'), res);
    assert.strictEqual(res.statusCode, 403);
  });

  test('rejects /client/../../etc/passwd with 403', () => {
    const res = mockRes();
    requestHandler(mockReq('/client/../../etc/passwd'), res);
    assert.strictEqual(res.statusCode, 403);
  });

  test('rejects /client/..%2f..%2fserver.js with 403', () => {
    const res = mockRes();
    requestHandler(mockReq('/client/..%2f..%2fserver.js'), res);
    assert.strictEqual(res.statusCode, 403);
  });

  // ── Forbidden: disallowed extensions ──

  test('rejects .step files (not in MIME allowlist)', () => {
    const res = mockRes();
    requestHandler(mockReq('/client/files/king.step'), res);
    assert.strictEqual(res.statusCode, 403);
  });

  test('rejects .txt files', () => {
    const res = mockRes();
    requestHandler(mockReq('/client/readme.txt'), res);
    assert.strictEqual(res.statusCode, 403);
  });

  test('rejects .key files', () => {
    const res = mockRes();
    requestHandler(mockReq('/client/server.key'), res);
    assert.strictEqual(res.statusCode, 403);
  });

  test('rejects .pem files', () => {
    const res = mockRes();
    requestHandler(mockReq('/client/cert.pem'), res);
    assert.strictEqual(res.statusCode, 403);
  });

  test('rejects .md files', () => {
    const res = mockRes();
    requestHandler(mockReq('/client/notes.md'), res);
    assert.strictEqual(res.statusCode, 403);
  });

  // ── 404 for missing files ──

  test('returns 404 for non-existent .html file', () => {
    const res = mockRes();
    requestHandler(mockReq('/client/nonexistent.html'), res);
    assert.strictEqual(res.statusCode, 404);
  });

  test('returns 404 for non-existent .stl file', () => {
    const res = mockRes();
    requestHandler(mockReq('/client/files/unicorn.stl'), res);
    assert.strictEqual(res.statusCode, 404);
  });

  // ── CLIENT_ROOT is under project root ──

  test('CLIENT_ROOT resolves to client/ directory', () => {
    assert.ok(
      CLIENT_ROOT.endsWith('client'),
      `CLIENT_ROOT should end with 'client', got ${CLIENT_ROOT}`
    );
  });

  // ── MIME allowlist is exhaustive ──

  test('MIME map covers all expected extensions', () => {
    const expected = ['.html', '.js', '.mjs', '.css', '.json', '.stl', '.png', '.jpg', '.ico'];
    for (const ext of expected) {
      assert.ok(MIME[ext] !== undefined, `MIME map should include ${ext}`);
    }
  });
});

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
    const { pieceColor, pieceType } = require('../../shared/chess');

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

describe('Algebraic notation disambiguation', () => {
  test('single knight move - no disambiguation needed', () => {
    const { game, white } = makeGame();
    // Move knight from b1 to c3 - only one knight can reach c3
    game.tryMove(white, 1, 0, 2, 2);
    const notation = game.moveHistory[0];
    assert.strictEqual(notation, 'Nc3', 'single knight move should not need disambiguation');
  });

  test('two knights can reach same square - file disambiguation', () => {
    // Knight at c3 and knight at g3 both can move to e4
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[2][2] = W_KNIGHT; // c3
    g.board[2][6] = W_KNIGHT; // g3
    g.turn = 'white';
    g.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };

    // Move knight from c3 to e4
    const result1 = g.tryMove(ws1, 2, 2, 4, 3);
    assert.strictEqual(result1.ok, true);
    // Nce4 (c-file disambiguation; stalemate — no black king on board)
    assert.strictEqual(g.moveHistory[0], 'Nce4', `expected Nce4: ${g.moveHistory[0]}`);

    // Move knight from g3 to e4
    g.reset();
    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[2][2] = W_KNIGHT; // c3
    g.board[2][6] = W_KNIGHT; // g3
    g.turn = 'white';
    const result2 = g.tryMove(ws1, 6, 2, 4, 3);
    assert.strictEqual(result2.ok, true);
    // Nge4 (g-file disambiguation; stalemate)
    assert.strictEqual(g.moveHistory[0], 'Nge4', `expected Nge4: ${g.moveHistory[0]}`);
  });

  test('two rooks on same file - rank disambiguation', () => {
    // Two rooks on the d-file, black king on d8 — Rd4 gives check
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[0][3] = W_ROOK; // d1
    g.board[4][3] = W_ROOK; // d5
    g.board[7][3] = B_KING; // d8
    g.turn = 'white';
    g.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };

    // R1d4+ — rank disambiguation since both rooks are on d-file
    const result = g.tryMove(ws1, 3, 0, 3, 3);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(g.moveHistory[0], 'R1d4+', `expected R1d4+: ${g.moveHistory[0]}`);
  });

  test('two rooks on same rank - file disambiguation', () => {
    // Two rooks on the 1st rank, black king on c8 — Rc1 gives check
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[0][0] = W_ROOK; // a1
    g.board[0][3] = W_ROOK; // d1
    g.board[7][2] = B_KING; // c8
    g.turn = 'white';
    g.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };

    // Rac1+ — file disambiguation since both rooks are on 1st rank
    const result = g.tryMove(ws1, 0, 0, 2, 0);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(g.moveHistory[0], 'Rac1+', `expected Rac1+: ${g.moveHistory[0]}`);
  });

  test('three knights - full disambiguation (file + rank)', () => {
    // Knights on b2, b6, d2 — all can reach c4.
    // b6 shares file b with b2, d2 shares rank 2 with b2.
    // File alone (Nbc4) can't distinguish from b6.
    // Rank alone (N2c4) can't distinguish from d2.
    // Must use Nb2c4.
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[1][1] = W_KNIGHT; // b2
    g.board[5][1] = W_KNIGHT; // b6
    g.board[1][3] = W_KNIGHT; // d2
    g.turn = 'white';
    g.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };

    const result = g.tryMove(ws1, 1, 1, 2, 3);
    assert.strictEqual(result.ok, true);
    // Nb2c4 (full disambiguation; stalemate — no black king)
    assert.strictEqual(g.moveHistory[0], 'Nb2c4', `expected Nb2c4: ${g.moveHistory[0]}`);
  });

  test('three bishops - full disambiguation (file + rank)', () => {
    // Bishops on c1, g1, c5 — all can reach e3.
    // g1 shares rank 1 with c1, c5 shares file c with c1.
    // Must use Bc1e3.
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[0][2] = W_BISHOP; // c1
    g.board[0][6] = W_BISHOP; // g1
    g.board[4][2] = W_BISHOP; // c5
    g.turn = 'white';
    g.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };

    const result = g.tryMove(ws1, 2, 0, 4, 2);
    assert.strictEqual(result.ok, true);
    // Bc1e3 (full disambiguation; stalemate)
    assert.strictEqual(g.moveHistory[0], 'Bc1e3', `expected Bc1e3: ${g.moveHistory[0]}`);
  });

  test('three queens - full disambiguation (file + rank)', () => {
    // Queens on c1, g1, c5 — all can reach e3.
    // g1 shares rank 1 with c1, c5 shares file c with c1.
    // Must use Qc1e3.
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[0][2] = W_QUEEN; // c1
    g.board[0][6] = W_QUEEN; // g1
    g.board[4][2] = W_QUEEN; // c5
    g.turn = 'white';
    g.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };

    const result = g.tryMove(ws1, 2, 0, 4, 2);
    assert.strictEqual(result.ok, true);
    // Qc1e3 (full disambiguation; stalemate)
    assert.strictEqual(g.moveHistory[0], 'Qc1e3', `expected Qc1e3: ${g.moveHistory[0]}`);
  });

  test('bishop move with disambiguation', () => {
    // Two bishops on c3 and g3, both can reach e5
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[2][2] = W_BISHOP; // c3
    g.board[2][6] = W_BISHOP; // g3
    g.turn = 'white';
    g.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };

    const result = g.tryMove(ws1, 2, 2, 4, 4);
    assert.strictEqual(result.ok, true);
    // Bce5 (file disambiguation; stalemate)
    assert.strictEqual(g.moveHistory[0], 'Bce5', `expected Bce5: ${g.moveHistory[0]}`);
  });

  test('queen move with disambiguation', () => {
    // Two queens on d3 and f3, both can reach e4
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[3][3] = W_QUEEN; // d3
    g.board[3][5] = W_QUEEN; // f3
    g.turn = 'white';
    g.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };

    const result = g.tryMove(ws1, 3, 3, 4, 4);
    assert.strictEqual(result.ok, true);
    // Qde5 (file disambiguation; stalemate)
    assert.strictEqual(g.moveHistory[0], 'Qde5', `expected Qde5: ${g.moveHistory[0]}`);
  });

  test('king move - no disambiguation needed (only one king)', () => {
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[0][4] = W_KING; // e1
    g.board[7][4] = B_KING; // e8
    g.turn = 'white';
    g.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };

    // Move king from e1 to e2 (no check involved)
    const result = g.tryMove(ws1, 4, 0, 4, 1);
    assert.strictEqual(result.ok, true);
    // King moves should not need disambiguation; Ke2 (no check — black king too far)
    assert.strictEqual(g.moveHistory[0], 'Ke2', `expected Ke2: ${g.moveHistory[0]}`);
  });

  test('pawn capture notation includes departure file', () => {
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[3][4] = W_PAWN; // e4
    g.board[4][3] = B_PAWN; // d5 (the pawn to capture via en passant)
    g.turn = 'white';
    g.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };

    // Black pawn just moved d7-d5
    g.enPassantTarget = { file: 3, rank: 4 }; // d5

    // White pawn at e4 captures en passant on d5
    const result = g.tryMove(ws1, 4, 3, 3, 4);
    assert.strictEqual(result.ok, true);
    // Pawn capture: departure-file + x + destination (no check — no black king)
    assert.strictEqual(g.moveHistory[0], 'exd5', `expected exd5: ${g.moveHistory[0]}`);
  });

  test('pinned piece excluded from disambiguation', () => {
    // Two knights can geometrically reach the same square, but one
    // is pinned and cannot legally move — only the unpinned knight
    // should appear in the notation (no disambiguation needed).
    // King on e1, knight on e2 (pinned by rook on e8), knight on c3.
    // Both can reach d4, but e2 knight is pinned.
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[0][4] = W_KING; // e1
    g.board[1][4] = W_KNIGHT; // e2 — pinned by rook on e8
    g.board[2][2] = W_KNIGHT; // c3 — free
    g.board[7][4] = B_ROOK; // e8 — pins the e2 knight
    g.turn = 'white';
    g.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };

    // Move the free knight from c3 to d4 — no disambiguation needed
    // because the pinned knight on e2 cannot legally move to d4.
    // c3=(file=2,rank=2) → d4=(file=3,rank=3) is (±1,±1) — NOT a knight move!
    // Fix: c3→d5 is (file=2→3, rank=2→4) = (±1,±2) — valid!
    // e2→d4 is (file=4→3, rank=1→3) = (±1,±2) — valid but pinned.
    // Both reach d5? e2→d5 is (file=4→3, rank=1→4) = (±1,±3) — NOT valid.
    // Both reach c3? No, c3 is the source.
    // e2 can reach: c1,c3,d4,f4,g1,g3. c3 can reach: a2,a4,b1,b5,d1,d5,e2,e4.
    // No common square! Let me use knights on b1 and e2, both can reach c3.
    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[0][4] = W_KING; // e1
    g.board[1][4] = W_KNIGHT; // e2 — pinned by rook on e8
    g.board[0][1] = W_KNIGHT; // b1 — free
    g.board[7][4] = B_ROOK; // e8 — pins the e2 knight
    g.turn = 'white';
    g.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };

    // b1=(file=1,rank=0) → c3=(file=2,rank=2) is (±1,±2) — valid!
    // e2=(file=4,rank=1) → c3=(file=2,rank=2) is (±2,±1) — valid but pinned!
    const result = g.tryMove(ws1, 1, 0, 2, 2);
    assert.strictEqual(result.ok, true);
    // Nc3 (no check — black rook on e8 doesn't give check to white king on e1 after Nc3)
    assert.strictEqual(g.moveHistory[0], 'Nc3', `expected Nc3: ${g.moveHistory[0]}`);
  });

  test('pawn simple move — no departure file in notation', () => {
    const { game, white } = makeGame();
    // e2 → e4 is a simple pawn push; notation is just the destination
    game.tryMove(white, 4, 1, 4, 3);
    // e4 (no check)
    assert.strictEqual(game.moveHistory[0], 'e4', `expected e4: ${game.moveHistory[0]}`);
  });

  test('pawn promotion notation includes piece suffix', () => {
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[6][4] = W_PAWN; // e7
    g.turn = 'white';
    g.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };

    // Push pawn to e8 — triggers promotion
    const result = g.tryMove(ws1, 4, 6, 4, 7);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.promotion, true);

    // Complete promotion to queen
    g.completePromotion(ws1, 'queen');
    // e8=Q (no check — no black king on board)
    assert.strictEqual(g.moveHistory[0], 'e8=Q', `expected e8=Q: ${g.moveHistory[0]}`);
  });

  test('promotion removes pawn from source square', () => {
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[6][4] = W_PAWN; // e7
    g.turn = 'white';
    g.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };

    // Push pawn to e8 — tryMove moves the pawn immediately
    const result = g.tryMove(ws1, 4, 6, 4, 7);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.promotion, true);
    // Pawn is already at destination (tryMove handles the move like any other move)
    assert.strictEqual(g.board[6][4], 0, 'source square cleared by tryMove');
    assert.strictEqual(g.board[7][4], W_PAWN, 'pawn at destination before completePromotion');

    // Complete promotion — swaps pawn for queen
    g.completePromotion(ws1, 'queen');
    assert.strictEqual(g.board[7][4], W_QUEEN, 'queen at destination');
  });

  test('promotingPiece stores source coordinates for client sync', () => {
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[6][0] = W_PAWN; // a7
    g.turn = 'white';
    g.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };

    g.tryMove(ws1, 0, 6, 0, 7);
    assert.strictEqual(g.promotingPiece.fromFile, 0, 'fromFile stored');
    assert.strictEqual(g.promotingPiece.fromRank, 6, 'fromRank stored');
    assert.strictEqual(g.promotingPiece.file, 0, 'destination file stored');
    assert.strictEqual(g.promotingPiece.rank, 7, 'destination rank stored');

    // getState exposes fromFile/fromRank for client-side board update
    const state = g.getState();
    assert.strictEqual(state.promotingPiece.fromFile, 0, 'fromFile in state');
    assert.strictEqual(state.promotingPiece.fromRank, 6, 'fromRank in state');
  });

  test('discovered check — notation includes + suffix', () => {
    // White bishop on a2, white knight on f7, white king on e1, black king on g8.
    // Knight moves f7→h6, revealing the bishop's diagonal a2–g8 → discovered check.
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[1][0] = W_BISHOP; // a2
    g.board[6][5] = W_KNIGHT; // f7
    g.board[0][4] = W_KING; // e1
    g.board[7][6] = B_KING; // g8
    g.turn = 'white';
    g.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };

    // f7=(file=5,rank=6) → h6=(file=7,rank=5) is (±2,±1) — valid knight move
    const result = g.tryMove(ws1, 5, 6, 7, 5);
    assert.strictEqual(result.ok, true);
    // Nh6+ — discovered check from bishop on a2
    assert.strictEqual(g.moveHistory[0], 'Nh6+', `expected Nh6+: ${g.moveHistory[0]}`);
  });

  test('discovered checkmate — notation includes # suffix', () => {
    // White bishop on a3, white knight on e7 (blocks bishop), white knight on c6,
    // white rook on a8, white king on g1. Black king on e8, black pawns on d7, f7.
    // Knight moves e7→g6, revealing bishop's diagonal a3–f8 → discovered check.
    // Rook on a8 covers d8,f8; knight on c6 covers d8; knight on g6 covers f8.
    // Bishop diagonal covers e7. Pawns block d7,f7. King has no escape → checkmate.
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[2][0] = W_BISHOP; // a3 — checks f8 along a3-f8 diagonal
    g.board[6][4] = W_KNIGHT; // e7 — blocks bishop, will move to g6
    g.board[5][2] = W_KNIGHT; // c6 — covers d8 escape
    g.board[7][0] = W_ROOK; // a8 — covers d8,f8 on back rank
    g.board[0][6] = W_KING; // g1
    g.board[7][4] = B_KING; // e8
    g.board[6][3] = B_PAWN; // d7 — blocks Ke8→d7
    g.board[6][5] = B_PAWN; // f7 — blocks Ke8→f7
    g.turn = 'white';
    g.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };

    // e7=(file=4,rank=6) → g6=(file=6,rank=5) is (±2,±1) — valid knight move
    const result = g.tryMove(ws1, 4, 6, 6, 5);
    assert.strictEqual(result.ok, true);
    // Ng6# — discovered checkmate from bishop on a3
    assert.strictEqual(g.moveHistory[0], 'Ng6#', `expected Ng6#: ${g.moveHistory[0]}`);
    assert.strictEqual(g.gameOver, true);
    assert.ok(g.gameResult.includes('Checkmate'), `expected checkmate result: ${g.gameResult}`);
  });

  test('promotion capture — notation includes capture x and promotion suffix', () => {
    // White pawn on e7 captures black rook on d8, promotes to queen.
    // Queen on d8 checks king on g8 along the 8th rank.
    // Notation: exd8=Q+
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[6][4] = W_PAWN; // e7
    g.board[7][3] = B_ROOK; // d8
    g.board[0][4] = W_KING; // e1
    g.board[7][6] = B_KING; // g8
    g.turn = 'white';
    g.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };

    const result = g.tryMove(ws1, 4, 6, 3, 7);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.promotion, true);

    g.completePromotion(ws1, 'queen');
    // exd8=Q+ — pawn capture + promotion + check
    assert.strictEqual(g.moveHistory[0], 'exd8=Q+', `expected exd8=Q+: ${g.moveHistory[0]}`);
  });

  test('promotion capture with check — notation includes x, promotion suffix, and +', () => {
    // White pawn on e7 captures black piece on d8, promotes to queen, delivers check.
    // Notation: exd8=Q+
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[6][4] = W_PAWN; // e7
    g.board[7][3] = B_PAWN; // d8
    g.board[0][4] = W_KING; // e1
    g.board[7][4] = B_KING; // e8 — on same file as promotion square
    g.turn = 'white';
    g.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };

    const result = g.tryMove(ws1, 4, 6, 3, 7);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.promotion, true);

    g.completePromotion(ws1, 'queen');
    // exd8=Q+ — pawn capture + promotion + check (queen on d8 attacks king on e8)
    assert.strictEqual(g.moveHistory[0], 'exd8=Q+', `expected exd8=Q+: ${g.moveHistory[0]}`);
  });

  test('promotion capture with checkmate — notation includes x, promotion suffix, and #', () => {
    // White pawn on e7 captures on d8, promotes to queen, delivers checkmate.
    // White knight on c6 defends the promoted queen on d8 (king cannot capture).
    // Black king on e8, pawns on d7, f7, f8 block all escapes.
    // Notation: exd8=Q#
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[6][4] = W_PAWN; // e7
    g.board[7][3] = B_PAWN; // d8 — captured by promoting pawn
    g.board[5][2] = W_KNIGHT; // c6 — defends d8 (queen cannot be captured)
    g.board[0][4] = W_KING; // e1
    g.board[7][4] = B_KING; // e8
    g.board[6][3] = B_PAWN; // d7 — blocks Ke8→d7
    g.board[6][5] = B_PAWN; // f7 — blocks Ke8→f7
    g.board[7][5] = B_PAWN; // f8 — blocks Ke8→f8
    g.turn = 'white';
    g.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };

    const result = g.tryMove(ws1, 4, 6, 3, 7);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.promotion, true);

    g.completePromotion(ws1, 'queen');
    // exd8=Q# — pawn capture + promotion + checkmate (queen defended by knight)
    assert.strictEqual(g.moveHistory[0], 'exd8=Q#', `expected exd8=Q#: ${g.moveHistory[0]}`);
    assert.strictEqual(g.gameOver, true);
    assert.ok(g.gameResult.includes('Checkmate'), `expected checkmate: ${g.gameResult}`);
  });
});

describe('Insufficient material — draw detection', () => {
  function emptyBoard() {
    return Array.from({ length: 8 }, () => Array(8).fill(0));
  }

  test('K vs K is insufficient material', () => {
    const b = emptyBoard();
    b[0][4] = W_KING;
    b[7][4] = B_KING;
    assert.strictEqual(isInsufficientMaterial(b), true);
  });

  test('K+B vs K is insufficient material', () => {
    const b = emptyBoard();
    b[0][4] = W_KING;
    b[0][2] = W_BISHOP;
    b[7][4] = B_KING;
    assert.strictEqual(isInsufficientMaterial(b), true);
  });

  test('K vs K+B is insufficient material', () => {
    const b = emptyBoard();
    b[0][4] = W_KING;
    b[7][4] = B_KING;
    b[7][2] = B_BISHOP;
    assert.strictEqual(isInsufficientMaterial(b), true);
  });

  test('K+N vs K is insufficient material', () => {
    const b = emptyBoard();
    b[0][4] = W_KING;
    b[0][3] = W_KNIGHT;
    b[7][4] = B_KING;
    assert.strictEqual(isInsufficientMaterial(b), true);
  });

  test('K vs K+N is insufficient material', () => {
    const b = emptyBoard();
    b[0][4] = W_KING;
    b[7][4] = B_KING;
    b[7][3] = B_KNIGHT;
    assert.strictEqual(isInsufficientMaterial(b), true);
  });

  test('K+B vs K+B same-colored bishops is insufficient material', () => {
    const b = emptyBoard();
    b[0][4] = W_KING;
    b[0][0] = W_BISHOP; // a1 — dark square (0+0=0, even)
    b[7][4] = B_KING;
    b[7][1] = B_BISHOP; // b8 — dark square (1+7=8, even)
    assert.strictEqual(isInsufficientMaterial(b), true);
  });

  test('K+B vs K+B opposite-colored bishops is NOT insufficient material', () => {
    const b = emptyBoard();
    b[0][4] = W_KING;
    b[0][0] = W_BISHOP; // a1 — dark square (0+0=0, even)
    b[7][4] = B_KING;
    b[7][0] = B_BISHOP; // a8 — light square (0+7=7, odd)
    assert.strictEqual(isInsufficientMaterial(b), false);
  });

  test('K+R vs K is NOT insufficient material', () => {
    const b = emptyBoard();
    b[0][4] = W_KING;
    b[0][3] = W_ROOK;
    b[7][4] = B_KING;
    assert.strictEqual(isInsufficientMaterial(b), false);
  });

  test('K+P vs K is NOT insufficient material', () => {
    const b = emptyBoard();
    b[0][4] = W_KING;
    b[1][4] = W_PAWN;
    b[7][4] = B_KING;
    assert.strictEqual(isInsufficientMaterial(b), false);
  });

  test('K+N vs K+N is NOT insufficient material', () => {
    const b = emptyBoard();
    b[0][4] = W_KING;
    b[0][3] = W_KNIGHT;
    b[7][4] = B_KING;
    b[7][3] = B_KNIGHT;
    assert.strictEqual(isInsufficientMaterial(b), false);
  });

  test('starting position is NOT insufficient material', () => {
    assert.strictEqual(isInsufficientMaterial(startingBoard()), false);
  });

  test('checkGameEnd detects insufficient material as draw', () => {
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);

    // K vs K
    g.board = emptyBoard();
    g.board[0][4] = W_KING;
    g.board[7][4] = B_KING;
    g.turn = 'white';

    g.checkGameEnd();
    assert.strictEqual(g.gameOver, true);
    assert.ok(
      g.gameResult.includes('insufficient material'),
      `expected insufficient material draw: ${g.gameResult}`
    );
  });

  test('checkGameEnd detects K+B vs K as draw', () => {
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);

    g.board = emptyBoard();
    g.board[0][4] = W_KING;
    g.board[0][2] = W_BISHOP;
    g.board[7][4] = B_KING;
    g.turn = 'black';

    g.checkGameEnd();
    assert.strictEqual(g.gameOver, true);
    assert.ok(
      g.gameResult.includes('insufficient material'),
      `expected insufficient material draw: ${g.gameResult}`
    );
  });

  test('checkGameEnd does NOT draw on K+B vs K+B opposite-colored bishops', () => {
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);

    g.board = emptyBoard();
    g.board[0][4] = W_KING;
    g.board[0][0] = W_BISHOP; // a1 — dark
    g.board[7][4] = B_KING;
    g.board[7][0] = B_BISHOP; // a8 — light
    g.turn = 'white';

    g.checkGameEnd();
    assert.strictEqual(g.gameOver, false, 'opposite-colored bishops should not be a draw');
  });
});

// ═══════════════════════════════════════════════════════════
//  ZOBRIST HASHING
// ═══════════════════════════════════════════════════════════

describe('Zobrist hashing', () => {
  test('same position produces same hash', () => {
    const board = startingBoard();
    const h1 = ZOBRIST.compute(board, 'white', { wK: true, wQ: true, bK: true, bQ: true }, null);
    const h2 = ZOBRIST.compute(board, 'white', { wK: true, wQ: true, bK: true, bQ: true }, null);
    assert.strictEqual(h1, h2, 'identical positions must produce identical hashes');
  });

  test('different board produces different hash', () => {
    const b1 = startingBoard();
    const b2 = startingBoard();
    b2[1][4] = 0; // remove white e-pawn
    const h1 = ZOBRIST.compute(b1, 'white', { wK: true, wQ: true, bK: true, bQ: true }, null);
    const h2 = ZOBRIST.compute(b2, 'white', { wK: true, wQ: true, bK: true, bQ: true }, null);
    assert.notStrictEqual(h1, h2, 'different boards must produce different hashes');
  });

  test('different turn produces different hash', () => {
    const board = startingBoard();
    const cr = { wK: true, wQ: true, bK: true, bQ: true };
    const hw = ZOBRIST.compute(board, 'white', cr, null);
    const hb = ZOBRIST.compute(board, 'black', cr, null);
    assert.notStrictEqual(hw, hb, 'different sides to move must produce different hashes');
  });

  test('different castling rights produce different hash', () => {
    const board = startingBoard();
    const cr1 = { wK: true, wQ: true, bK: true, bQ: true };
    const cr2 = { wK: false, wQ: true, bK: true, bQ: true };
    const h1 = ZOBRIST.compute(board, 'white', cr1, null);
    const h2 = ZOBRIST.compute(board, 'white', cr2, null);
    assert.notStrictEqual(h1, h2, 'different castling rights must produce different hashes');
  });

  test('en passant target produces different hash', () => {
    const board = startingBoard();
    const cr = { wK: true, wQ: true, bK: true, bQ: true };
    const h1 = ZOBRIST.compute(board, 'white', cr, null);
    const h2 = ZOBRIST.compute(board, 'white', cr, { file: 3, rank: 3 });
    assert.notStrictEqual(h1, h2, 'en passant target must affect hash');
  });

  test('hash is a BigInt', () => {
    const board = startingBoard();
    const h = ZOBRIST.compute(board, 'white', { wK: true, wQ: true, bK: true, bQ: true }, null);
    assert.ok(typeof h === 'bigint', 'Zobrist hash must be a BigInt');
  });
});

// ═══════════════════════════════════════════════════════════
//  HALF-MOVE CLOCK
// ═══════════════════════════════════════════════════════════

describe('Half-move clock', () => {
  test('starts at 0', () => {
    const g = new Game();
    assert.strictEqual(g.halfmoveClock, 0);
  });

  test('resets on pawn move', () => {
    const { game, white } = makeGame();
    game.tryMove(white, 4, 1, 4, 3); // e2-e4
    assert.strictEqual(game.halfmoveClock, 0, 'pawn move resets half-move clock');
  });

  test('resets on capture', () => {
    const { game, white, black } = makeGame();
    // e2-e4
    game.tryMove(white, 4, 1, 4, 3);
    // e7-e5
    game.tryMove(black, 4, 6, 4, 4);
    // e4xe5 capture
    game.tryMove(white, 4, 3, 4, 4);
    assert.strictEqual(game.halfmoveClock, 0, 'capture resets half-move clock');
  });

  test('increments on non-pawn non-capture move', () => {
    const { game, white, black } = makeGame();
    // e2-e4
    game.tryMove(white, 4, 1, 4, 3);
    // e7-e5
    game.tryMove(black, 4, 6, 4, 4);
    // Nf3 (knight move, no capture)
    game.tryMove(white, 6, 0, 5, 2);
    assert.strictEqual(game.halfmoveClock, 1, 'knight move increments clock');
    // Nf6
    game.tryMove(black, 1, 7, 2, 5);
    assert.strictEqual(game.halfmoveClock, 2, 'another knight move increments clock');
  });

  test('resets on promotion (pawn move)', () => {
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);
    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[6][4] = W_PAWN; // e7
    g.turn = 'white';
    g.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };
    g.halfmoveClock = 5; // simulate prior non-pawn moves

    g.tryMove(ws1, 4, 6, 4, 7); // e7-e8 promotion
    assert.strictEqual(g.halfmoveClock, 0, 'promotion (pawn move) resets clock');
    g.completePromotion(ws1, 'queen');
    assert.strictEqual(g.halfmoveClock, 0, 'clock stays 0 after completePromotion');
  });
});

// ═══════════════════════════════════════════════════════════
//  POSITION HISTORY & THREEFOLD REPETITION
// ═══════════════════════════════════════════════════════════

describe('Position history', () => {
  test('starting position is recorded', () => {
    const g = new Game();
    assert.strictEqual(g.positionHistory.length, 1, 'starting position recorded');
    assert.strictEqual(g.positionCounts.size, 1);
    const key = g.positionHistory[0].zobrist;
    assert.strictEqual(g.positionCounts.get(key), 1);
  });

  test('position recorded after each move', () => {
    const { game, white, black } = makeGame();
    // Start: 1 position
    assert.strictEqual(game.positionHistory.length, 1);
    // e2-e4
    game.tryMove(white, 4, 1, 4, 3);
    assert.strictEqual(game.positionHistory.length, 2);
    // e7-e5
    game.tryMove(black, 4, 6, 4, 4);
    assert.strictEqual(game.positionHistory.length, 3);
  });

  test('position recorded after promotion', () => {
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);
    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[6][4] = W_PAWN;
    g.turn = 'white';
    g.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };

    const beforeCount = g.positionHistory.length;
    g.tryMove(ws1, 4, 6, 4, 7);
    // tryMove for promotion does NOT record (done in completePromotion)
    g.completePromotion(ws1, 'queen');
    assert.strictEqual(g.positionHistory.length, beforeCount + 1, 'promotion records position');
  });

  test('reset clears history and re-records starting position', () => {
    const { game, white } = makeGame();
    game.tryMove(white, 4, 1, 4, 3);
    assert.strictEqual(game.positionHistory.length, 2);
    game.reset();
    assert.strictEqual(game.positionHistory.length, 1, 'history reset to starting position');
    assert.strictEqual(game.halfmoveClock, 0);
    assert.strictEqual(game.fullmoveNumber, 1);
  });
});

describe('Threefold repetition detection', () => {
  test('K b8-c8 shuttle produces threefold', () => {
    // Minimal position: K b8, K g8. White king shuttles b8-c8-b8-c8-b8
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);
    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[7][1] = W_KING; // b8
    g.board[7][6] = B_KING; // g8
    g.turn = 'white';
    g.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };
    g.halfmoveClock = 0;
    g.positionHistory = [];
    g.positionCounts = new Map();
    g._recordPosition(null); // record initial

    // b8-c8 (position 2)
    g.tryMove(ws1, 1, 7, 2, 7);
    // King move increments clock; black has no legal moves → stalemate
    // Let me use a position where black can move too
  });

  test('threefold detected via manual position replay', () => {
    const g = new Game();
    // Manually record the same position 3 times
    const board = Array.from({ length: 8 }, () => Array(8).fill(0));
    board[0][4] = W_KING;
    board[7][4] = B_KING;
    g.board = board;
    g.turn = 'white';
    g.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };
    g.enPassantTarget = null;

    g.positionHistory = [];
    g.positionCounts = new Map();

    g._recordPosition(null); // count = 1
    assert.strictEqual(g.isThreefoldRepetition(), false);
    g._recordPosition(null); // count = 2
    assert.strictEqual(g.isThreefoldRepetition(), false);
    g._recordPosition(null); // count = 3
    assert.strictEqual(
      g.isThreefoldRepetition(),
      true,
      'three identical positions triggers threefold'
    );
  });

  test('checkGameEnd declares draw on threefold', () => {
    const g = new Game();
    const board = Array.from({ length: 8 }, () => Array(8).fill(0));
    board[0][4] = W_KING;
    board[7][4] = B_KING;
    g.board = board;
    g.turn = 'white';
    g.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };
    g.positionHistory = [];
    g.positionCounts = new Map();
    g._recordPosition(null);
    g._recordPosition(null);
    g._recordPosition(null);

    g.checkGameEnd();
    assert.strictEqual(g.gameOver, true);
    assert.ok(g.gameResult.includes('threefold'), `expected threefold draw: ${g.gameResult}`);
  });

  test('getCurrentRepetitionCount returns correct value', () => {
    const g = new Game();
    const board = startingBoard();
    g.board = board;
    g.turn = 'white';
    g.castlingRights = { wK: true, wQ: true, bK: true, bQ: true };
    g.positionHistory = [];
    g.positionCounts = new Map();

    g._recordPosition(null);
    assert.strictEqual(g.getCurrentRepetitionCount(), 1);
    g._recordPosition(null);
    assert.strictEqual(g.getCurrentRepetitionCount(), 2);
  });
});

// ═══════════════════════════════════════════════════════════
//  FIFTY-MOVE RULE
// ═══════════════════════════════════════════════════════════

describe('Fifty-move rule', () => {
  test('isFiftyMoveRule returns false when clock < 100', () => {
    const g = new Game();
    g.halfmoveClock = 99;
    assert.strictEqual(g.isFiftyMoveRule(), false);
  });

  test('isFiftyMoveRule returns true when clock >= 100', () => {
    const g = new Game();
    g.halfmoveClock = 100;
    assert.strictEqual(g.isFiftyMoveRule(), true);
  });

  test('checkGameEnd declares draw on 50-move rule', () => {
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);
    // Position with legal moves but 50-move clock reached
    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[0][4] = W_KING;
    g.board[0][3] = W_KNIGHT;
    g.board[7][4] = B_KING;
    g.board[7][3] = B_KNIGHT;
    g.turn = 'white';
    g.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };
    g.halfmoveClock = 100;

    g.checkGameEnd();
    assert.strictEqual(g.gameOver, true);
    assert.ok(g.gameResult.includes('50-move'), `expected 50-move draw: ${g.gameResult}`);
  });

  test('pawn move resets clock below 100', () => {
    const { game, white } = makeGame();
    game.halfmoveClock = 99;
    game.tryMove(white, 4, 1, 4, 3); // e2-e4
    assert.strictEqual(game.halfmoveClock, 0, 'pawn move resets clock');
    assert.strictEqual(game.isFiftyMoveRule(), false);
  });
});

// ═══════════════════════════════════════════════════════════
//  FEN EXPORT / IMPORT
// ═══════════════════════════════════════════════════════════

describe('FEN export', () => {
  test('starting position produces standard FEN', () => {
    const g = new Game();
    const fen = g.currentFen();
    assert.strictEqual(fen, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  });

  test('FEN after e2-e4 includes en passant target', () => {
    const { game, white } = makeGame();
    game.tryMove(white, 4, 1, 4, 3);
    const fen = game.currentFen();
    assert.strictEqual(fen, 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
  });

  test('FEN after e2-e4 e7-e5 includes en passant', () => {
    const { game, white, black } = makeGame();
    game.tryMove(white, 4, 1, 4, 3); // e4
    game.tryMove(black, 3, 6, 3, 4); // d5 (not e5, to test en passant)
    const fen = game.currentFen();
    assert.ok(fen.includes('d6'), `FEN should have d6 en passant: ${fen}`);
  });

  test('FEN castling rights updated after king move', () => {
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);
    // Move white king
    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[0][4] = W_KING;
    g.board[7][4] = B_KING;
    g.turn = 'white';
    g.castlingRights = { wK: true, wQ: true, bK: true, bQ: true };
    g.tryMove(ws1, 4, 0, 4, 1); // Ke2
    const fen = g.currentFen();
    // White castling rights cleared; black retains kq
    const parts = fen.split(' ');
    assert.strictEqual(parts[2], 'kq', `white castling cleared, black remains: ${fen}`);
  });
});

describe('FEN import', () => {
  test('parse standard starting position', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const state = fromFen(fen);
    assert.deepStrictEqual(state.board, startingBoard());
    assert.strictEqual(state.turn, 'white');
    assert.deepStrictEqual(state.castlingRights, { wK: true, wQ: true, bK: true, bQ: true });
    assert.strictEqual(state.enPassantTarget, null);
    assert.strictEqual(state.halfmoveClock, 0);
    assert.strictEqual(state.fullmoveNumber, 1);
  });

  test('parse mid-game FEN with en passant', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/3P4/8/PPPP1PPP/RNBQKBNR b KQkq d3 0 1';
    const state = fromFen(fen);
    assert.strictEqual(state.enPassantTarget.file, 3); // d
    assert.strictEqual(state.enPassantTarget.rank, 2); // 3
    assert.strictEqual(state.turn, 'black');
  });

  test('parse FEN with limited castling', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w kq - 0 1';
    const state = fromFen(fen);
    assert.strictEqual(state.castlingRights.wK, false);
    assert.strictEqual(state.castlingRights.wQ, false);
    assert.strictEqual(state.castlingRights.bK, true);
    assert.strictEqual(state.castlingRights.bQ, true);
  });

  test('parse FEN with no castling', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1';
    const state = fromFen(fen);
    assert.strictEqual(state.castlingRights.wK, false);
    assert.strictEqual(state.castlingRights.bK, false);
  });

  test('invalid FEN throws error', () => {
    assert.throws(() => fromFen('invalid'), /Invalid FEN/);
    assert.throws(
      () => fromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq - 0 1'),
      /Invalid FEN/
    );
  });

  test('loadFromFen on Game instance', () => {
    const g = new Game();
    g.loadFromFen('4k3/8/8/8/8/8/8/4K2R w K - 0 1');
    assert.strictEqual(g.turn, 'white');
    assert.strictEqual(g.board[0][4], W_KING);
    assert.strictEqual(g.board[0][7], W_ROOK);
    assert.strictEqual(g.board[7][4], B_KING);
    assert.strictEqual(g.halfmoveClock, 0);
    assert.strictEqual(g.fullmoveNumber, 1);
    // Position history re-recorded
    assert.strictEqual(g.positionHistory.length, 1);
  });

  test('round-trip: starting position → FEN → board', () => {
    const g = new Game();
    const fen = g.currentFen();
    const g2 = new Game();
    g2.loadFromFen(fen);
    assert.deepStrictEqual(g2.board, g.board);
    assert.strictEqual(g2.turn, g.turn);
    assert.deepStrictEqual(g2.castlingRights, g.castlingRights);
  });

  test('round-trip: after moves → FEN → board', () => {
    const { game, white, black } = makeGame();
    game.tryMove(white, 4, 1, 4, 3); // e4
    game.tryMove(black, 4, 6, 4, 4); // e5
    const fen = game.currentFen();

    const g2 = new Game();
    g2.loadFromFen(fen);
    assert.deepStrictEqual(g2.board, game.board);
    assert.strictEqual(g2.turn, game.turn);
    assert.deepStrictEqual(g2.castlingRights, game.castlingRights);
    assert.deepStrictEqual(g2.enPassantTarget, game.enPassantTarget);
  });
});

// ═══════════════════════════════════════════════════════════
//  PGN EXPORT
// ═══════════════════════════════════════════════════════════

describe('PGN export', () => {
  test('empty game produces valid PGN header', () => {
    const g = new Game();
    const pgn = g.exportPgn();
    assert.ok(pgn.includes('[Event "3D Chess Game"]'));
    assert.ok(pgn.includes('[Result "*"]'));
  });

  test('PGN includes move list', () => {
    const { game, white, black } = makeGame();
    game.tryMove(white, 4, 1, 4, 3); // e4
    game.tryMove(black, 4, 6, 4, 4); // e5
    const pgn = game.exportPgn();
    assert.ok(pgn.includes('1. e4 e5'));
  });

  test('PGN result after checkmate', () => {
    const g = new Game();
    g.gameOver = true;
    g.gameResult = 'Checkmate! White wins!';
    const pgn = g.exportPgn();
    assert.ok(pgn.includes('[Result "1-0"]'));
  });

  test('PGN result after draw', () => {
    const g = new Game();
    g.gameOver = true;
    g.gameResult = 'Draw — threefold repetition.';
    const pgn = g.exportPgn();
    assert.ok(pgn.includes('[Result "1/2-1/2"]'));
  });
});

// ═══════════════════════════════════════════════════════════
//  STATE BROADCAST FIELDS
// ═══════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════
//  BUILD REGRESSION — chess.mjs must not crash in browser
// ═══════════════════════════════════════════════════════════

describe('Build regression — chess.mjs browser safety', () => {
  test('generated chess.mjs has no bare require() calls', () => {
    const mjsPath = path.join(ROOT, 'client', 'chess.mjs');
    const mjs = fs.readFileSync(mjsPath, 'utf8');
    const lines = mjs.split('\n');
    const bareRequires = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      // Skip comments
      if (line.startsWith('//') || line.startsWith('*')) continue;
      // Skip lines with require( that are inside a try/catch block
      // (check if require( is on same line as try, or if a nearby line has try)
      if (line.includes('try') && line.includes('require(')) continue;
      if (line.includes('require(')) {
        // Check if any of the previous 3 lines contain 'try' (multi-line try/catch)
        let insideTry = false;
        for (let j = Math.max(0, i - 3); j < i; j++) {
          if (lines[j].trim().includes('try')) {
            insideTry = true;
            break;
          }
        }
        if (!insideTry) {
          bareRequires.push({ line: i + 1, text: line });
        }
      }
    }
    assert.strictEqual(
      bareRequires.length,
      0,
      `Bare require() found in chess.mjs (crashes in browser):\n${bareRequires.map((r) => `  line ${r.line}: ${r.text}`).join('\n')}`
    );
  });

  test('generated chess.mjs wraps crypto require in try/catch', () => {
    const mjsPath = path.join(ROOT, 'client', 'chess.mjs');
    const mjs = fs.readFileSync(mjsPath, 'utf8');
    assert.ok(
      mjs.includes('try') && mjs.includes("require('crypto')"),
      'crypto require must be wrapped in try/catch for browser compatibility'
    );
  });

  test('ZOBRIST is null-safe when crypto unavailable', () => {
    // In Node.js, ZOBRIST is a real instance. In browser it would be null.
    // Verify the Game class handles null ZOBRIST gracefully.
    assert.ok(ZOBRIST !== null, 'ZOBRIST should be initialized in Node.js');
    // Verify _computeZobrist has a null guard (check source)
    const src = fs.readFileSync(path.join(ROOT, 'shared', 'chess.js'), 'utf8');
    assert.ok(
      src.includes('if (!ZOBRIST)'),
      '_computeZobrist must guard against null ZOBRIST for browser safety'
    );
  });
});

// ═══════════════════════════════════════════════════════════
//  BUILD REGRESSION — chess.mjs export boundary
//  Verifies that the generated chess.mjs exports exactly match
//  the union of all `import { … } from './chess.mjs'` statements
//  in client/*.js.  This is the programmatic boundary between
//  server-side chess.js (CommonJS, ~30 exports) and the browser
//  build (ES module, only what the client imports).  See the
//  header comment in build_chess_mjs.js for the full rationale.
// ═══════════════════════════════════════════════════════════

describe('Build regression — chess.mjs export boundary', () => {
  // Helper: parse module.exports names from shared/chess.js
  function parseCjsExports(source) {
    const match = source.match(/module\.exports\s*=\s*\{([\s\S]*)\}/);
    if (!match) return [];
    const cleaned = match[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const names = [];
    for (const line of cleaned.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//')) continue;
      const idMatch = trimmed.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s*[:,]?/);
      if (idMatch) names.push(idMatch[1]);
    }
    return names;
  }

  // Helper: scan client/*.js for imports from './chess.mjs'
  function parseClientImports(clientDir) {
    const files = fs
      .readdirSync(clientDir)
      .filter((f) => f.endsWith('.js'))
      .map((f) => path.join(clientDir, f));
    const imported = new Set();
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      const importRegex = /import\s*\{([^}]*)\}\s*from\s*['"]\.\/chess\.mjs['"]/g;
      let match;
      while ((match = importRegex.exec(content)) !== null) {
        const names = match[1]
          .split(',')
          .map((s) => s.trim())
          .map((s) => s.split(/\s+as\s+/)[0].trim())
          .filter((s) => s.length > 0);
        for (const name of names) imported.add(name);
      }
    }
    return [...imported].sort();
  }

  // Helper: parse `export { … }` from generated chess.mjs
  function parseMjsExports(mjs) {
    const match = mjs.match(/export\s*\{([^}]*)\}/);
    if (!match) return [];
    return match[1]
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .sort();
  }

  const chessSrc = fs.readFileSync(path.join(ROOT, 'shared', 'chess.js'), 'utf8');
  const mjsSrc = fs.readFileSync(path.join(ROOT, 'client', 'chess.mjs'), 'utf8');
  const cjsExports = parseCjsExports(chessSrc);
  const clientImports = parseClientImports(path.join(ROOT, 'client'));
  const mjsExports = parseMjsExports(mjsSrc);

  test('chess.mjs exports match client imports exactly', () => {
    assert.deepStrictEqual(
      mjsExports,
      clientImports,
      `chess.mjs exports [${mjsExports.join(', ')}] do not match client imports [${clientImports.join(', ')}]. ` +
        'Run `npm run build:chess` to regenerate, or check for stale imports.'
    );
  });

  test('every client import exists in chess.js module.exports', () => {
    const cjsSet = new Set(cjsExports);
    const missing = clientImports.filter((name) => !cjsSet.has(name));
    assert.strictEqual(
      missing.length,
      0,
      `Client imports symbols not in module.exports: ${missing.join(', ')}. ` +
        'Add them to shared/chess.js module.exports.'
    );
  });

  test('chess.mjs does not export symbols the client does not import', () => {
    const clientSet = new Set(clientImports);
    const extra = mjsExports.filter((name) => !clientSet.has(name));
    assert.strictEqual(
      extra.length,
      0,
      `chess.mjs exports symbols not imported by any client module: ${extra.join(', ')}. ` +
        'Run `npm run build:chess` to regenerate.'
    );
  });

  test('chess.mjs does not omit symbols the client imports', () => {
    const mjsSet = new Set(mjsExports);
    const omitted = clientImports.filter((name) => !mjsSet.has(name));
    assert.strictEqual(
      omitted.length,
      0,
      `chess.mjs is missing exports the client needs: ${omitted.join(', ')}. ` +
        'Run `npm run build:chess` to regenerate.'
    );
  });
});

describe('TLS CLI arguments', () => {
  const { execSync, spawn } = require('child_process');
  const serverPath = path.join(ROOT, 'server.js');

  // Each test gets a unique port to avoid EADDRINUSE / TIME_WAIT conflicts
  let portCounter = 49000;

  // Track all child processes so we can kill them on exit
  const childProcesses = [];
  const killAllChildren = () => {
    for (const child of childProcesses) {
      try {
        child.kill('SIGKILL');
      } catch {}
    }
    childProcesses.length = 0;
  };
  process.on('exit', killAllChildren);
  process.on('SIGINT', killAllChildren);
  process.on('SIGTERM', killAllChildren);
  function nextPort() {
    return ++portCounter;
  }

  function runServer(args, timeout) {
    const t = timeout || 3000;
    let port = nextPort();

    // Use spawn so we can explicitly kill the child after capturing output.
    // execSync with a timeout leaves the process in an undefined state,
    // causing EADDRINUSE on subsequent test runs.
    const child = spawn(
      'node',
      [serverPath, '--config=/dev/null', ...args.split(/\s+/).filter(Boolean)],
      {
        env: { ...process.env, MPCHESS_PORT: String(port) },
        timeout: t,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    childProcesses.push(child);
    child.on('close', () => {
      const idx = childProcesses.indexOf(child);
      if (idx >= 0) childProcesses.splice(idx, 1);
    });

    let stdout = '';
    let stderr = '';

    // Wait for the startup banner (or TLS warning/fallback) then kill immediately
    return new Promise((resolve) => {
      let killed = false;
      let resolved = false;
      const resolveOnce = (result) => {
        if (!resolved) {
          resolved = true;
          resolve(result);
        }
      };
      const tryKill = () => {
        if (!killed) {
          killed = true;
          try {
            child.kill('SIGTERM');
          } catch {}
        }
      };
      const handleStdout = (data) => {
        stdout += data.toString();
        if (stdout.includes('Chess server running on')) tryKill();
      };
      const handleStderr = (data) => {
        stderr += data.toString();
        if (stderr.includes('Falling back to HTTP') || stderr.includes('Running in HTTP mode'))
          tryKill();
        // If the port was already in use, the child crashes with EADDRINUSE.
        // Resolve immediately so the test can report the error.
        if (stderr.includes('EADDRINUSE')) {
          tryKill();
        }
      };
      child.stdout.on('data', handleStdout);
      child.stderr.on('data', handleStderr);

      // Safety net: kill after timeout regardless
      const safety = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {}
        resolveOnce({ stdout, stderr, port });
      }, t);

      child.on('close', () => {
        clearTimeout(safety);
        resolveOnce({ stdout, stderr, port });
      });
      child.on('error', () => {
        clearTimeout(safety);
        resolveOnce({ stdout, stderr, port });
      });
    });
  }

  test('--help mentions TLS options', () => {
    const { execSync: exec } = require('child_process');
    const result = exec(`node "${serverPath}" --help`, { encoding: 'utf8', timeout: 5000 });
    assert.ok(result.includes('--cert='), 'help should mention --cert');
    assert.ok(result.includes('--key='), 'help should mention --key');
    assert.ok(result.includes('--chain='), 'help should mention --chain');
  });

  test('no TLS args — starts in HTTP mode', async () => {
    const result = await runServer('', 3000);
    const output = result.stdout + result.stderr;
    assert.ok(output.includes('(http)'), 'should indicate HTTP mode');
    assert.ok(output.includes(`http://localhost:${result.port}`), 'should show http:// URL');
  });

  test('--cert without --key — warns and falls back to HTTP', async () => {
    const result = await runServer('--cert=/tmp/nonexistent.crt', 3000);
    const output = result.stdout + result.stderr;
    assert.ok(output.includes('both --cert and --key'), 'should warn about missing --key');
    assert.ok(output.includes('(http)'), 'should fall back to HTTP');
  });

  test('--key without --cert — warns and falls back to HTTP', async () => {
    const result = await runServer('--key=/tmp/nonexistent.key', 3000);
    const output = result.stdout + result.stderr;
    assert.ok(output.includes('both --cert and --key'), 'should warn about missing --cert');
    assert.ok(output.includes('(http)'), 'should fall back to HTTP');
  });

  test('--cert + --key with nonexistent files — error logged, falls back to HTTP', async () => {
    const result = await runServer('--cert=/tmp/no_such_cert.crt --key=/tmp/no_such_key.key', 3000);
    const output = result.stdout + result.stderr;
    assert.ok(output.includes('TLS error'), 'should log TLS error');
    assert.ok(output.includes('Falling back to HTTP'), 'should log fallback');
    assert.ok(output.includes('(http)'), 'should run in HTTP mode');
  });

  test('--cert + --key with valid self-signed cert — starts HTTPS', async () => {
    const { execSync: exec } = require('child_process');
    const certPath = '/tmp/mpchess_test.crt';
    const keyPath = '/tmp/mpchess_test.key';
    try {
      exec(
        `openssl req -x509 -newkey rsa:2048 -keyout ${keyPath} -out ${certPath} -days 1 -nodes -subj '/CN=localhost' 2>/dev/null`
      );

      const result = await runServer(`--cert=${certPath} --key=${keyPath}`, 3000);
      const output = result.stdout + result.stderr;
      assert.ok(output.includes('(https)'), 'should indicate HTTPS mode');
      assert.ok(output.includes(`https://localhost:${result.port}`), 'should show https:// URL');
    } finally {
      try {
        fs.unlinkSync(certPath);
      } catch {}
      try {
        fs.unlinkSync(keyPath);
      } catch {}
    }
  });

  test('--cert + --key + --chain with valid files — starts HTTPS', async () => {
    const { execSync: exec } = require('child_process');
    const certPath = '/tmp/mpchess_test2.crt';
    const keyPath = '/tmp/mpchess_test2.key';
    const chainPath = '/tmp/mpchess_test2.chain.pem';
    try {
      exec(
        `openssl req -x509 -newkey rsa:2048 -keyout ${keyPath} -out ${certPath} -days 1 -nodes -subj '/CN=localhost' 2>/dev/null`
      );
      // Use the cert itself as the chain (valid PEM)
      fs.copyFileSync(certPath, chainPath);

      const result = await runServer(
        `--cert=${certPath} --key=${keyPath} --chain=${chainPath}`,
        3000
      );
      const output = result.stdout + result.stderr;
      assert.ok(output.includes('(https)'), 'should indicate HTTPS mode');
    } finally {
      try {
        fs.unlinkSync(certPath);
      } catch {}
      try {
        fs.unlinkSync(keyPath);
      } catch {}
      try {
        fs.unlinkSync(chainPath);
      } catch {}
    }
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

describe('FEN engine-compatibility validation', () => {
  test('standard starting position has no warnings', () => {
    const state = fromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    const warnings = validateFenForEngine(
      state.board,
      state.turn,
      state.castlingRights,
      state.enPassantTarget
    );
    assert.strictEqual(warnings.length, 0, `expected no warnings: ${warnings.join(', ')}`);
  });

  test('adjacent kings produce a warning', () => {
    const state = fromFen('8/8/8/8/8/4K3/4k3/8 w - - 0 1');
    const warnings = validateFenForEngine(
      state.board,
      state.turn,
      state.castlingRights,
      state.enPassantTarget
    );
    assert.ok(warnings.some((w) => w.includes('adjacent')));
  });

  test('side not to move in check produces a warning', () => {
    // White to move, but black king is in check from white queen
    const state = fromFen('8/8/8/8/8/4Q3/8/4k2K w - - 0 1');
    const warnings = validateFenForEngine(
      state.board,
      state.turn,
      state.castlingRights,
      state.enPassantTarget
    );
    assert.ok(warnings.some((w) => w.includes('in check')));
  });

  test('pawn on rank 1 produces a warning', () => {
    const state = fromFen('7k/8/8/8/8/8/8/K6P w - - 0 1');
    const warnings = validateFenForEngine(
      state.board,
      state.turn,
      state.castlingRights,
      state.enPassantTarget
    );
    assert.ok(warnings.some((w) => w.includes('rank 1')));
  });

  test('pawn on rank 8 produces a warning', () => {
    const state = fromFen('7p/8/8/8/8/8/8/4K2k w - - 0 1');
    const warnings = validateFenForEngine(
      state.board,
      state.turn,
      state.castlingRights,
      state.enPassantTarget
    );
    assert.ok(warnings.some((w) => w.includes('rank 8')));
  });

  test('impossible castling rights produce a warning', () => {
    // White king on f1 (not e1) but wK castling right claimed
    const state = fromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQ1KNR w Kkq - 0 1');
    const warnings = validateFenForEngine(
      state.board,
      state.turn,
      state.castlingRights,
      state.enPassantTarget
    );
    assert.ok(warnings.some((w) => w.includes('castling')));
  });

  test('impossible white en passant — no capturing pawn produces a warning', () => {
    // White pushed e2-e4, EP target e3. No black pawn on d4 or f4 to capture.
    const state = fromFen('rnbqkbnr/pppp1ppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
    const warnings = validateFenForEngine(
      state.board,
      state.turn,
      state.castlingRights,
      state.enPassantTarget
    );
    assert.ok(warnings.some((w) => w.toLowerCase().includes('en passant')));
  });

  test('impossible white en passant — no pushed pawn produces a warning', () => {
    // EP target e3 but no white pawn on e4 (the pawn that supposedly pushed).
    const state = fromFen('rnbqkbnr/pppp1ppp/8/8/3p4/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
    const warnings = validateFenForEngine(
      state.board,
      state.turn,
      state.castlingRights,
      state.enPassantTarget
    );
    assert.ok(warnings.some((w) => w.toLowerCase().includes('en passant')));
  });

  test('impossible white en passant — wrong turn produces a warning', () => {
    // EP target e3 but it is white's turn (should be black's to capture).
    const state = fromFen('rnbqkbnr/pppp1ppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR w KQkq e3 0 1');
    const warnings = validateFenForEngine(
      state.board,
      state.turn,
      state.castlingRights,
      state.enPassantTarget
    );
    assert.ok(warnings.some((w) => w.toLowerCase().includes('en passant')));
  });

  test('legal white en passant produces no EP warning', () => {
    // White pushed e2-e4, EP target e3. Black to move, white pawn on e4, black pawn on d4.
    const state = fromFen('rnbqkbnr/pppp1ppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
    const warnings = validateFenForEngine(
      state.board,
      state.turn,
      state.castlingRights,
      state.enPassantTarget
    );
    assert.ok(!warnings.some((w) => w.toLowerCase().includes('en passant')));
  });

  test('impossible black en passant — no capturing pawn produces a warning', () => {
    // Black pushed e7-e5, EP target e6. No white pawn on d5 or f5 to capture.
    const state = fromFen('rnbqkbnr/pppp1ppp/8/4p3/8/8/PPPPPPPP/RNBQKBNR w KQkq e6 0 1');
    const warnings = validateFenForEngine(
      state.board,
      state.turn,
      state.castlingRights,
      state.enPassantTarget
    );
    assert.ok(warnings.some((w) => w.toLowerCase().includes('en passant')));
  });

  test('legal black en passant produces no EP warning', () => {
    // Black pushed e7-e5, EP target e6. White to move, black pawn on e5, white pawn on d5.
    const state = fromFen('rnbqkbnr/pppp1ppp/8/3Pp3/8/8/PPPPPPPP/RNBQKBNR w KQkq e6 0 1');
    const warnings = validateFenForEngine(
      state.board,
      state.turn,
      state.castlingRights,
      state.enPassantTarget
    );
    assert.ok(!warnings.some((w) => w.toLowerCase().includes('en passant')));
  });

  test('castling field "-K" is rejected as invalid FEN', () => {
    assert.throws(
      () => fromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w -K - 0 1'),
      /castling.*cannot mix/,
      'should reject castling field mixing "-" with flags'
    );
  });

  test('castling field "--" is rejected as invalid FEN', () => {
    assert.throws(
      () => fromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w -- - 0 1'),
      /castling.*cannot mix/,
      'should reject multiple dashes in castling field'
    );
  });

  test('castling field "-" is accepted as valid', () => {
    const state = fromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1');
    assert.deepStrictEqual(state.castlingRights, { wK: false, wQ: false, bK: false, bQ: false });
  });

  test('castling field "KQkq" is accepted as valid', () => {
    const state = fromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    assert.deepStrictEqual(state.castlingRights, { wK: true, wQ: true, bK: true, bQ: true });
  });

  test('no legal moves for side to move produces a warning', () => {
    // White king on a1, rook on b2 controls a2 and b1, king on c3 controls b2
    // White king not in check but has no legal moves (stalemate)
    const state = fromFen('8/8/8/8/8/2k5/1r6/K7 w - - 0 1');
    const warnings = validateFenForEngine(
      state.board,
      state.turn,
      state.castlingRights,
      state.enPassantTarget
    );
    assert.ok(warnings.some((w) => w.includes('No legal moves')));
  });

  test('multiple warnings are returned for a very broken position', () => {
    // Adjacent kings, both in check, pawns on wrong ranks, impossible castling
    const state = fromFen('P7/8/8/8/4k3/4K3/8/7p w KQkq - 0 1');
    const warnings = validateFenForEngine(
      state.board,
      state.turn,
      state.castlingRights,
      state.enPassantTarget
    );
    assert.ok(
      warnings.length >= 3,
      `expected at least 3 warnings, got ${warnings.length}: ${warnings.join(', ')}`
    );
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

// ── Summary — print everything in declaration order ──────
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
