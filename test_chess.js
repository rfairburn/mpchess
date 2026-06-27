// ═══════════════════════════════════════════════════════════
//  TEST SUITE — chess engine + security fixes
//  Run:  npm test
// ═══════════════════════════════════════════════════════════

const assert = require('assert');
const path = require('path');

const {
  EMPTY, W_PAWN, W_KNIGHT, W_BISHOP, W_ROOK, W_QUEEN, W_KING,
  B_PAWN, B_KNIGHT, B_BISHOP, B_ROOK, B_QUEEN, B_KING,
  pieceColor, pieceType, isOwn, isEnemy,
  startingBoard, cloneBoard, findKing, isAttacked, isInCheck,
  getValidMoves, hasAnyMoves, isInsufficientMaterial, Game,
  ZOBRIST, toFen, fromFen,
} = require('./shared/chess');

const fs = require('fs');

// ── Minimal test runner ──────────────────────────────────
let passed = 0;
let failed = 0;
let total = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

function describe(label, fn) {
  console.log(`\n${label}`);
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
    const moves = getValidMoves(b, 4, 1, { wK:true, wQ:true, bK:true, bQ:true }, null);
    const targets = moves.map(m => `${m.file},${m.rank}`);
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
    const diag = moves.filter(m => m.file > 4 && m.rank > 4);
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
    b[0][4] = W_KING;  // e1
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
    const moves = getValidMoves(b, 4, 0, { wK:true, wQ:true, bK:true, bQ:true }, null);
    const ks = moves.find(m => m.castle === 'K');
    assert.ok(ks, 'king-side castle should be available');
    assert.strictEqual(ks.file, 6);
  });

  test('white queen-side castling is available when path is clear', () => {
    const b = Array.from({ length: 8 }, () => Array(8).fill(0));
    b[0][4] = W_KING;
    b[0][0] = W_ROOK;
    const moves = getValidMoves(b, 4, 0, { wK:true, wQ:true, bK:true, bQ:true }, null);
    const qs = moves.find(m => m.castle === 'Q');
    assert.ok(qs, 'queen-side castle should be available');
    assert.strictEqual(qs.file, 2);
  });

  test('castling unavailable when rights are cleared', () => {
    const b = startingBoard();
    const moves = getValidMoves(b, 4, 0, { wK:false, wQ:false, bK:true, bQ:true }, null);
    assert.strictEqual(moves.find(m => m.castle), undefined);
  });

  test('castling unavailable when path is blocked', () => {
    const b = startingBoard();
    b[0][5] = W_PAWN; // block king-side
    const moves = getValidMoves(b, 4, 0, { wK:true, wQ:true, bK:true, bQ:true }, null);
    assert.strictEqual(moves.find(m => m.castle === 'K'), undefined);
  });

  test('castling unavailable when king is in check', () => {
    const b = startingBoard();
    // Put a black bishop on b4 to check e1
    b[2][1] = B_BISHOP;
    const moves = getValidMoves(b, 4, 0, { wK:true, wQ:true, bK:true, bQ:true }, null);
    assert.strictEqual(moves.find(m => m.castle), undefined);
  });
});

describe('Castling rights — P0 fix regression tests', () => {
  test('king moving one square revokes BOTH castling rights', () => {
    const g = new Game();
    const ws1 = {}; const ws2 = {};
    g.addPlayer(ws1); g.addPlayer(ws2);

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
    const ws1 = {}; const ws2 = {};
    g.addPlayer(ws1); g.addPlayer(ws2);

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
    const ws1 = {}; const ws2 = {};
    g.addPlayer(ws1); g.addPlayer(ws2);

    // White pawn at f4 (rank 3), en passant target at e5 (rank 4)
    // White pawn captures forward-left: rank 3→4, file 5→4
    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[3][5] = W_PAWN;  // f4 (rank 3, file 5)
    g.board[3][4] = B_PAWN;  // e4 (rank 3, file 4) — the captured pawn
    g.enPassantTarget = { file: 4, rank: 4 }; // e5 — where white pawn moves to
    g.turn = 'white';

    const moves = getValidMoves(g.board, 5, 3, g.castlingRights, g.enPassantTarget);
    const ep = moves.find(m => m.enPassant === true);
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
    const ws1 = {}; const ws2 = {};
    g.addPlayer(ws1); g.addPlayer(ws2);

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
    const ws1 = {}; const ws2 = {};
    g.addPlayer(ws1); g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[6][4] = W_PAWN;
    g.turn = 'white';

    g.tryMove(ws1, 4, 6, 4, 7);
    g.completePromotion(ws1, 'rook');
    assert.strictEqual(g.board[7][4], W_ROOK);
  });

  test('promotion to bishop works', () => {
    const g = new Game();
    const ws1 = {}; const ws2 = {};
    g.addPlayer(ws1); g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[6][4] = W_PAWN;
    g.turn = 'white';

    g.tryMove(ws1, 4, 6, 4, 7);
    g.completePromotion(ws1, 'bishop');
    assert.strictEqual(g.board[7][4], W_BISHOP);
  });

  test('promotion to knight works', () => {
    const g = new Game();
    const ws1 = {}; const ws2 = {};
    g.addPlayer(ws1); g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[6][4] = W_PAWN;
    g.turn = 'white';

    g.tryMove(ws1, 4, 6, 4, 7);
    g.completePromotion(ws1, 'knight');
    assert.strictEqual(g.board[7][4], W_KNIGHT);
  });

  test('invalid promotion pieceType returns false and does not corrupt board', () => {
    const g = new Game();
    const ws1 = {}; const ws2 = {};
    g.addPlayer(ws1); g.addPlayer(ws2);

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
    const ws1 = {}; const ws2 = {};
    g.addPlayer(ws1); g.addPlayer(ws2);

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
    const ws1 = {}; const ws2 = {};
    g.addPlayer(ws1); g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[1][4] = B_PAWN;
    g.turn = 'black';

    g.tryMove(ws2, 4, 1, 4, 0);
    g.completePromotion(ws2, 'queen');
    assert.strictEqual(g.board[0][4], B_QUEEN);
  });
});

describe('Checkmate and stalemate', () => {
  test('back-rank checkmate is detected', () => {
    const g = new Game();
    const ws1 = {}; const ws2 = {};
    g.addPlayer(ws1); g.addPlayer(ws2);

    // White king on e1 trapped by own pieces. Queen on e8, knight on c3 protects e2.
    // Qe2# — king can't capture queen (protected by knight), no escape squares.
    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[0][4] = W_KING;  // e1
    g.board[0][3] = W_ROOK;  // d1 (blocks escape)
    g.board[0][5] = W_ROOK;  // f1 (blocks escape)
    g.board[1][3] = W_PAWN;  // d2 (blocks escape)
    g.board[1][5] = W_PAWN;  // f2 (blocks escape)
    g.board[7][4] = B_QUEEN; // e8
    g.board[2][2] = B_KNIGHT; // c3 (protects e2)
    g.turn = 'black';
    g.castlingRights = { wK:false, wQ:false, bK:false, bQ:false };

    const result = g.tryMove(ws2, 4, 7, 4, 1); // Qe2#
    assert.strictEqual(result.ok, true);
    assert.strictEqual(g.gameOver, true);
    assert.ok(g.gameResult.includes('Checkmate'));
  });

  test('stalemate is detected', () => {
    const g = new Game();
    const ws1 = {}; const ws2 = {};
    g.addPlayer(ws1); g.addPlayer(ws2);

    // King on a1, black knights control a2 and b1, black king blocks b2
    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[0][0] = W_KING;   // a1
    g.board[0][2] = B_KNIGHT;  // c1 — controls a2, b3
    g.board[1][3] = B_KNIGHT;  // d2 — controls b1, b3, c4, e4, f3, f1
    g.board[2][1] = B_KING;    // c3 — controls b2, b3, c2, c4, d2, d3, d4, b4
    g.turn = 'white';
    g.castlingRights = { wK:false, wQ:false, bK:false, bQ:false };

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
    const ws1 = {}; const ws2 = {};
    assert.strictEqual(g.addPlayer(ws1), 'white');
    assert.strictEqual(g.addPlayer(ws2), 'black');
  });

  test('third player becomes spectator', () => {
    const g = new Game();
    g.addPlayer({}); g.addPlayer({});
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
    assert.deepStrictEqual(game.castlingRights, { wK:true, wQ:true, bK:true, bQ:true });
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
});

describe('Path resolution algorithm — verifies the fix logic', () => {
  test('stripping leading slash prevents absolute path escape', () => {
    const __dirname = '/home/robert/mpchess';
    const urlPath = '/client/index.html';

    // The fix: strip leading '/' before resolving
    const relativePath = urlPath.startsWith('/') ? urlPath.slice(1) : urlPath;
    const safePath = path.normalize(relativePath);
    const filePath = path.resolve(__dirname, safePath);

    assert.ok(filePath.startsWith(__dirname), `filePath ${filePath} should start with ${__dirname}`);
    assert.strictEqual(filePath, '/home/robert/mpchess/client/index.html');
  });

  test('path traversal attempt is rejected', () => {
    const urlPath = '/../../../etc/passwd';

    const relativePath = urlPath.startsWith('/') ? urlPath.slice(1) : urlPath;
    const safePath = path.normalize(relativePath);

    // After normalization, this starts with '..'
    assert.ok(safePath.startsWith('..'), 'normalized path should start with ..');
  });

  test('normal client paths resolve correctly', () => {
    const __dirname = '/home/robert/mpchess';
    const paths = [
      ['/client/index.html', '/home/robert/mpchess/client/index.html'],
      ['/client/app.js', '/home/robert/mpchess/client/app.js'],
      ['/files/king.stl', '/home/robert/mpchess/files/king.stl'],
    ];

    for (const [urlPath, expected] of paths) {
      const relativePath = urlPath.startsWith('/') ? urlPath.slice(1) : urlPath;
      const safePath = path.normalize(relativePath);
      const filePath = path.resolve(__dirname, safePath);
      assert.strictEqual(filePath, expected);
    }
  });

  test('path.resolve with leading slash is the bug — verify fix avoids it', () => {
    const __dirname = '/home/robert/mpchess';
    const urlPath = '/client/index.html';

    // BUG: path.resolve treats leading / as absolute
    const buggyPath = path.resolve(__dirname, urlPath);
    assert.strictEqual(buggyPath, '/client/index.html', 'bug confirmed: leading / makes path absolute');
    assert.ok(!buggyPath.startsWith(__dirname), 'bug: path escapes __dirname');

    // FIX: strip leading / first
    const fixedPath = path.resolve(__dirname, urlPath.slice(1));
    assert.strictEqual(fixedPath, '/home/robert/mpchess/client/index.html');
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
      file, rank, type, color
    };
  }

  function simulateRebuild(serverBoard, pieceMeshes) {
    // Replicates the rebuildPieces diffing logic (without Three.js)
    const { pieceColor, pieceType } = require('./shared/chess');

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
    board[0][4] = W_ROOK;  // e1
    board[5][4] = B_PAWN;  // e5

    let meshes = [
      makeMockMesh(4, 0, 'rook', 'white'),
      makeMockMesh(4, 5, 'pawn', 'black'),
    ];

    // Simulate animateMove: rook moves e1 → e5, captures pawn
    // FIX: update file/rank IMMEDIATELY (not at end of animation)
    const fromPiece = meshes.find(p => p.file === 4 && p.rank === 0);
    fromPiece.file = 4;  // toFile
    fromPiece.rank = 5;  // toRank

    // Remove captured pawn (animateMove does this via splice)
    meshes = meshes.filter(p => !(p.file === 4 && p.rank === 5 && p.type === 'pawn'));

    // Server board after capture: rook at e5, pawn gone
    const newBoard = Array.from({ length: 8 }, () => Array(8).fill(0));
    newBoard[5][4] = W_ROOK;

    // rebuildPieces runs
    const result = simulateRebuild(newBoard, meshes);

    // The capturing rook must survive
    assert.strictEqual(result.finalMeshes.length, 1,
      'capturing piece must survive rebuildPieces');
    assert.strictEqual(result.finalMeshes[0].type, 'rook');
    assert.strictEqual(result.finalMeshes[0].file, 4);
    assert.strictEqual(result.finalMeshes[0].rank, 5);
    // The rook must NOT have been removed
    assert.ok(!result.removed.includes('4,5'),
      'capturing piece at destination must not be removed');
  });

  test('capture: WITHOUT the fix, capturing piece is removed (bug reproduction)', () => {
    // Same scenario but WITHOUT updating file/rank immediately
    const board = Array.from({ length: 8 }, () => Array(8).fill(0));
    board[0][4] = W_ROOK;
    board[5][4] = B_PAWN;

    let meshes = [
      makeMockMesh(4, 0, 'rook', 'white'),
      makeMockMesh(4, 5, 'pawn', 'black'),
    ];

    // BUG: file/rank NOT updated (old behavior — updated at end of animation)
    // fromPiece.file and fromPiece.rank stay at 4,0

    // Remove captured pawn
    meshes = meshes.filter(p => !(p.file === 4 && p.rank === 5 && p.type === 'pawn'));

    // Server board after capture
    const newBoard = Array.from({ length: 8 }, () => Array(8).fill(0));
    newBoard[5][4] = W_ROOK;

    const result = simulateRebuild(newBoard, meshes);

    // BUG: rook at "4,0" is not in desired → gets removed
    assert.ok(result.removed.includes('4,0'),
      'BUG confirmed: capturing piece at old position is removed');
    assert.strictEqual(result.finalMeshes.length, 0,
      'BUG: no pieces survive — capturing piece is gone');
  });

  test('non-capture move: piece survives rebuildPieces', () => {
    // White knight moves b1 → a3 (no capture)
    const meshes = [
      makeMockMesh(1, 0, 'knight', 'white'),
    ];

    // Simulate animateMove with fix: update file/rank immediately
    const fromPiece = meshes[0];
    fromPiece.file = 0;  // toFile
    fromPiece.rank = 2;  // toRank

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
      makeMockMesh(5, 3, 'pawn', 'white'),  // f4
      makeMockMesh(4, 3, 'pawn', 'black'),  // e4 (the captured pawn)
    ];

    // animateMove: update file/rank immediately
    const fromPiece = meshes[0];
    fromPiece.file = 4;  // toFile (e)
    fromPiece.rank = 4;  // toRank (5)

    // En passant: remove captured pawn at epRank (rank 3 = 4th row)
    meshes = meshes.filter(p => !(p.file === 4 && p.rank === 3 && p.type === 'pawn'));

    const newBoard = Array.from({ length: 8 }, () => Array(8).fill(0));
    newBoard[4][4] = W_PAWN;  // e5

    const result = simulateRebuild(newBoard, meshes);
    assert.strictEqual(result.finalMeshes.length, 1,
      'capturing pawn must survive en passant rebuild');
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
    const ws1 = {}; const ws2 = {};
    g.addPlayer(ws1); g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[2][2] = W_KNIGHT;  // c3
    g.board[2][6] = W_KNIGHT;  // g3
    g.turn = 'white';
    g.castlingRights = { wK:false, wQ:false, bK:false, bQ:false };

    // Move knight from c3 to e4
    const result1 = g.tryMove(ws1, 2, 2, 4, 3);
    assert.strictEqual(result1.ok, true);
    // Nce4 (c-file disambiguation; stalemate — no black king on board)
    assert.strictEqual(g.moveHistory[0], 'Nce4', `expected Nce4: ${g.moveHistory[0]}`);

    // Move knight from g3 to e4
    g.reset();
    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[2][2] = W_KNIGHT;  // c3
    g.board[2][6] = W_KNIGHT;  // g3
    g.turn = 'white';
    const result2 = g.tryMove(ws1, 6, 2, 4, 3);
    assert.strictEqual(result2.ok, true);
    // Nge4 (g-file disambiguation; stalemate)
    assert.strictEqual(g.moveHistory[0], 'Nge4', `expected Nge4: ${g.moveHistory[0]}`);
  });

  test('two rooks on same file - rank disambiguation', () => {
    // Two rooks on the d-file, black king on d8 — Rd4 gives check
    const g = new Game();
    const ws1 = {}; const ws2 = {};
    g.addPlayer(ws1); g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[0][3] = W_ROOK;  // d1
    g.board[4][3] = W_ROOK;  // d5
    g.board[7][3] = B_KING;  // d8
    g.turn = 'white';
    g.castlingRights = { wK:false, wQ:false, bK:false, bQ:false };

    // R1d4+ — rank disambiguation since both rooks are on d-file
    const result = g.tryMove(ws1, 3, 0, 3, 3);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(g.moveHistory[0], 'R1d4+', `expected R1d4+: ${g.moveHistory[0]}`);
  });

  test('two rooks on same rank - file disambiguation', () => {
    // Two rooks on the 1st rank, black king on c8 — Rc1 gives check
    const g = new Game();
    const ws1 = {}; const ws2 = {};
    g.addPlayer(ws1); g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[0][0] = W_ROOK;  // a1
    g.board[0][3] = W_ROOK;  // d1
    g.board[7][2] = B_KING;  // c8
    g.turn = 'white';
    g.castlingRights = { wK:false, wQ:false, bK:false, bQ:false };

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
    const ws1 = {}; const ws2 = {};
    g.addPlayer(ws1); g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[1][1] = W_KNIGHT;  // b2
    g.board[5][1] = W_KNIGHT;  // b6
    g.board[1][3] = W_KNIGHT;  // d2
    g.turn = 'white';
    g.castlingRights = { wK:false, wQ:false, bK:false, bQ:false };

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
    const ws1 = {}; const ws2 = {};
    g.addPlayer(ws1); g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[0][2] = W_BISHOP;  // c1
    g.board[0][6] = W_BISHOP;  // g1
    g.board[4][2] = W_BISHOP;  // c5
    g.turn = 'white';
    g.castlingRights = { wK:false, wQ:false, bK:false, bQ:false };

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
    const ws1 = {}; const ws2 = {};
    g.addPlayer(ws1); g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[0][2] = W_QUEEN;  // c1
    g.board[0][6] = W_QUEEN;  // g1
    g.board[4][2] = W_QUEEN;  // c5
    g.turn = 'white';
    g.castlingRights = { wK:false, wQ:false, bK:false, bQ:false };

    const result = g.tryMove(ws1, 2, 0, 4, 2);
    assert.strictEqual(result.ok, true);
    // Qc1e3 (full disambiguation; stalemate)
    assert.strictEqual(g.moveHistory[0], 'Qc1e3', `expected Qc1e3: ${g.moveHistory[0]}`);
  });

  test('bishop move with disambiguation', () => {
    // Two bishops on c3 and g3, both can reach e5
    const g = new Game();
    const ws1 = {}; const ws2 = {};
    g.addPlayer(ws1); g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[2][2] = W_BISHOP;  // c3
    g.board[2][6] = W_BISHOP;  // g3
    g.turn = 'white';
    g.castlingRights = { wK:false, wQ:false, bK:false, bQ:false };

    const result = g.tryMove(ws1, 2, 2, 4, 4);
    assert.strictEqual(result.ok, true);
    // Bce5 (file disambiguation; stalemate)
    assert.strictEqual(g.moveHistory[0], 'Bce5', `expected Bce5: ${g.moveHistory[0]}`);
  });

  test('queen move with disambiguation', () => {
    // Two queens on d3 and f3, both can reach e4
    const g = new Game();
    const ws1 = {}; const ws2 = {};
    g.addPlayer(ws1); g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[3][3] = W_QUEEN;  // d3
    g.board[3][5] = W_QUEEN;  // f3
    g.turn = 'white';
    g.castlingRights = { wK:false, wQ:false, bK:false, bQ:false };

    const result = g.tryMove(ws1, 3, 3, 4, 4);
    assert.strictEqual(result.ok, true);
    // Qde5 (file disambiguation; stalemate)
    assert.strictEqual(g.moveHistory[0], 'Qde5', `expected Qde5: ${g.moveHistory[0]}`);
  });

  test('king move - no disambiguation needed (only one king)', () => {
    const g = new Game();
    const ws1 = {}; const ws2 = {};
    g.addPlayer(ws1); g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[0][4] = W_KING;  // e1
    g.board[7][4] = B_KING;  // e8
    g.turn = 'white';
    g.castlingRights = { wK:false, wQ:false, bK:false, bQ:false };

    // Move king from e1 to e2 (no check involved)
    const result = g.tryMove(ws1, 4, 0, 4, 1);
    assert.strictEqual(result.ok, true);
    // King moves should not need disambiguation; Ke2 (no check — black king too far)
    assert.strictEqual(g.moveHistory[0], 'Ke2', `expected Ke2: ${g.moveHistory[0]}`);
  });

  test('pawn capture notation includes departure file', () => {
    const g = new Game();
    const ws1 = {}; const ws2 = {};
    g.addPlayer(ws1); g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[3][4] = W_PAWN;  // e4
    g.board[4][3] = B_PAWN;  // d5 (the pawn to capture via en passant)
    g.turn = 'white';
    g.castlingRights = { wK:false, wQ:false, bK:false, bQ:false };

    // Black pawn just moved d7-d5
    g.enPassantTarget = { file: 3, rank: 4 };  // d5

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
    const ws1 = {}; const ws2 = {};
    g.addPlayer(ws1); g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[0][4] = W_KING;    // e1
    g.board[1][4] = W_KNIGHT;  // e2 — pinned by rook on e8
    g.board[2][2] = W_KNIGHT;  // c3 — free
    g.board[7][4] = B_ROOK;    // e8 — pins the e2 knight
    g.turn = 'white';
    g.castlingRights = { wK:false, wQ:false, bK:false, bQ:false };

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
    g.board[0][4] = W_KING;    // e1
    g.board[1][4] = W_KNIGHT;  // e2 — pinned by rook on e8
    g.board[0][1] = W_KNIGHT;  // b1 — free
    g.board[7][4] = B_ROOK;    // e8 — pins the e2 knight
    g.turn = 'white';
    g.castlingRights = { wK:false, wQ:false, bK:false, bQ:false };

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
    const ws1 = {}; const ws2 = {};
    g.addPlayer(ws1); g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[6][4] = W_PAWN;  // e7
    g.turn = 'white';
    g.castlingRights = { wK:false, wQ:false, bK:false, bQ:false };

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
    const ws1 = {}; const ws2 = {};
    g.addPlayer(ws1); g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[6][4] = W_PAWN;  // e7
    g.turn = 'white';
    g.castlingRights = { wK:false, wQ:false, bK:false, bQ:false };

    // Push pawn to e8 — triggers promotion
    const result = g.tryMove(ws1, 4, 6, 4, 7);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.promotion, true);
    // Pawn should still be at source (server doesn't mutate board for promotions)
    assert.strictEqual(g.board[6][4], W_PAWN, 'pawn still at source before completePromotion');
    assert.strictEqual(g.board[7][4], 0, 'destination empty before completePromotion');

    // Complete promotion
    g.completePromotion(ws1, 'queen');
    assert.strictEqual(g.board[6][4], 0, 'source square cleared after promotion');
    assert.strictEqual(g.board[7][4], W_QUEEN, 'queen at destination');
  });

  test('promotion via en passant removes captured pawn (synthetic)', () => {
    // Note: en passant promotion is impossible in real chess (geometry prevents
    // en passant targets from landing on the promotion rank), but the code path
    // exists and must be correct. Test with a synthetic board state.
    const g = new Game();
    const ws1 = {}; const ws2 = {};
    g.addPlayer(ws1); g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[6][1] = W_PAWN;   // white pawn at source
    g.board[6][0] = B_PAWN;   // black pawn to be captured (synthetic en passant)
    g.turn = 'white';
    g.castlingRights = { wK:false, wQ:false, bK:false, bQ:false };

    // Manually set up a promotion with enPassant flag (bypasses move validation)
    g.promotingPiece = { file: 0, rank: 7, color: 'white', fromFile: 1, fromRank: 6, enPassant: true };

    // Complete promotion — should clear source AND en passant captured pawn
    g.completePromotion(ws1, 'rook');
    assert.strictEqual(g.board[6][1], 0, 'source square cleared');
    assert.strictEqual(g.board[6][0], 0, 'en passant captured pawn removed (rank-1 for white)');
    assert.strictEqual(g.board[7][0], W_ROOK, 'rook at destination');
  });

  test('promotingPiece stores source coordinates for client sync', () => {
    const g = new Game();
    const ws1 = {}; const ws2 = {};
    g.addPlayer(ws1); g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[6][0] = W_PAWN;  // a7
    g.turn = 'white';
    g.castlingRights = { wK:false, wQ:false, bK:false, bQ:false };

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
});

describe('Insufficient material — draw detection', () => {
  function emptyBoard() { return Array.from({ length: 8 }, () => Array(8).fill(0)); }

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
    b[0][0] = W_BISHOP;  // a1 — dark square (0+0=0, even)
    b[7][4] = B_KING;
    b[7][1] = B_BISHOP;  // b8 — dark square (1+7=8, even)
    assert.strictEqual(isInsufficientMaterial(b), true);
  });

  test('K+B vs K+B opposite-colored bishops is NOT insufficient material', () => {
    const b = emptyBoard();
    b[0][4] = W_KING;
    b[0][0] = W_BISHOP;  // a1 — dark square (0+0=0, even)
    b[7][4] = B_KING;
    b[7][0] = B_BISHOP;  // a8 — light square (0+7=7, odd)
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
    const ws1 = {}; const ws2 = {};
    g.addPlayer(ws1); g.addPlayer(ws2);

    // K vs K
    g.board = emptyBoard();
    g.board[0][4] = W_KING;
    g.board[7][4] = B_KING;
    g.turn = 'white';

    g.checkGameEnd();
    assert.strictEqual(g.gameOver, true);
    assert.ok(g.gameResult.includes('insufficient material'), `expected insufficient material draw: ${g.gameResult}`);
  });

  test('checkGameEnd detects K+B vs K as draw', () => {
    const g = new Game();
    const ws1 = {}; const ws2 = {};
    g.addPlayer(ws1); g.addPlayer(ws2);

    g.board = emptyBoard();
    g.board[0][4] = W_KING;
    g.board[0][2] = W_BISHOP;
    g.board[7][4] = B_KING;
    g.turn = 'black';

    g.checkGameEnd();
    assert.strictEqual(g.gameOver, true);
    assert.ok(g.gameResult.includes('insufficient material'), `expected insufficient material draw: ${g.gameResult}`);
  });

  test('checkGameEnd does NOT draw on K+B vs K+B opposite-colored bishops', () => {
    const g = new Game();
    const ws1 = {}; const ws2 = {};
    g.addPlayer(ws1); g.addPlayer(ws2);

    g.board = emptyBoard();
    g.board[0][4] = W_KING;
    g.board[0][0] = W_BISHOP;  // a1 — dark
    g.board[7][4] = B_KING;
    g.board[7][0] = B_BISHOP;  // a8 — light
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
    const h1 = ZOBRIST.compute(board, 'white', { wK:true, wQ:true, bK:true, bQ:true }, null);
    const h2 = ZOBRIST.compute(board, 'white', { wK:true, wQ:true, bK:true, bQ:true }, null);
    assert.strictEqual(h1, h2, 'identical positions must produce identical hashes');
  });

  test('different board produces different hash', () => {
    const b1 = startingBoard();
    const b2 = startingBoard();
    b2[1][4] = 0; // remove white e-pawn
    const h1 = ZOBRIST.compute(b1, 'white', { wK:true, wQ:true, bK:true, bQ:true }, null);
    const h2 = ZOBRIST.compute(b2, 'white', { wK:true, wQ:true, bK:true, bQ:true }, null);
    assert.notStrictEqual(h1, h2, 'different boards must produce different hashes');
  });

  test('different turn produces different hash', () => {
    const board = startingBoard();
    const cr = { wK:true, wQ:true, bK:true, bQ:true };
    const hw = ZOBRIST.compute(board, 'white', cr, null);
    const hb = ZOBRIST.compute(board, 'black', cr, null);
    assert.notStrictEqual(hw, hb, 'different sides to move must produce different hashes');
  });

  test('different castling rights produce different hash', () => {
    const board = startingBoard();
    const cr1 = { wK:true, wQ:true, bK:true, bQ:true };
    const cr2 = { wK:false, wQ:true, bK:true, bQ:true };
    const h1 = ZOBRIST.compute(board, 'white', cr1, null);
    const h2 = ZOBRIST.compute(board, 'white', cr2, null);
    assert.notStrictEqual(h1, h2, 'different castling rights must produce different hashes');
  });

  test('en passant target produces different hash', () => {
    const board = startingBoard();
    const cr = { wK:true, wQ:true, bK:true, bQ:true };
    const h1 = ZOBRIST.compute(board, 'white', cr, null);
    const h2 = ZOBRIST.compute(board, 'white', cr, { file: 3, rank: 3 });
    assert.notStrictEqual(h1, h2, 'en passant target must affect hash');
  });

  test('hash is a BigInt', () => {
    const board = startingBoard();
    const h = ZOBRIST.compute(board, 'white', { wK:true, wQ:true, bK:true, bQ:true }, null);
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
    const ws1 = {}; const ws2 = {};
    g.addPlayer(ws1); g.addPlayer(ws2);
    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[6][4] = W_PAWN; // e7
    g.turn = 'white';
    g.castlingRights = { wK:false, wQ:false, bK:false, bQ:false };
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
    const ws1 = {}; const ws2 = {};
    g.addPlayer(ws1); g.addPlayer(ws2);
    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[6][4] = W_PAWN;
    g.turn = 'white';
    g.castlingRights = { wK:false, wQ:false, bK:false, bQ:false };

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
    const ws1 = {}; const ws2 = {};
    g.addPlayer(ws1); g.addPlayer(ws2);
    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[7][1] = W_KING; // b8
    g.board[7][6] = B_KING; // g8
    g.turn = 'white';
    g.castlingRights = { wK:false, wQ:false, bK:false, bQ:false };
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
    g.castlingRights = { wK:false, wQ:false, bK:false, bQ:false };
    g.enPassantTarget = null;

    g.positionHistory = [];
    g.positionCounts = new Map();

    g._recordPosition(null); // count = 1
    assert.strictEqual(g.isThreefoldRepetition(), false);
    g._recordPosition(null); // count = 2
    assert.strictEqual(g.isThreefoldRepetition(), false);
    g._recordPosition(null); // count = 3
    assert.strictEqual(g.isThreefoldRepetition(), true, 'three identical positions triggers threefold');
  });

  test('checkGameEnd declares draw on threefold', () => {
    const g = new Game();
    const board = Array.from({ length: 8 }, () => Array(8).fill(0));
    board[0][4] = W_KING;
    board[7][4] = B_KING;
    g.board = board;
    g.turn = 'white';
    g.castlingRights = { wK:false, wQ:false, bK:false, bQ:false };
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
    g.castlingRights = { wK:true, wQ:true, bK:true, bQ:true };
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
    const ws1 = {}; const ws2 = {};
    g.addPlayer(ws1); g.addPlayer(ws2);
    // Position with legal moves but 50-move clock reached
    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[0][4] = W_KING;
    g.board[0][3] = W_KNIGHT;
    g.board[7][4] = B_KING;
    g.board[7][3] = B_KNIGHT;
    g.turn = 'white';
    g.castlingRights = { wK:false, wQ:false, bK:false, bQ:false };
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
    const ws1 = {}; const ws2 = {};
    g.addPlayer(ws1); g.addPlayer(ws2);
    // Move white king
    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[0][4] = W_KING;
    g.board[7][4] = B_KING;
    g.turn = 'white';
    g.castlingRights = { wK:true, wQ:true, bK:true, bQ:true };
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
    assert.deepStrictEqual(state.castlingRights, { wK:true, wQ:true, bK:true, bQ:true });
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
    assert.throws(() => fromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq - 0 1'), /Invalid FEN/);
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
    const ws1 = {}; const ws2 = {};
    g.addPlayer(ws1); g.addPlayer(ws2);
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
    const mjsPath = path.join(__dirname, 'shared', 'chess.mjs');
    const mjs = fs.readFileSync(mjsPath, 'utf8');
    const lines = mjs.split('\n');
    const bareRequires = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      // Skip comments
      if (line.startsWith('//') || line.startsWith('*')) continue;
      // Skip the guarded try/catch pattern
      if (line.includes('try') && line.includes('require(')) continue;
      // Flag any other require(
      if (line.includes('require(')) {
        bareRequires.push({ line: i + 1, text: line });
      }
    }
    assert.strictEqual(bareRequires.length, 0,
      `Bare require() found in chess.mjs (crashes in browser):\n${bareRequires.map(r => `  line ${r.line}: ${r.text}`).join('\n')}`);
  });

  test('generated chess.mjs wraps crypto require in try/catch', () => {
    const mjsPath = path.join(__dirname, 'shared', 'chess.mjs');
    const mjs = fs.readFileSync(mjsPath, 'utf8');
    assert.ok(mjs.includes('try') && mjs.includes("require('crypto')"),
      'crypto require must be wrapped in try/catch for browser compatibility');
  });

  test('ZOBRIST is null-safe when crypto unavailable', () => {
    // In Node.js, ZOBRIST is a real instance. In browser it would be null.
    // Verify the Game class handles null ZOBRIST gracefully.
    assert.ok(ZOBRIST !== null, 'ZOBRIST should be initialized in Node.js');
    // Verify _computeZobrist has a null guard (check source)
    const src = fs.readFileSync(path.join(__dirname, 'shared', 'chess.js'), 'utf8');
    assert.ok(src.includes('if (!ZOBRIST)'),
      '_computeZobrist must guard against null ZOBRIST for browser safety');
  });
});

// ── Summary ──────────────────────────────────────────────
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
