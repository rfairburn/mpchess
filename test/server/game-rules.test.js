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
    assert.ok(game.gameResult.startsWith('game.concede'));
  });

  test('cannot move after game over', () => {
    const { game, white } = makeGame();
    game.concede(white);
    const result = game.tryMove(white, 4, 1, 4, 2);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'error.game_over');
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

  test('K+N vs K+N is NOT insufficient material (checkmate possible with knight constraining own king)', () => {
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
    assert.strictEqual(
      g.gameResult,
      'game.draw_insufficient',
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
    assert.strictEqual(
      g.gameResult,
      'game.draw_insufficient',
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

describe('Zobrist hashing', () => {
  test('same position produces same hash', () => {
    const board = startingBoard();
    const h1 = zobrist.compute(board, 'white', { wK: true, wQ: true, bK: true, bQ: true }, null);
    const h2 = zobrist.compute(board, 'white', { wK: true, wQ: true, bK: true, bQ: true }, null);
    assert.strictEqual(h1, h2, 'identical positions must produce identical hashes');
  });

  test('different board produces different hash', () => {
    const b1 = startingBoard();
    const b2 = startingBoard();
    b2[1][4] = 0; // remove white e-pawn
    const h1 = zobrist.compute(b1, 'white', { wK: true, wQ: true, bK: true, bQ: true }, null);
    const h2 = zobrist.compute(b2, 'white', { wK: true, wQ: true, bK: true, bQ: true }, null);
    assert.notStrictEqual(h1, h2, 'different boards must produce different hashes');
  });

  test('different turn produces different hash', () => {
    const board = startingBoard();
    const cr = { wK: true, wQ: true, bK: true, bQ: true };
    const hw = zobrist.compute(board, 'white', cr, null);
    const hb = zobrist.compute(board, 'black', cr, null);
    assert.notStrictEqual(hw, hb, 'different sides to move must produce different hashes');
  });

  test('different castling rights produce different hash', () => {
    const board = startingBoard();
    const cr1 = { wK: true, wQ: true, bK: true, bQ: true };
    const cr2 = { wK: false, wQ: true, bK: true, bQ: true };
    const h1 = zobrist.compute(board, 'white', cr1, null);
    const h2 = zobrist.compute(board, 'white', cr2, null);
    assert.notStrictEqual(h1, h2, 'different castling rights must produce different hashes');
  });

  test('en passant target produces different hash', () => {
    const board = startingBoard();
    const cr = { wK: true, wQ: true, bK: true, bQ: true };
    const h1 = zobrist.compute(board, 'white', cr, null);
    const h2 = zobrist.compute(board, 'white', cr, { file: 3, rank: 3 });
    assert.notStrictEqual(h1, h2, 'en passant target must affect hash');
  });

  test('hash is a BigInt', () => {
    const board = startingBoard();
    const h = zobrist.compute(board, 'white', { wK: true, wQ: true, bK: true, bQ: true }, null);
    assert.ok(typeof h === 'bigint', 'Zobrist hash must be a BigInt');
  });
});

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
  test('K e1-e2 shuttle with pawns produces threefold via legal moves', () => {
    // Position: White pawn a2, king e1; Black pawn a7, king e8.
    // Kings shuttle e1<->e2 / e8<->e7 while pawns stay put.
    const g = new Game();
    const ws1 = {}; // white
    const ws2 = {}; // black
    g.addPlayer(ws1);
    g.addPlayer(ws2);

    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[0][4] = W_KING; // Ke1
    g.board[1][0] = W_PAWN; // Pa2
    g.board[6][0] = B_PAWN; // Pa7
    g.board[7][4] = B_KING; // Ke8
    g.turn = 'white';
    g.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };
    g.enPassantTarget = null;
    g.halfmoveClock = 0;
    g.positionHistory = [];
    g.positionCounts = new Map();

    // Position 0 recorded (repetition = 1)
    g._recordPosition(null);
    assert.strictEqual(g.isThreefoldRepetition(), false);
    assert.strictEqual(g.getCurrentRepetitionCount(), 1);

    // 1: Ke2
    g.tryMove(ws1, 4, 0, 4, 1);
    // 1: Ke7
    g.tryMove(ws2, 4, 7, 4, 6);

    // 2: Ke1 — back to position 0 (repetition = 2)
    g.tryMove(ws1, 4, 1, 4, 0);
    // 2: Ke8 — back to position 0 (repetition = 2)
    g.tryMove(ws2, 4, 6, 4, 7);
    assert.strictEqual(g.isThreefoldRepetition(), false);
    assert.strictEqual(g.getCurrentRepetitionCount(), 2);

    // 3: Ke2
    g.tryMove(ws1, 4, 0, 4, 1);
    // 3: Ke7
    g.tryMove(ws2, 4, 7, 4, 6);

    // 4: Ke1
    g.tryMove(ws1, 4, 1, 4, 0);
    // 4: Ke8 — back to position 0 (repetition = 3, threefold!)
    g.tryMove(ws2, 4, 6, 4, 7);
    assert.strictEqual(
      g.isThreefoldRepetition(),
      true,
      'threefold after Ke1-Ke2-Ke1-Ke2-Ke1 / Ke8-Ke7-Ke8-Ke7-Ke8 shuttle'
    );
    assert.strictEqual(g.getCurrentRepetitionCount(), 3);

    g.checkGameEnd();
    assert.strictEqual(g.gameOver, true);
    assert.strictEqual(
      g.gameResult,
      'game.draw_threefold',
      `expected threefold draw: ${g.gameResult}`
    );
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
    assert.strictEqual(
      g.gameResult,
      'game.draw_threefold',
      `expected threefold draw: ${g.gameResult}`
    );
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

describe('Fifty-move rule', () => {
  test('canClaimDrawByFiftyMoves returns false when clock < 100', () => {
    const g = new Game();
    g.halfmoveClock = 99;
    assert.strictEqual(g.canClaimDrawByFiftyMoves(), false);
  });

  test('canClaimDrawByFiftyMoves returns true when clock >= 100', () => {
    const g = new Game();
    g.halfmoveClock = 100;
    assert.strictEqual(g.canClaimDrawByFiftyMoves(), true);
  });

  test('isSeventyFiveMoveRule returns true when clock >= 150', () => {
    const g = new Game();
    g.halfmoveClock = 149;
    assert.strictEqual(g.isSeventyFiveMoveRule(), false);
    g.halfmoveClock = 150;
    assert.strictEqual(g.isSeventyFiveMoveRule(), true);
  });

  test('canClaimDrawByFiftyMoves returns true when clock >= 100', () => {
    const g = new Game();
    g.halfmoveClock = 99;
    assert.strictEqual(g.canClaimDrawByFiftyMoves(), false);
    g.halfmoveClock = 100;
    assert.strictEqual(g.canClaimDrawByFiftyMoves(), true);
  });

  test('checkGameEnd does NOT auto-draw at 100 half-moves (manual claim only)', () => {
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);
    // K+R vs K — sufficient material, legal moves exist
    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[0][4] = W_KING;
    g.board[0][0] = W_ROOK;
    g.board[7][4] = B_KING;
    g.turn = 'white';
    g.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };
    g.halfmoveClock = 100;

    g.checkGameEnd();
    assert.strictEqual(g.gameOver, false, 'should NOT auto-draw at 100 half-moves');
  });

  test('checkGameEnd declares draw on 75-move rule at 150 half-moves', () => {
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);
    // K+R vs K — sufficient material, legal moves exist
    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[0][4] = W_KING;
    g.board[0][0] = W_ROOK;
    g.board[7][4] = B_KING;
    g.turn = 'white';
    g.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };
    g.halfmoveClock = 150;

    g.checkGameEnd();
    assert.strictEqual(g.gameOver, true);
    assert.strictEqual(g.gameResult, 'game.draw_75move', `expected 75-move draw: ${g.gameResult}`);
  });

  test("claimDraw succeeds when halfmoveClock >= 100 and it is the player's turn", () => {
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);
    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[0][4] = W_KING;
    g.board[0][0] = W_ROOK;
    g.board[7][4] = B_KING;
    g.turn = 'white';
    g.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };
    g.halfmoveClock = 100;

    const result = g.claimDraw(ws1);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(g.gameOver, true);
    assert.strictEqual(
      g.gameResult,
      'game.draw_50move_claimed',
      `expected 50-move claimed: ${g.gameResult}`
    );
  });

  test('claimDraw fails when halfmoveClock < 100', () => {
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);
    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[0][4] = W_KING;
    g.board[0][0] = W_ROOK;
    g.board[7][4] = B_KING;
    g.turn = 'white';
    g.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };
    g.halfmoveClock = 99;

    const result = g.claimDraw(ws1);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'error.draw_50move_not_met');
  });

  test("claimDraw fails when it is not the player's turn", () => {
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1); // white
    g.addPlayer(ws2); // black
    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[0][4] = W_KING;
    g.board[0][0] = W_ROOK;
    g.board[7][4] = B_KING;
    g.turn = 'black'; // black's turn
    g.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };
    g.halfmoveClock = 100;

    const result = g.claimDraw(ws1); // white tries to claim
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'error.not_your_turn');
  });

  test('claimDraw fails when game is already over', () => {
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1);
    g.addPlayer(ws2);
    g.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    g.board[0][4] = W_KING;
    g.board[0][0] = W_ROOK;
    g.board[7][4] = B_KING;
    g.turn = 'white';
    g.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };
    g.halfmoveClock = 100;
    g.gameOver = true;

    const result = g.claimDraw(ws1);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'error.game_already_over');
  });

  test('pawn move resets clock below 100', () => {
    const { game, white } = makeGame();
    game.halfmoveClock = 99;
    game.tryMove(white, 4, 1, 4, 3); // e2-e4
    assert.strictEqual(game.halfmoveClock, 0, 'pawn move resets clock');
    assert.strictEqual(game.canClaimDrawByFiftyMoves(), false);
  });

  test('checkmate at halfmoveClock 150 takes precedence over 75-move rule', () => {
    // Regression: the 75-move rule must not override checkmate.
    // Setup: white king on e1 trapped, black queen on e2 delivers checkmate.
    // halfmoveClock = 150 so the 75-move rule would also trigger.
    const g = new Game();
    const ws1 = {};
    const ws2 = {};
    g.addPlayer(ws1); // white
    g.addPlayer(ws2); // black

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
    g.halfmoveClock = 150; // 75-move rule would trigger

    // Black plays Qe2# — checkmate should win, not 75-move draw
    const result = g.tryMove(ws2, 4, 7, 4, 1); // Qe2#
    assert.strictEqual(result.ok, true);
    assert.strictEqual(g.gameOver, true);
    assert.ok(
      g.gameResult.startsWith('game.checkmate'),
      `expected checkmate, got: ${g.gameResult}`
    );
    assert.ok(
      !g.gameResult.startsWith('game.draw_75move'),
      `75-move rule must not override checkmate: ${g.gameResult}`
    );
  });
});

describe('Position history cap', () => {
  test('positionHistory prunes excess entries when exceeding cap', () => {
    const g = new Game();
    // Constructor already adds 1 entry. Push enough to exceed the cap.
    for (let i = 0; i < MAX_POSITION_HISTORY + 49; i++) {
      g.positionHistory.push({
        zobrist: `test-${i}`,
        halfmoveClock: 0,
        fullmoveNumber: 1,
        move: null,
      });
      g.positionCounts.set(`test-${i}`, 1);
    }
    // Total: 1 (constructor) + 549 = 550
    assert.strictEqual(g.positionHistory.length, MAX_POSITION_HISTORY + 50);
    // _recordPosition adds 1 (551), prunes all excess → back to 500
    g._recordPosition(null);
    assert.strictEqual(g.positionHistory.length, MAX_POSITION_HISTORY);
  });

  test('positionCounts decremented when entries are pruned', () => {
    const g = new Game();
    // Fill history with a repeating key so we can verify count decrements
    const key = 'repeated-key';
    for (let i = 0; i < MAX_POSITION_HISTORY + 9; i++) {
      g.positionHistory.push({
        zobrist: key,
        halfmoveClock: 0,
        fullmoveNumber: 1,
        move: null,
      });
      g.positionCounts.set(key, (g.positionCounts.get(key) || 0) + 1);
    }
    const countBefore = g.positionCounts.get(key);
    assert.strictEqual(countBefore, MAX_POSITION_HISTORY + 9);
    // Record one more — prunes 11 oldest entries (1 constructor key + 10 repeated-key)
    g._recordPosition(null);
    // 10 'repeated-key' entries were pruned, count decreased by 10
    assert.strictEqual(g.positionCounts.get(key), countBefore - 10);
    assert.strictEqual(g.positionHistory.length, MAX_POSITION_HISTORY);
  });

  test('positionCounts entry removed when count reaches zero', () => {
    const g = new Game();
    // Replace constructor's entry with our own unique key
    g.positionHistory = [];
    g.positionCounts = new Map();
    // Fill history with unique keys
    for (let i = 0; i < MAX_POSITION_HISTORY; i++) {
      g.positionHistory.push({
        zobrist: `unique-${i}`,
        halfmoveClock: 0,
        fullmoveNumber: 1,
        move: null,
      });
      g.positionCounts.set(`unique-${i}`, 1);
    }
    assert.strictEqual(g.positionCounts.size, MAX_POSITION_HISTORY);
    // Record one more — prunes oldest entry (unique-0)
    g._recordPosition(null);
    assert.ok(!g.positionCounts.has('unique-0'), 'Pruned entry should be removed from counts');
    assert.strictEqual(g.positionHistory.length, MAX_POSITION_HISTORY);
  });

  test('normal game play stays well within cap', () => {
    const { game, white, black } = makeGame();
    // Make a few moves — should not trigger the cap
    game.tryMove(white, 4, 1, 4, 3); // e4 (white pawn rank 1 → 3)
    game.tryMove(black, 4, 6, 4, 4); // e5 (black pawn rank 6 → 4)
    assert.strictEqual(game.positionHistory.length, 3); // start + 2 moves
    assert.ok(game.positionHistory.length < MAX_POSITION_HISTORY);
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
