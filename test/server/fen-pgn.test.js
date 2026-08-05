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
    g.gameResult = 'game.checkmate_white';
    const pgn = g.exportPgn();
    assert.ok(pgn.includes('[Result "1-0"]'));
  });

  test('PGN result after draw', () => {
    const g = new Game();
    g.gameOver = true;
    g.gameResult = 'game.draw_threefold';
    const pgn = g.exportPgn();
    assert.ok(pgn.includes('[Result "1/2-1/2"]'));
  });

  test('PGN strips =P placeholder during pending promotion', () => {
    const g = new Game();
    // White pawn on e7, black king on h8 — e8 is clear for promotion
    g.loadFromFen('7k/4P3/8/8/8/8/8/7K w - - 0 1');
    const ws1 = { _id: 'p1' };
    const ws2 = { _id: 'p2' };
    g.addPlayer(ws1); // white
    g.addPlayer(ws2); // black
    // Promote: pawn reaches rank 7, =P placeholder recorded
    g.tryMove(ws1, 4, 6, 4, 7); // e8 — promotes
    assert.ok(g.promotingPiece !== null, 'promotion should be pending');
    const pgn = g.exportPgn();
    assert.ok(!pgn.includes('=P'), 'PGN must not contain =P placeholder');
    assert.ok(pgn.includes('e8'), 'PGN must contain the pawn move without promotion suffix');
    // After completing promotion, PGN should show the actual piece
    g.completePromotion(ws1, 'queen');
    const pgn2 = g.exportPgn();
    assert.ok(pgn2.includes('e8=Q'), 'PGN must contain e8=Q after promotion');
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
