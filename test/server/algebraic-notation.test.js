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
    assert.ok(
      g.gameResult.startsWith('game.checkmate'),
      `expected checkmate result: ${g.gameResult}`
    );
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
    assert.ok(g.gameResult.startsWith('game.checkmate'), `expected checkmate: ${g.gameResult}`);
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
