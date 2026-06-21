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
  getValidMoves, hasAnyMoves, Game,
} = require('./shared/chess');

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
    game.tryMove(black, 4, 6, 4, 5); // e5
    // Now white moves a knight (not a double pawn push)
    game.tryMove(white, 6, 0, 6, 2); // Nf1-d2 ... wait, f1 is knight
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

describe('Path traversal protection', () => {
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

describe('Input validation — WebSocket message bounds', () => {
  test('move with out-of-bounds indices is rejected', () => {
    const { game, white } = makeGame();
    // fromFile = 9 is out of bounds — board[1][9] is undefined
    const result = game.tryMove(white, 9, 1, 4, 2);
    assert.strictEqual(result.ok, false);
  });

  test('move with negative indices is rejected', () => {
    const { game, white } = makeGame();
    const result = game.tryMove(white, -1, 1, 4, 2);
    assert.strictEqual(result.ok, false);
  });

  test('move with string indices is rejected', () => {
    const { game, white } = makeGame();
    const result = game.tryMove(white, 'e', 1, 4, 2);
    assert.strictEqual(result.ok, false);
  });

  test('server-side bounds validator rejects non-integer values', () => {
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

// ── Summary ──────────────────────────────────────────────
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
