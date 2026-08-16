// ===========================================================
//  TEST SUITE -- Premove protocol, storage, and execution (Phase 1)
//  Core server behavior via raw WS messages:
//    - set private echo, replace
//    - cancel / idempotent / unauthorized no disclosure
//    - execute legal, discard illegal(captured)/check
//    - discard en-passant expiry (and positive EP execution)
//    - discard castling (rook captured / path attacked / king in check)
//    - late execute (turn already the sender's)
//    - promotion validation zero mutation (late, missing/invalid value)
//    - atomic stored promotion
//    - own-pending-promotion guard (no store/replace, no mutation)
//    - chained premoves drained by finishTurn
//    - owner-specific state / reconnect restore
//    - race ordering basics
//    - turn-flip race convergence (premove-first / move-first, incl. promotion)
//    - opponent promotion pending: stored, executes after completion
//    - opponent illegal move leaves premove pending
//    - failed late execute does not finalize
//    - game-over / own-promotion rejections preserve existing premoves
//    - stalemate / threefold: premove cleared or executed, draw rules as usual
//    - opponent move onto premove destination / promotion pawn captured
//    - set-time candidate limits (sliding line beyond a friendly blocker)
//    - permissive candidates enabled by opponent move (recapture / pin / vacate)
//    - forced completePromotion() failure restores all mutated state
//    - computer → premove → computer chaining + minMoveDelay after a premove
//      and after a human move
//  All with a mock engine (no real Stockfish).
//  Run:  node test/server/premove.test.js
// ===========================================================

const assert = require('assert');

const { Game, initZobrist } = require('../../shared/chess.mjs');
const { randomBytes } = require('node:crypto');
const { setupWebSocketHandlers } = require('../../server');

// Initialize Zobrist for tests (threefold-repetition coverage needs real
// position hashing; without it every position hashes to 0).
initZobrist(randomBytes);
const {
  resetStockfishEngine,
  setStockfishEngine,
  SKILL_DEFAULTS,
} = require('../../shared/stockfish_engine');

const { createMockWebSocketServer } = require('./test-helpers');

// -- Mock engine factory -----------------------------------

function createMockEngine(opts = {}) {
  const { bestMove = 'e7e5', evaluation = 0 } = opts;
  let evalCalls = 0;

  return {
    isReady: true,
    available: true,
    skills: { ...SKILL_DEFAULTS },
    _queue: [],
    _queueRunning: false,
    _spawnPromise: null,
    spawn: async () => {},
    setSkill: async () => {},
    getBestMove: async () => bestMove,
    getEvaluation: async () => {
      evalCalls++;
      return evaluation;
    },
    _enqueue: (fn) => fn(),
    kill: () => {},
    quit: async () => {},
    _getEvalCalls: () => evalCalls,
  };
}

// Mock engine that returns a queue of best moves (one per call), for
// computer re-entry / chaining tests where the computer must make several
// different moves.
function createQueuedMockEngine(moves, opts = {}) {
  const { evaluation = 0 } = opts;
  let moveIdx = 0;
  let evalCalls = 0;
  let bestMoveCalls = 0;

  return {
    isReady: true,
    available: true,
    skills: { ...SKILL_DEFAULTS },
    _queue: [],
    _queueRunning: false,
    _spawnPromise: null,
    spawn: async () => {},
    setSkill: async () => {},
    getBestMove: async () => {
      bestMoveCalls++;
      const m = moves[moveIdx] || moves[moves.length - 1];
      moveIdx++;
      return m;
    },
    getEvaluation: async () => {
      evalCalls++;
      return evaluation;
    },
    _enqueue: (fn) => fn(),
    kill: () => {},
    quit: async () => {},
    _getEvalCalls: () => evalCalls,
    _getBestMoveCalls: () => bestMoveCalls,
  };
}

// -- Test runner (sequential) ------------------------------

let passed = 0;
let failed = 0;
let total = 0;
const testQueue = [];
let currentDescribeLabel = null;

function test(name, fn) {
  total++;
  testQueue.push({ label: currentDescribeLabel, name, fn });
}

function describe(label, fn) {
  const prev = currentDescribeLabel;
  currentDescribeLabel = label;
  fn();
  currentDescribeLabel = prev;
}

async function run() {
  let lastLabel = null;
  for (const { label, name, fn } of testQueue) {
    if (label && label !== lastLabel) {
      console.log(`\n${label}`);
      lastLabel = label;
    }
    try {
      await fn();
      passed++;
      console.log(`  OK ${name}`);
    } catch (e) {
      failed++;
      console.log(`  XX ${name}`);
      console.log(`    ${e.message}`);
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

// -- Helpers -----------------------------------------------

function createEnv(opts = {}) {
  resetStockfishEngine();
  const mockEngine = opts.mockEngine || createMockEngine();
  setStockfishEngine(mockEngine);

  const game = opts.game || new Game();
  const wss = createMockWebSocketServer({ trackRaw: true });
  const handlers = setupWebSocketHandlers(wss, game, {
    seatTimeout: opts.seatTimeout != null ? opts.seatTimeout : 100,
    joinTimeoutMs: 0,
    computerPlayer: { enabled: opts.computerEnabled !== false },
    minMoveDelay: opts.minMoveDelay != null ? opts.minMoveDelay : 0,
  });
  return { game, wss, mockEngine, handlers };
}

// Force a fresh per-client state send and return it. Premove set/cancel send
// an echo (not a state), so tests that assert on state.premove use this to
// read the current per-client state (what the client would see next).
function stateOf(handlers, ws) {
  handlers.sendState(ws);
  return lastState(ws);
}

function joinAs(wss, color) {
  const ws = wss.simulateConnection();
  ws.emit('message', JSON.stringify({ type: 'join', color }));
  return ws;
}

function makeMove(ws, fromFile, fromRank, toFile, toRank) {
  ws.emit('message', JSON.stringify({ type: 'move', fromFile, fromRank, toFile, toRank }));
}

function sendPremove(ws, fromFile, fromRank, toFile, toRank, promotion) {
  const msg = { type: 'premove', fromFile, fromRank, toFile, toRank };
  if (promotion !== undefined) msg.promotion = promotion;
  ws.emit('message', JSON.stringify(msg));
}

function sendPremoveCancel(ws) {
  ws.emit('message', JSON.stringify({ type: 'premoveCancel' }));
}

// Last state message received by a client
function lastState(ws) {
  const states = ws.getSent('state');
  return states[states.length - 1];
}

const tick = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

function activateComputer(ws) {
  ws.emit(
    'message',
    JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'beginner' })
  );
}

// Wait until a move with the given color/toFile/toRank appears in the
// client's sent messages; return the wall-clock time (ms) it appeared.
async function waitForMove(ws, color, toFile, toRank, timeout = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const found = ws
      .getSent('move')
      .some((m) => m.color === color && m.toFile === toFile && m.toRank === toRank);
    if (found) return Date.now();
    await tick(10);
  }
  throw new Error(`Timed out waiting for ${color} move to ${toFile},${toRank}`);
}

// ===========================================================
//  TESTS: set / replace / private echo
// ===========================================================

describe('premove set -- private echo', () => {
  test('owner receives a private premove echo; opponent and spectator see nothing', () => {
    const { wss, handlers } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');
    const spec = joinAs(wss, 'spectator');

    // It is white's turn; black premoves a reply (d7d5).
    sendPremove(black, 3, 6, 3, 4);

    // Owner gets the confirmation echo
    const echoes = black.getSent('premove');
    assert.strictEqual(echoes.length, 1, 'owner should receive exactly one premove echo');
    assert.strictEqual(echoes[0].fromFile, 3);
    assert.strictEqual(echoes[0].fromRank, 6);
    assert.strictEqual(echoes[0].toFile, 3);
    assert.strictEqual(echoes[0].toRank, 4);
    assert.strictEqual(echoes[0].promotion, null, 'non-promotion premove normalizes to null');

    // No premove-specific message reaches opponent or spectator
    assert.strictEqual(white.getSent('premove').length, 0, 'opponent must not get the echo');
    assert.strictEqual(spec.getSent('premove').length, 0, 'spectator must not get the echo');
    assert.strictEqual(
      white.getSent('premoveCleared').length + white.getSent('premoveDiscarded').length,
      0,
      'opponent must not get any premove message'
    );

    // Per-client state: owner sees their own premove; others see null
    assert.deepStrictEqual(stateOf(handlers, black).premove, {
      fromFile: 3,
      fromRank: 6,
      toFile: 3,
      toRank: 4,
      promotion: null,
    });
    assert.strictEqual(
      stateOf(handlers, white).premove,
      null,
      'opponent state premove must be null'
    );
    assert.strictEqual(
      stateOf(handlers, spec).premove,
      null,
      'spectator state premove must be null'
    );
  });

  test('a new premove replaces the previous one (single premove per color)', () => {
    const { wss, handlers } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    sendPremove(black, 3, 6, 3, 4); // d7d5
    sendPremove(black, 5, 6, 5, 4); // f7f5 (replace)

    const echoes = black.getSent('premove');
    assert.strictEqual(echoes.length, 2, 'each set sends one echo');
    assert.strictEqual(echoes[1].fromFile, 5, 'second echo is the replacement');

    // State reflects only the latest premove
    assert.deepStrictEqual(stateOf(handlers, black).premove, {
      fromFile: 5,
      fromRank: 6,
      toFile: 5,
      toRank: 4,
      promotion: null,
    });
  });

  test('spectator and non-player premove are silent no-ops (no response, no state change)', () => {
    const { wss, handlers, game } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');
    const spec = joinAs(wss, 'spectator');
    const stranger = wss.simulateConnection(); // never joined

    sendPremove(spec, 3, 6, 3, 4);
    sendPremove(stranger, 3, 6, 3, 4);

    assert.strictEqual(spec.getSent('premove').length, 0, 'spectator gets no echo');
    assert.strictEqual(spec.getSent('error').length, 0, 'spectator gets no error');
    assert.strictEqual(stranger.getSent('premove').length, 0, 'non-player gets no echo');
    assert.strictEqual(stranger.getSent('error').length, 0, 'non-player gets no error');

    // No premove stored for either color
    assert.strictEqual(stateOf(handlers, white).premove, null);
    assert.strictEqual(stateOf(handlers, black).premove, null);
    // Board untouched
    assert.strictEqual(game.moveHistory.length, 0);
  });
});

// ===========================================================
//  TESTS: cancel
// ===========================================================

describe('premoveCancel', () => {
  test('cancel clears the owner premove and sends exactly one premoveCleared (no broadcast)', () => {
    const { wss, handlers } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');
    const spec = joinAs(wss, 'spectator');

    sendPremove(black, 3, 6, 3, 4);
    sendPremoveCancel(black);

    const cleared = black.getSent('premoveCleared');
    assert.strictEqual(cleared.length, 1, 'owner gets exactly one premoveCleared');
    assert.strictEqual(white.getSent('premoveCleared').length, 0, 'no broadcast to opponent');
    assert.strictEqual(spec.getSent('premoveCleared').length, 0, 'no broadcast to spectator');

    // State now shows null for the owner
    assert.strictEqual(stateOf(handlers, black).premove, null);
  });

  test('cancel is idempotent: cancelling with nothing pending sends nothing', () => {
    const { wss } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    sendPremoveCancel(black); // nothing pending
    assert.strictEqual(black.getSent('premoveCleared').length, 0, 'no message for empty cancel');
    assert.strictEqual(black.getSent('error').length, 0, 'no error for empty cancel');

    sendPremove(black, 3, 6, 3, 4);
    sendPremoveCancel(black);
    sendPremoveCancel(black); // second cancel — still nothing
    assert.strictEqual(black.getSent('premoveCleared').length, 1, 'only the real clear echoes');
  });

  test('unauthorized cancel (spectator / non-player) is a silent no-op with no disclosure', () => {
    const { wss, handlers } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');
    const spec = joinAs(wss, 'spectator');
    const stranger = wss.simulateConnection();

    // Black has a pending premove
    sendPremove(black, 3, 6, 3, 4);

    sendPremoveCancel(spec);
    sendPremoveCancel(stranger);

    // Senders receive nothing
    assert.strictEqual(spec.getSent('premoveCleared').length, 0);
    assert.strictEqual(spec.getSent('error').length, 0);
    assert.strictEqual(stranger.getSent('premoveCleared').length, 0);
    assert.strictEqual(stranger.getSent('error').length, 0);

    // Black's premove is untouched
    assert.deepStrictEqual(stateOf(handlers, black).premove, {
      fromFile: 3,
      fromRank: 6,
      toFile: 3,
      toRank: 4,
      promotion: null,
    });
    // No disclosure to anyone
    assert.strictEqual(white.getSent('premoveCleared').length, 0);
    assert.strictEqual(spec.getSent('premoveCleared').length, 0);
  });

  test('a player cannot cancel the opponent premove (sender color only)', () => {
    const { wss, handlers } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    sendPremove(black, 3, 6, 3, 4);
    sendPremoveCancel(white); // white cancels — only touches white's (empty) slot

    assert.strictEqual(white.getSent('premoveCleared').length, 0, 'white had nothing to clear');
    assert.deepStrictEqual(
      stateOf(handlers, black).premove,
      { fromFile: 3, fromRank: 6, toFile: 3, toRank: 4, promotion: null },
      'black premove must survive white cancel'
    );
  });
});

// ===========================================================
//  TESTS: execution (legal) and discard (illegal)
// ===========================================================

describe('premove execution', () => {
  test('stored legal premove executes on turn flip with premove:true and color', () => {
    const { wss, handlers, game } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    // Black premoves d7d5 (legal reply to e2e4)
    sendPremove(black, 3, 6, 3, 4);
    // White plays e2e4 — turn flips to black, premove should execute
    makeMove(white, 4, 1, 4, 3);

    // Both moves in history
    assert.strictEqual(game.moveHistory.length, 2, 'both moves should be in history');
    assert.strictEqual(game.turn, 'white', 'turn should end on white');

    // The executed premove broadcast carries premove:true and the mover color
    const blackMoves = white.getSent('move').filter((m) => m.color === 'black');
    assert.strictEqual(blackMoves.length, 1, 'black premove move broadcast once');
    assert.strictEqual(blackMoves[0].premove, true, 'executed premove carries premove:true');
    assert.strictEqual(blackMoves[0].fromFile, 3);
    assert.strictEqual(blackMoves[0].toRank, 4);

    // The live move is NOT flagged as a premove
    const whiteMoves = black.getSent('move').filter((m) => m.color === 'white');
    assert.strictEqual(whiteMoves[0].premove, false, 'live move carries premove:false');

    // Owner's premove is consumed (state shows null)
    assert.strictEqual(stateOf(handlers, black).premove, null, 'executed premove is consumed');
  });

  test('premove of a captured piece is discarded with premoveDiscarded', () => {
    const { wss, handlers, game } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    // Black rook a8, white rook a1, white to move, kings safe. Black
    // premoves Ra8-a5; white then captures the a8 rook, so the premove's
    // from-square no longer holds a black piece → discard.
    game.loadFromFen('r5k1/8/8/8/8/8/8/R3K2R w Q - 0 1');
    sendPremove(black, 0, 7, 0, 4); // Ra8a5
    makeMove(white, 0, 0, 0, 7); // Ra1xa8 (a-file is clear)

    // The premove's from-square (a8) now holds white's rook, so the premove
    // is discarded (the piece is no longer black's to move).
    const discarded = black.getSent('premoveDiscarded');
    assert.strictEqual(discarded.length, 1, 'black should receive premoveDiscarded');
    assert.strictEqual(discarded[0].reason, 'error.not_your_turn');

    // Only white's move is in history (the premove did not execute)
    assert.strictEqual(game.moveHistory.length, 1, 'premove should not have executed');
    assert.strictEqual(game.turn, 'black', 'turn should be black (white moved)');

    // Black's premove is consumed (cleared)
    assert.strictEqual(stateOf(handlers, black).premove, null, 'discarded premove is cleared');
  });

  test('premove that leaves own king in check is discarded', () => {
    const { wss, handlers, game } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    // Black king e8, black knight e7 (the only piece between the rook and the
    // king on the e-file), white rook e1, white king h1, white to move. Any
    // knight move off e7 exposes the king to check from the rook.
    game.loadFromFen('4k3/4n3/8/8/8/8/8/4R2K w - - 0 1');
    // Black premoves Ne7-c6 (e7c6). It is white's turn, so it is stored.
    sendPremove(black, 4, 6, 2, 5); // e7c6
    // White plays Kh1-g1 (doesn't affect the e-file; the rook stays on e1)
    makeMove(white, 7, 0, 6, 0); // Kg1

    // Black's premove e7c6 would leave the king in check from Re1 → discard
    const discarded = black.getSent('premoveDiscarded');
    assert.strictEqual(discarded.length, 1, 'black should receive premoveDiscarded');
    assert.strictEqual(discarded[0].reason, 'error.invalid_move');
    assert.strictEqual(game.moveHistory.length, 1, 'only white move in history');
    assert.strictEqual(game.turn, 'black', 'turn is black');
    assert.strictEqual(stateOf(handlers, black).premove, null, 'discarded premove cleared');
  });
});

// ===========================================================
//  TESTS: late execute (turn already the sender's)
// ===========================================================

describe('premove late execute', () => {
  test('premove arriving on the sender own turn executes immediately (premove:true)', () => {
    const { wss, handlers, game } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    // It is white's turn. White sends a premove (late click) e2e4.
    sendPremove(white, 4, 1, 4, 3);

    // It should execute immediately, not be stored
    assert.strictEqual(game.moveHistory.length, 1, 'move should have executed');
    assert.strictEqual(game.turn, 'black', 'turn should flip to black');

    const moves = black.getSent('move').filter((m) => m.color === 'white');
    assert.strictEqual(moves.length, 1, 'white move broadcast once');
    assert.strictEqual(moves[0].premove, true, 'late premove carries premove:true');

    // No premove echo (it executed, not stored)
    assert.strictEqual(white.getSent('premove').length, 0, 'no store echo for late execute');
    assert.strictEqual(stateOf(handlers, white).premove, null, 'no premove stored');
  });
});

// ===========================================================
//  TESTS: promotion validation (zero mutation)
// ===========================================================

describe('premove promotion validation', () => {
  test('late promotion premove with missing promotion value: zero mutation', () => {
    const { wss, game } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    // White pawn on a7, white to move (late premove scenario)
    game.loadFromFen('8/P7/8/8/8/8/8/K6k w - - 0 1');
    const boardBefore = JSON.stringify(game.board);
    const historyBefore = [...game.moveHistory];
    const halfmoveBefore = game.halfmoveClock;

    // White sends a promotion premove WITHOUT the promotion field
    sendPremove(white, 0, 6, 0, 7); // a7a8, no promotion

    // Rejected with error.invalid_move
    const errors = white.getSent('error');
    assert.strictEqual(errors.length, 1, 'should receive one error');
    assert.strictEqual(errors[0].reason, 'error.invalid_move');

    // Zero mutation
    assert.strictEqual(JSON.stringify(game.board), boardBefore, 'board unchanged');
    assert.deepStrictEqual(game.moveHistory, historyBefore, 'history unchanged');
    assert.strictEqual(game.turn, 'white', 'turn unchanged');
    assert.strictEqual(game.halfmoveClock, halfmoveBefore, 'halfmoveClock unchanged');
    assert.strictEqual(game.promotingPiece, null, 'no promotingPiece stranded');
    assert.strictEqual(white.getSent('move').length, 0, 'no move broadcast');
  });

  test('late promotion premove with invalid promotion value: zero mutation', () => {
    const { wss, game } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    game.loadFromFen('8/P7/8/8/8/8/8/K6k w - - 0 1');
    const boardBefore = JSON.stringify(game.board);
    const historyBefore = [...game.moveHistory];

    // White sends a promotion premove with an invalid piece type
    sendPremove(white, 0, 6, 0, 7, 'dragon');

    const errors = white.getSent('error');
    assert.strictEqual(errors.length, 1, 'should receive one error');
    assert.strictEqual(errors[0].reason, 'error.invalid_move');

    assert.strictEqual(JSON.stringify(game.board), boardBefore, 'board unchanged');
    assert.deepStrictEqual(game.moveHistory, historyBefore, 'history unchanged');
    assert.strictEqual(game.turn, 'white', 'turn unchanged');
    assert.strictEqual(game.promotingPiece, null, 'no promotingPiece stranded');
  });

  test('stored promotion premove missing promotion value is rejected at set time', () => {
    const { wss, handlers, game } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    // Black pawn a2, black king a8, white king d2, white to move.
    game.loadFromFen('k7/8/8/8/8/8/p2K4/8 w - - 0 1');
    // Black pawn a2 (0,1) promotes to a1 (0,0). Black premoves a2a1 WITHOUT
    // the promotion field → rejected at set time.
    sendPremove(black, 0, 1, 0, 0); // a2a1, no promotion

    const errors = black.getSent('error');
    assert.strictEqual(errors.length, 1, 'should receive one error');
    assert.strictEqual(errors[0].reason, 'error.invalid_move');
    assert.strictEqual(stateOf(handlers, black).premove, null, 'nothing stored');
  });
});

// ===========================================================
//  TESTS: atomic stored promotion
// ===========================================================

describe('premove atomic promotion', () => {
  test('stored promotion premove completes atomically on execution (no picker)', () => {
    const { wss, handlers, game } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    // Black pawn a2, black king a8, white king d2, white to move. Black
    // premoves a2a1=Q; white then moves, flipping the turn so the premove
    // executes and completes the promotion atomically.
    game.loadFromFen('k7/8/8/8/8/8/p2K4/8 w - - 0 1');
    sendPremove(black, 0, 1, 0, 0, 'queen');

    // Verify stored with promotion
    assert.deepStrictEqual(stateOf(handlers, black).premove, {
      fromFile: 0,
      fromRank: 1,
      toFile: 0,
      toRank: 0,
      promotion: 'queen',
    });

    // White plays Kd2-d1, flipping the turn to black
    makeMove(white, 3, 1, 3, 0); // Kd1

    // Black's premove should execute and complete the promotion atomically
    assert.strictEqual(game.promotingPiece, null, 'no pending promotion (atomic)');
    assert.strictEqual(game.turn, 'white', 'turn flipped back to white');

    // The move broadcast carries premove:true
    const blackMoves = white.getSent('move').filter((m) => m.color === 'black');
    assert.strictEqual(blackMoves.length, 1, 'black premove move broadcast once');
    assert.strictEqual(blackMoves[0].premove, true, 'carries premove:true');
    assert.strictEqual(blackMoves[0].promotion, true, 'flagged as promotion');

    // A promotion broadcast is sent with the chosen piece
    const promos = white.getSent('promotion');
    assert.strictEqual(promos.length, 1, 'promotion broadcast sent');
    assert.strictEqual(promos[0].pieceType, 'queen');
    assert.strictEqual(promos[0].color, 'black');
    assert.strictEqual(promos[0].file, 0);
    assert.strictEqual(promos[0].rank, 0);

    // The board has a black queen on a1
    assert.strictEqual(game.board[0][0], 11, 'black queen on a1 (11 = B_QUEEN)');
  });
});

// ===========================================================
//  TESTS: own-pending-promotion guard
// ===========================================================

describe('own-pending-promotion guard', () => {
  test('premove while own promotion is pending: rejected, no store/replace, no mutation', () => {
    const { wss, handlers, game } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    // White pawn on a7, white to move. White plays a7a8 (promotion, live).
    game.loadFromFen('8/P7/8/8/8/8/8/K6k w - - 0 1');
    makeMove(white, 0, 6, 0, 7); // a7a8 (promotion, pending)

    // Promotion is pending: promotingPiece set, turn still white
    assert.ok(game.promotingPiece, 'promotion should be pending');
    assert.strictEqual(game.turn, 'white', 'turn still white');

    const boardBefore = JSON.stringify(game.board);
    const historyBefore = [...game.moveHistory];

    // White sends a premove (late click) while own promotion is pending.
    // Ka1-b1 would otherwise be a valid candidate, so rule 3 (own pending
    // promotion) is the gate.
    sendPremove(white, 0, 0, 1, 0); // a1b1

    // Rejected with error.promotion_in_progress
    const errors = white.getSent('error');
    assert.strictEqual(errors.length, 1, 'should receive one error');
    assert.strictEqual(errors[0].reason, 'error.promotion_in_progress');

    // No mutation
    assert.strictEqual(JSON.stringify(game.board), boardBefore, 'board unchanged');
    assert.deepStrictEqual(game.moveHistory, historyBefore, 'history unchanged');
    assert.strictEqual(game.turn, 'white', 'turn unchanged');
    assert.ok(game.promotingPiece, 'promotingPiece still set');

    // No premove stored (the rejected premove is not stored)
    assert.strictEqual(stateOf(handlers, white).premove, null, 'no premove stored');
  });
});

// ===========================================================
//  TESTS: chained two-player premoves
// ===========================================================

describe('chained premoves', () => {
  test('white premove executes-now and finishTurn drains black stored premove', () => {
    const { wss, handlers, game } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    // Starting position, white to move. Black stores a premove (d7d5). It is
    // white's turn, so it is stored (not executed).
    sendPremove(black, 3, 6, 3, 4); // d7d5 (stored)
    // White stores a premove (e2e4). It is white's turn → execute-now (rule 8).
    // White's premove executes, flipping to black, and finishTurn drains
    // black's stored premove (d7d5).
    sendPremove(white, 4, 1, 4, 3); // e2e4 (execute-now)

    // Both premoves should have executed
    assert.strictEqual(game.moveHistory.length, 2, 'e4, d5 in history');
    assert.strictEqual(game.turn, 'white', 'turn ends on white');

    // Both move broadcasts carry premove:true
    const whitePremove = white.getSent('move').find((m) => m.color === 'white' && m.premove);
    const blackPremove = black.getSent('move').find((m) => m.color === 'black' && m.premove);
    assert.ok(whitePremove, 'white premove broadcast');
    assert.ok(blackPremove, 'black premove broadcast');
    assert.strictEqual(whitePremove.toRank, 3, 'white e4');
    assert.strictEqual(blackPremove.toRank, 4, 'black d5');

    // Both premoves consumed
    assert.strictEqual(stateOf(handlers, white).premove, null);
    assert.strictEqual(stateOf(handlers, black).premove, null);
  });
});

// ===========================================================
//  TESTS: owner-specific state / reconnect restore
// ===========================================================

describe('owner-specific state / reconnect', () => {
  test('state includes only the owner premove; reconnect restores it', () => {
    const { wss, handlers } = createEnv({ computerEnabled: false, seatTimeout: 5000 });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    // Black premoves d7d5
    sendPremove(black, 3, 6, 3, 4);

    // Black disconnects (seat held for seatTimeout). A raw disconnect does
    // NOT clear the premove.
    const token = black.getSent('joined')[0].token;
    wss.simulateDisconnect(black);

    // White's state still shows null premove (black's is private)
    assert.strictEqual(stateOf(handlers, white).premove, null, 'white state premove is null');

    // Black reconnects with the token
    const black2 = wss.simulateConnection();
    black2.emit('message', JSON.stringify({ type: 'reconnect', token }));

    // Black's premove is restored in their state
    const restored = lastState(black2);
    assert.deepStrictEqual(
      restored.premove,
      { fromFile: 3, fromRank: 6, toFile: 3, toRank: 4, promotion: null },
      'premove restored on reconnect'
    );

    // White still sees null
    assert.strictEqual(stateOf(handlers, white).premove, null, 'white still sees null');
  });
});

// ===========================================================
//  TESTS: race ordering basics
// ===========================================================

describe('race ordering', () => {
  test('premoveCancel before a later premove: cancel is a no-op, premove stored', () => {
    const { wss, handlers } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    // Cancel first (nothing pending) — no-op
    sendPremoveCancel(black);
    // Then set a premove — stored normally
    sendPremove(black, 3, 6, 3, 4);

    assert.strictEqual(black.getSent('premoveCleared').length, 0, 'no clear for empty cancel');
    assert.deepStrictEqual(
      stateOf(handlers, black).premove,
      {
        fromFile: 3,
        fromRank: 6,
        toFile: 3,
        toRank: 4,
        promotion: null,
      },
      'premove stored after the no-op cancel'
    );
  });

  test('premoveCancel after a premove: clears it', () => {
    const { wss, handlers } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    sendPremove(black, 3, 6, 3, 4);
    sendPremoveCancel(black);

    assert.strictEqual(black.getSent('premoveCleared').length, 1, 'cleared');
    assert.strictEqual(stateOf(handlers, black).premove, null, 'premove gone');
  });

  test('two rapid premoves: last message wins (replace)', () => {
    const { wss, handlers } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    sendPremove(black, 3, 6, 3, 4); // d7d5
    sendPremove(black, 5, 6, 5, 4); // f7f5 (last wins)

    assert.deepStrictEqual(
      stateOf(handlers, black).premove,
      {
        fromFile: 5,
        fromRank: 6,
        toFile: 5,
        toRank: 4,
        promotion: null,
      },
      'last premove wins'
    );
  });
});

// ===========================================================
//  TESTS: late execute -- failure does not finalize
// ===========================================================

describe('late execute -- failure does not finalize', () => {
  test('a late premove that fails at tryMove sends an error and does not finalize', async () => {
    const { wss, game, mockEngine } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');
    await tick(); // let the initial evaluation settle
    const evalCallsBefore = mockEngine._getEvalCalls();

    // White king e1, white rook d1 (pinned along the 1st rank by the black
    // rook on a1). White to move. The pinned rook's off-rank moves are
    // permissive premove candidates (no king-safety filter) but illegal at
    // execution (they leave the king in check).
    game.loadFromFen('7k/8/8/8/8/8/8/r2RK3 w - - 0 1');
    const boardBefore = JSON.stringify(game.board);
    const historyBefore = [...game.moveHistory];

    // White sends a late premove Rd1-d5 (passes the permissive candidate
    // check, but tryMove rejects it — it leaves the king in check).
    sendPremove(white, 3, 0, 3, 4); // d1d5

    const errors = white.getSent('error');
    assert.strictEqual(errors.length, 1, 'should receive one error');
    assert.strictEqual(errors[0].reason, 'error.invalid_move');

    // Zero mutation
    assert.strictEqual(JSON.stringify(game.board), boardBefore, 'board unchanged');
    assert.deepStrictEqual(game.moveHistory, historyBefore, 'history unchanged');
    assert.strictEqual(game.turn, 'white', 'turn unchanged');

    // No move broadcast, no finalization (no evaluation scheduled)
    assert.strictEqual(white.getSent('move').length, 0, 'no move broadcast');
    assert.strictEqual(
      mockEngine._getEvalCalls(),
      evalCallsBefore,
      'no evaluation should be scheduled (failed late premove does not finalize)'
    );
  });
});

// ===========================================================
//  TESTS: rejections preserve existing premoves
// ===========================================================

describe('rejections preserve existing premoves', () => {
  test('game-over rejection: concede clears the stored premove; new premove rejected', () => {
    const { wss, handlers, game } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    // Black stores a premove (d7d5). It's white's turn, so it is stored.
    sendPremove(black, 3, 6, 3, 4);

    // White concedes → game over. Concede is a terminal path that clears
    // both colors' premoves (lifecycle wiring, Phase 1D).
    white.emit('message', JSON.stringify({ type: 'concede' }));
    assert.strictEqual(game.gameOver, true, 'game should be over');

    // Black's premove was cleared (owner receives premoveCleared).
    assert.strictEqual(black.getSent('premoveCleared').length, 1, 'owner gets premoveCleared');
    assert.strictEqual(stateOf(handlers, black).premove, null, 'premove cleared on concede');

    // Black sends a new premove → rejected with error.game_over.
    sendPremove(black, 5, 6, 5, 4); // f7f5

    const errors = black.getSent('error');
    assert.strictEqual(errors.length, 1, 'should receive one error');
    assert.strictEqual(errors[0].reason, 'error.game_over');

    // Still nothing stored.
    assert.strictEqual(stateOf(handlers, black).premove, null, 'no premove stored after game over');
  });

  test('own-promotion rejection preserves the opponent stored premove', () => {
    const { wss, handlers, game } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    // White pawn a7 (can promote), black pawn d7 (can premove), white to move.
    game.loadFromFen('8/P2p4/8/8/8/8/8/K6k w - - 0 1');

    // Black stores a premove (d7d5). It's white's turn, so it is stored.
    sendPremove(black, 3, 6, 3, 4);

    // White plays a7a8 (a live promotion, pending). The turn does NOT flip
    // (promotion is pending), so finishTurn is deferred and black's premove
    // is not consumed.
    makeMove(white, 0, 6, 0, 7); // a7a8 (promotion, pending)
    assert.ok(game.promotingPiece, 'promotion should be pending');

    // White sends a premove (Ka1-b1) while own promotion is pending →
    // rejected with error.promotion_in_progress.
    sendPremove(white, 0, 0, 1, 0); // a1b1

    const errors = white.getSent('error');
    assert.strictEqual(errors.length, 1, 'should receive one error');
    assert.strictEqual(errors[0].reason, 'error.promotion_in_progress');

    // Black's premove (d7d5) is preserved; white's slot is empty (the
    // rejected premove is not stored).
    assert.deepStrictEqual(
      stateOf(handlers, black).premove,
      { fromFile: 3, fromRank: 6, toFile: 3, toRank: 4, promotion: null },
      'opponent premove must be preserved'
    );
    assert.strictEqual(stateOf(handlers, white).premove, null, 'no premove stored for white');
  });
});

// ===========================================================
//  TESTS: completePromotion failure restores state
// ===========================================================

describe('completePromotion failure -- state restore', () => {
  test('a forced completePromotion() failure restores all mutated state', async () => {
    const { wss, game, mockEngine } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');
    await tick(); // let the initial evaluation settle
    const evalCallsBefore = mockEngine._getEvalCalls();

    // White pawn a7, white to move (late premove scenario).
    game.loadFromFen('8/P7/8/8/8/8/8/K6k w - - 0 1');

    // Capture the full pre-move state.
    const boardBefore = JSON.stringify(game.board);
    const turnBefore = game.turn;
    const historyBefore = [...game.moveHistory];
    const halfmoveBefore = game.halfmoveClock;
    const fullmoveBefore = game.fullmoveNumber;
    const castlingBefore = { ...game.castlingRights };
    const capturedBefore = {
      white: [...game.capturedPieces.white],
      black: [...game.capturedPieces.black],
    };
    const posHistBefore = game.positionHistory.length;
    const posCountsBefore = game.positionCounts.size;
    const promotingBefore = game.promotingPiece;

    // Force completePromotion to fail (defensive invariant path).
    game.completePromotion = () => false;

    // White sends a late promotion premove (a7a8=Q). tryMove succeeds and
    // mutates the board, then completePromotion fails → the snapshot must be
    // restored.
    sendPremove(white, 0, 6, 0, 7, 'queen');

    // Rejected with error.invalid_move
    const errors = white.getSent('error');
    assert.strictEqual(errors.length, 1, 'should receive one error');
    assert.strictEqual(errors[0].reason, 'error.invalid_move');

    // All mutated state is restored
    assert.strictEqual(JSON.stringify(game.board), boardBefore, 'board restored');
    assert.strictEqual(game.turn, turnBefore, 'turn restored');
    assert.deepStrictEqual(game.moveHistory, historyBefore, 'history restored');
    assert.strictEqual(game.halfmoveClock, halfmoveBefore, 'halfmoveClock restored');
    assert.strictEqual(game.fullmoveNumber, fullmoveBefore, 'fullmoveNumber restored');
    assert.deepStrictEqual(game.castlingRights, castlingBefore, 'castlingRights restored');
    assert.deepStrictEqual(game.capturedPieces, capturedBefore, 'capturedPieces restored');
    assert.strictEqual(game.positionHistory.length, posHistBefore, 'positionHistory restored');
    assert.strictEqual(game.positionCounts.size, posCountsBefore, 'positionCounts restored');
    assert.strictEqual(game.promotingPiece, promotingBefore, 'promotingPiece restored (null)');

    // No move/promotion broadcast, no finalization
    assert.strictEqual(white.getSent('move').length, 0, 'no move broadcast');
    assert.strictEqual(white.getSent('promotion').length, 0, 'no promotion broadcast');
    assert.strictEqual(
      mockEngine._getEvalCalls(),
      evalCallsBefore,
      'no evaluation should be scheduled (no finalization)'
    );
  });
});

// ===========================================================
//  TESTS: computer premove interplay
// ===========================================================

describe('computer premove interplay', () => {
  test('computer → human premove → computer chaining re-enters exactly once', async () => {
    const { wss, game, mockEngine } = createEnv({
      mockEngine: createQueuedMockEngine(['e7e5', 'g8f6']),
    });
    const white = joinAs(wss, 'white');
    await tick(); // let the initial evaluation settle
    const evalCallsBefore = mockEngine._getEvalCalls();

    activateComputer(white);
    await tick(100); // let activation complete

    // White plays e2e4 (live move) → turn flips to the computer (black).
    makeMove(white, 4, 1, 4, 3); // e2e4

    // White stores a premove (Nf3). It's the computer's turn, so it is stored.
    sendPremove(white, 6, 0, 5, 2); // g1f3 (Nf3)

    // Wait for the computer to make both moves (e7e5, then g8f6 after the
    // premove flips the turn back to the computer).
    await tick(500);

    // Both computer moves and the premove are in history (4 moves total).
    assert.strictEqual(game.moveHistory.length, 4, 'e4, e5, Nf3, Nf6 in history');
    assert.strictEqual(game.turn, 'white', 'turn should end on white');

    // The premove was executed (broadcast with premove:true).
    const premoveMove = white
      .getSent('move')
      .find((m) => m.color === 'white' && m.premove && m.toFile === 5 && m.toRank === 2);
    assert.ok(premoveMove, 'white premove (Nf3) should be broadcast with premove:true');

    // The computer made exactly 2 moves (e7e5, g8f6) — no duplicate move.
    const blackMoves = white.getSent('move').filter((m) => m.color === 'black');
    assert.strictEqual(blackMoves.length, 2, 'computer should make exactly 2 moves');

    // The evaluation is scheduled exactly once (after the final computer move).
    assert.strictEqual(
      mockEngine._getEvalCalls(),
      evalCallsBefore + 1,
      'exactly one evaluation should be scheduled after the final computer move'
    );
  });

  test('a computer move following an executed premove is delayed by minMoveDelay', async () => {
    const minMoveDelay = 200;
    const { wss } = createEnv({
      mockEngine: createQueuedMockEngine(['e7e5', 'g8f6']),
      minMoveDelay,
    });
    const white = joinAs(wss, 'white');
    await tick(); // let the initial evaluation settle

    activateComputer(white);
    await tick(100); // let activation complete

    // White plays e2e4 (live move) → turn flips to the computer (black).
    makeMove(white, 4, 1, 4, 3); // e2e4

    // White stores a premove (Nf3). It's the computer's turn, so it is stored.
    sendPremove(white, 6, 0, 5, 2); // g1f3 (Nf3)

    // Wait for the premove (Nf3) to be broadcast (it executes when the
    // computer's first move is applied).
    const tPremove = await waitForMove(white, 'white', 5, 2);

    // Wait for the computer's second move (Nf6) to be broadcast.
    const tSecond = await waitForMove(white, 'black', 5, 5);

    // The second computer move must be delayed by ~minMoveDelay after the
    // premove was broadcast (noteMoveBroadcast runs before the premove's move
    // broadcast, so lastMoveTime is the premove's time).
    const gap = tSecond - tPremove;
    assert.ok(
      gap >= minMoveDelay - 50,
      `second computer move should be delayed by ~minMoveDelay after the premove (got ${gap}ms, expected >= ${minMoveDelay - 50}ms)`
    );
  });
});

// ===========================================================
//  TESTS: lifecycle cleanup (Phase 1D)
//  One regression per lifecycle-table row. Whole-game paths use
//  clearPremoves(); single-owner paths use clearPremove(color) and
//  must preserve the connected opponent's slot. Raw WS close must
//  NOT clear a held seat's premove.
// ===========================================================

describe('lifecycle cleanup -- whole-game clear (clearPremoves)', () => {
  test('restart clears a stored premove', () => {
    const { wss, handlers } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    sendPremove(black, 3, 6, 3, 4); // d7d5 (stored, white to move)
    assert.deepStrictEqual(
      stateOf(handlers, black).premove,
      { fromFile: 3, fromRank: 6, toFile: 3, toRank: 4, promotion: null },
      'premove stored'
    );

    white.emit('message', JSON.stringify({ type: 'restart' }));

    assert.strictEqual(black.getSent('premoveCleared').length, 1, 'owner gets premoveCleared');
    assert.strictEqual(stateOf(handlers, black).premove, null, 'premove cleared on restart');
  });

  test('importFen clears a stored premove', () => {
    const { wss, handlers } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    sendPremove(black, 3, 6, 3, 4); // d7d5 (stored, white to move)
    assert.deepStrictEqual(
      stateOf(handlers, black).premove,
      { fromFile: 3, fromRank: 6, toFile: 3, toRank: 4, promotion: null },
      'premove stored'
    );

    white.emit(
      'message',
      JSON.stringify({ type: 'importFen', fen: 'k7/8/8/8/8/8/8/K7 w - - 0 1' })
    );

    assert.strictEqual(black.getSent('premoveCleared').length, 1, 'owner gets premoveCleared');
    assert.strictEqual(stateOf(handlers, black).premove, null, 'premove cleared on FEN import');
  });

  test('both-disconnected timeout reset clears a stored premove (no stale execution)', async () => {
    const seatTimeout = 100;
    const { wss, handlers, game } = createEnv({ computerEnabled: false, seatTimeout });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    sendPremove(black, 3, 6, 3, 4); // d7d5 (stored, white to move)
    assert.deepStrictEqual(
      stateOf(handlers, black).premove,
      { fromFile: 3, fromRank: 6, toFile: 3, toRank: 4, promotion: null },
      'premove stored'
    );

    // Both disconnect → the both-disconnected timer starts (seatTimeout).
    wss.simulateDisconnect(white);
    wss.simulateDisconnect(black);
    await tick(seatTimeout + 100);

    // The game was reset (no moves) and the stale premove is gone.
    assert.strictEqual(game.moveHistory.length, 0, 'game reset (no moves)');

    // Two new players take the seats; the stale premove must not remain or execute.
    const white2 = joinAs(wss, 'white');
    const black2 = joinAs(wss, 'black');
    assert.strictEqual(stateOf(handlers, black2).premove, null, 'no stale premove for new black');

    makeMove(white2, 4, 1, 4, 3); // e2e4
    assert.strictEqual(
      game.moveHistory.length,
      1,
      'only e4 in history (stale premove did not execute)'
    );
  });

  test('draw accepted (async computer evaluation) clears a stored premove', async () => {
    // COUPLING NOTE: this test keeps the turn on the computer by having the
    // mock engine return an invalid move ("0000"), which relies on
    // executeComputerMove's invalid-move failure path (broadcast
    // computerUnavailable, turn stays on the computer, no revision bump). If
    // that failure handling changes, this test's premise breaks — update it
    // to drive the computer's turn to a completed state differently (e.g. a
    // queued engine that makes a move, then a second queued move after the
    // premove).
    const { wss, handlers, game } = createEnv({
      mockEngine: createMockEngine({ bestMove: '0000' }),
    });
    const white = joinAs(wss, 'white');
    // Do NOT join black as a human — the computer takes the black seat.
    activateComputer(white); // computer is black
    await tick(100);

    makeMove(white, 4, 1, 4, 3); // e2e4 → computer's turn (its move fails, stays black)
    sendPremove(white, 6, 0, 5, 2); // Nf3 → stored (it's the computer's turn)
    assert.deepStrictEqual(
      stateOf(handlers, white).premove,
      { fromFile: 6, fromRank: 0, toFile: 5, toRank: 2, promotion: null },
      'premove stored'
    );

    // White offers a draw → the computer accepts (eval 0) → gameOver → clearPremoves.
    white.emit('message', JSON.stringify({ type: 'offerDraw' }));
    await tick(50);

    assert.strictEqual(game.gameOver, true, 'game should be over (draw accepted)');
    assert.strictEqual(game.gameResult, 'game.draw_agreement');
    assert.strictEqual(white.getSent('premoveCleared').length, 1, 'owner gets premoveCleared');
    assert.strictEqual(stateOf(handlers, white).premove, null, 'premove cleared');
  });

  test('draw accepted (drawResponse) clears a stored premove', () => {
    const { wss, handlers, game } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    sendPremove(black, 3, 6, 3, 4); // d7d5 (stored, white to move)
    assert.deepStrictEqual(
      stateOf(handlers, black).premove,
      { fromFile: 3, fromRank: 6, toFile: 3, toRank: 4, promotion: null },
      'premove stored'
    );

    white.emit('message', JSON.stringify({ type: 'offerDraw' }));
    black.emit('message', JSON.stringify({ type: 'drawResponse', accepted: true }));

    assert.strictEqual(game.gameOver, true, 'game should be over (draw accepted)');
    assert.strictEqual(game.gameResult, 'game.draw_agreement');
    assert.strictEqual(black.getSent('premoveCleared').length, 1, 'owner gets premoveCleared');
    assert.strictEqual(stateOf(handlers, black).premove, null, 'premove cleared');
  });

  test('claimDraw clears a stored premove', () => {
    const { wss, handlers, game } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    // Position with halfmoveClock >= 100, white to move.
    game.loadFromFen('k7/8/8/8/8/8/8/K7 w - - 100 1');
    sendPremove(black, 0, 7, 0, 6); // Ka8-a7 (stored, white to move)
    assert.deepStrictEqual(
      stateOf(handlers, black).premove,
      { fromFile: 0, fromRank: 7, toFile: 0, toRank: 6, promotion: null },
      'premove stored'
    );

    white.emit('message', JSON.stringify({ type: 'claimDraw' }));

    assert.strictEqual(game.gameOver, true, 'game should be over (draw claimed)');
    assert.strictEqual(game.gameResult, 'game.draw_50move_claimed');
    assert.strictEqual(black.getSent('premoveCleared').length, 1, 'owner gets premoveCleared');
    assert.strictEqual(stateOf(handlers, black).premove, null, 'premove cleared');
  });

  test('move-induced game over (checkmate) clears a stored premove (no execution)', () => {
    const { wss, handlers, game } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    // Position where white delivers checkmate in one move (Ra8#).
    game.loadFromFen('4k3/3ppp2/8/8/8/8/5PPP/R6K w - - 0 1');
    sendPremove(black, 3, 6, 3, 4); // d7d5 (stored, white to move)
    assert.deepStrictEqual(
      stateOf(handlers, black).premove,
      { fromFile: 3, fromRank: 6, toFile: 3, toRank: 4, promotion: null },
      'premove stored'
    );

    makeMove(white, 0, 0, 0, 7); // Ra8# (a1a8) → checkmate → gameOver

    assert.strictEqual(game.gameOver, true, 'game should be over (checkmate)');
    // The gameOver guard in maybeExecutePremove clears the premove (no execution).
    assert.strictEqual(black.getSent('premoveCleared').length, 1, 'owner gets premoveCleared');
    assert.strictEqual(stateOf(handlers, black).premove, null, 'premove cleared');
    assert.strictEqual(game.moveHistory.length, 1, 'only Ra8 in history (premove did not execute)');
  });
});

describe('lifecycle cleanup -- single-owner clear (clearPremove)', () => {
  test('join reassignment (to spectator) clears the old color premove, preserves opponent', () => {
    const { wss, handlers, game } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    sendPremove(black, 3, 6, 3, 4); // d7d5 (stored, white to move)
    assert.deepStrictEqual(
      stateOf(handlers, black).premove,
      { fromFile: 3, fromRank: 6, toFile: 3, toRank: 4, promotion: null },
      'premove stored'
    );

    // Black changes away from black (to spectator).
    black.emit('message', JSON.stringify({ type: 'join', color: 'spectator' }));

    assert.strictEqual(black.getSent('premoveCleared').length, 1, 'owner gets premoveCleared');
    assert.strictEqual(
      white.getSent('premoveCleared').length,
      0,
      'opponent does NOT get premoveCleared (single-color scope)'
    );

    // A new occupant of black cannot execute the stale premove.
    const black2 = joinAs(wss, 'black');
    makeMove(white, 4, 1, 4, 3); // e2e4
    assert.strictEqual(
      game.moveHistory.length,
      1,
      'only e4 in history (stale premove did not execute)'
    );
    assert.strictEqual(stateOf(handlers, black2).premove, null, 'new black has no premove');
  });

  test('same-color rejoin preserves the premove (and it still executes)', () => {
    const { wss, handlers, game } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    sendPremove(black, 3, 6, 3, 4); // d7d5 (stored, white to move)

    // Black rejoins black (same color) — the premove must be preserved.
    black.emit('message', JSON.stringify({ type: 'join', color: 'black' }));

    assert.strictEqual(
      black.getSent('premoveCleared').length,
      0,
      'no premoveCleared on same-color rejoin'
    );
    assert.deepStrictEqual(
      stateOf(handlers, black).premove,
      { fromFile: 3, fromRank: 6, toFile: 3, toRank: 4, promotion: null },
      'premove preserved on same-color rejoin'
    );

    // The premove still executes when the turn arrives.
    makeMove(white, 4, 1, 4, 3); // e2e4
    assert.strictEqual(game.moveHistory.length, 2, 'e4 and d5 in history (premove executed)');
  });

  test('explicit leave clears the owner premove, preserves opponent', () => {
    const { wss, handlers, game } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    sendPremove(black, 3, 6, 3, 4); // d7d5 (stored, white to move)
    assert.deepStrictEqual(
      stateOf(handlers, black).premove,
      { fromFile: 3, fromRank: 6, toFile: 3, toRank: 4, promotion: null },
      'premove stored'
    );

    black.emit('message', JSON.stringify({ type: 'leave' }));

    assert.strictEqual(black.getSent('premoveCleared').length, 1, 'owner gets premoveCleared');
    assert.strictEqual(
      white.getSent('premoveCleared').length,
      0,
      'opponent does NOT get premoveCleared (single-color scope)'
    );

    // A new occupant of black cannot execute the stale premove.
    const black2 = joinAs(wss, 'black');
    makeMove(white, 4, 1, 4, 3); // e2e4
    assert.strictEqual(
      game.moveHistory.length,
      1,
      'only e4 in history (stale premove did not execute)'
    );
    assert.strictEqual(stateOf(handlers, black2).premove, null, 'new black has no premove');
  });

  test('permanent seat release clears the owner premove, preserves opponent', async () => {
    const seatTimeout = 100;
    const { wss, handlers, game } = createEnv({ computerEnabled: false, seatTimeout });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');
    const token = black.getSent('joined')[0].token;

    sendPremove(black, 3, 6, 3, 4); // d7d5 (stored, white to move)
    assert.deepStrictEqual(
      stateOf(handlers, black).premove,
      { fromFile: 3, fromRank: 6, toFile: 3, toRank: 4, promotion: null },
      'premove stored'
    );

    // Black disconnects (seat held). Wait for the seat timeout to elapse.
    wss.simulateDisconnect(black);
    await tick(seatTimeout + 50);

    // White drops black's seat → freeDisconnectedSeat → clearPremove('black').
    white.emit('message', JSON.stringify({ type: 'dropPlayer', token }));

    assert.strictEqual(
      white.getSent('premoveCleared').length,
      0,
      'opponent does NOT get premoveCleared (single-color scope)'
    );

    // A new occupant of black cannot execute the stale premove.
    const black2 = joinAs(wss, 'black');
    makeMove(white, 4, 1, 4, 3); // e2e4
    assert.strictEqual(
      game.moveHistory.length,
      1,
      'only e4 in history (stale premove did not execute)'
    );
    assert.strictEqual(stateOf(handlers, black2).premove, null, 'new black has no premove');
  });
});

describe('lifecycle cleanup -- disconnect semantics', () => {
  test('raw close does NOT clear a held seat premove; reconnect restores and it executes', async () => {
    const seatTimeout = 5000; // long hold window
    const { wss, handlers, game } = createEnv({ computerEnabled: false, seatTimeout });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');
    const token = black.getSent('joined')[0].token;

    sendPremove(black, 3, 6, 3, 4); // d7d5 (stored, white to move)

    // Black disconnects (raw close) — the premove is NOT cleared (seat held).
    wss.simulateDisconnect(black);

    // Black reconnects within the hold window.
    const black2 = wss.simulateConnection();
    black2.emit('message', JSON.stringify({ type: 'reconnect', token }));

    // The premove is restored in the reconnecting player's state.
    assert.deepStrictEqual(
      lastState(black2).premove,
      { fromFile: 3, fromRank: 6, toFile: 3, toRank: 4, promotion: null },
      'premove restored on reconnect'
    );

    // The premove still executes when the turn arrives.
    makeMove(white, 4, 1, 4, 3); // e2e4
    assert.strictEqual(
      game.moveHistory.length,
      2,
      'e4 and d5 in history (premove executed after reconnect)'
    );
  });

  test('execute-now consumes the sender slot (no stale premove remains)', () => {
    const { wss, handlers, game } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    // It's white's turn. White sends a premove (late) → executes immediately.
    sendPremove(white, 4, 1, 4, 3); // e2e4 (execute-now)

    assert.strictEqual(game.moveHistory.length, 1, 'e4 executed');
    assert.strictEqual(
      stateOf(handlers, white).premove,
      null,
      'sender slot consumed (no stale premove)'
    );
  });
});

// ===========================================================
//  TESTS: discard -- en passant expiry (§5 row 7)
// ===========================================================

describe('premove discard -- en passant expiry', () => {
  test('premove en-passant capture is discarded when the opponent does not push two squares', () => {
    const { wss, handlers, game } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    // White pawn e2, black pawn d4, white to move. Black premoves the
    // en-passant capture d4xe3 — only legal if white pushes e2e4 (which
    // sets the en-passant target).
    game.loadFromFen('4k3/8/8/8/3p4/8/4P3/4K3 w - - 0 1');
    sendPremove(black, 3, 3, 4, 2); // d4xe3 (EP-style capture, stored)

    // White plays a quiet king move — no two-square pawn push, so no
    // en-passant target exists at execution time.
    makeMove(white, 4, 0, 3, 0); // Ke1-d1

    const discarded = black.getSent('premoveDiscarded');
    assert.strictEqual(discarded.length, 1, 'black should receive premoveDiscarded');
    assert.strictEqual(discarded[0].reason, 'error.invalid_move');
    assert.strictEqual(game.moveHistory.length, 1, 'only Kd1 in history');
    assert.strictEqual(game.turn, 'black', 'turn is black');
    assert.strictEqual(stateOf(handlers, black).premove, null, 'discarded premove cleared');
  });

  test('premove en-passant capture executes when the opponent does push two squares', () => {
    const { wss, handlers, game } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    game.loadFromFen('4k3/8/8/8/3p4/8/4P3/4K3 w - - 0 1');
    sendPremove(black, 3, 3, 4, 2); // d4xe3 (EP-style capture, stored)

    // White pushes e2e4 — the en-passant target now exists, so the
    // premoved EP capture is legal at execution time.
    makeMove(white, 4, 1, 4, 3); // e2e4

    assert.strictEqual(game.moveHistory.length, 2, 'e4 and the EP capture in history');
    assert.strictEqual(game.turn, 'white', 'turn back on white');
    const blackMoves = white.getSent('move').filter((m) => m.color === 'black');
    assert.strictEqual(blackMoves.length, 1, 'black premove move broadcast once');
    assert.strictEqual(blackMoves[0].premove, true, 'executed premove carries premove:true');
    assert.strictEqual(blackMoves[0].enPassant, true, 'executed as an en-passant capture');
    assert.strictEqual(stateOf(handlers, black).premove, null, 'executed premove consumed');
  });
});

// ===========================================================
//  TESTS: discard -- castling (§5 row 7)
//  Rights/rook change, path-attacked, and king-in-check variants.
// ===========================================================

describe('premove discard -- castling', () => {
  test('premove castling is discarded when the rook is captured (rights revoked)', () => {
    const { wss, handlers, game } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    // Black king e8, black rook h8 (kingside right), white rook h1, white
    // king a1, white to move. Black premoves O-O; white captures the h8
    // rook, revoking the castling right.
    game.loadFromFen('4k2r/8/8/8/8/8/8/K6R w k - 0 1');
    sendPremove(black, 4, 7, 6, 7); // O-O (e8-g8, stored)

    makeMove(white, 7, 0, 7, 7); // Rh1xh8 (revokes the kingside right)

    const discarded = black.getSent('premoveDiscarded');
    assert.strictEqual(discarded.length, 1, 'black should receive premoveDiscarded');
    assert.strictEqual(discarded[0].reason, 'error.invalid_move');
    assert.strictEqual(game.castlingRights.bK, false, 'castling right revoked');
    assert.strictEqual(game.moveHistory.length, 1, 'only Rxh8 in history');
    assert.strictEqual(game.turn, 'black', 'turn is black');
    assert.strictEqual(stateOf(handlers, black).premove, null, 'discarded premove cleared');
  });

  test('premove castling is discarded when the path square is attacked', () => {
    const { wss, handlers, game } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    // Black king e8, black rook h8, white queen g4 (attacks g8), white king
    // e1, white to move. Black premoves O-O — storable (the permissive
    // candidate check skips king-safety) but illegal at execution because
    // the path square g8 is attacked.
    game.loadFromFen('4k2r/8/8/8/6Q1/8/8/4K3 w k - 0 1');
    sendPremove(black, 4, 7, 6, 7); // O-O (stored)

    makeMove(white, 4, 0, 3, 0); // Ke1-d1 (quiet move)

    const discarded = black.getSent('premoveDiscarded');
    assert.strictEqual(discarded.length, 1, 'black should receive premoveDiscarded');
    assert.strictEqual(discarded[0].reason, 'error.invalid_move');
    assert.strictEqual(game.moveHistory.length, 1, 'only Kd1 in history');
    assert.strictEqual(game.turn, 'black', 'turn is black');
    assert.strictEqual(stateOf(handlers, black).premove, null, 'discarded premove cleared');
  });

  test('premove castling is discarded when the king is in check', () => {
    const { wss, handlers, game } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    // Black king e8 (in check from the white rook e1), black rook h8, white
    // king g1, white to move. Black premoves O-O — storable (the permissive
    // candidate check skips king-safety) but illegal at execution because
    // the king is in check.
    game.loadFromFen('4k2r/8/8/8/8/8/8/4R1K1 w k - 0 1');
    sendPremove(black, 4, 7, 6, 7); // O-O (stored)

    makeMove(white, 6, 0, 5, 0); // Kg1-f1 (quiet move, check remains)

    const discarded = black.getSent('premoveDiscarded');
    assert.strictEqual(discarded.length, 1, 'black should receive premoveDiscarded');
    assert.strictEqual(discarded[0].reason, 'error.invalid_move');
    assert.strictEqual(game.moveHistory.length, 1, 'only Kf1 in history');
    assert.strictEqual(game.turn, 'black', 'turn is black');
    assert.strictEqual(stateOf(handlers, black).premove, null, 'discarded premove cleared');
  });
});

// ===========================================================
//  TESTS: turn-flip race convergence (§5 rows 1, 13)
//  Whichever message the server processes first, the outcome is the
//  same: the move plays exactly once, flagged as a premove.
// ===========================================================

describe('turn-flip race convergence', () => {
  test('turn-flip race: premove-first and move-first orderings converge', () => {
    const runOrdering = (premoveFirst) => {
      const { wss, handlers, game } = createEnv({ computerEnabled: false });
      const white = joinAs(wss, 'white');
      const black = joinAs(wss, 'black');
      const premoveMsg = () => sendPremove(black, 3, 6, 3, 4); // d7d5
      const moveMsg = () => makeMove(white, 4, 1, 4, 3); // e2e4
      if (premoveFirst) {
        premoveMsg();
        moveMsg();
      } else {
        moveMsg();
        premoveMsg();
      }
      return { game, handlers, white, black };
    };

    const a = runOrdering(true); // premove stored, then white's move drains it
    const b = runOrdering(false); // white's move first, then late premove executes now

    for (const [label, { game, handlers, white, black }] of [
      ['premove-first', a],
      ['move-first', b],
    ]) {
      assert.strictEqual(game.moveHistory.length, 2, `${label}: e4 and d5 in history`);
      assert.deepStrictEqual(game.moveHistory, ['e4', 'd5'], `${label}: same move order`);
      assert.strictEqual(game.turn, 'white', `${label}: turn back on white`);
      const blackMoves = white.getSent('move').filter((m) => m.color === 'black');
      assert.strictEqual(blackMoves.length, 1, `${label}: black move broadcast once`);
      assert.strictEqual(blackMoves[0].premove, true, `${label}: carries premove:true`);
      assert.strictEqual(black.getSent('premoveDiscarded').length, 0, `${label}: no discard`);
      assert.strictEqual(stateOf(handlers, black).premove, null, `${label}: premove slot consumed`);
    }

    // Both orderings converge to the identical board.
    assert.strictEqual(
      JSON.stringify(a.game.board),
      JSON.stringify(b.game.board),
      'boards converge across orderings'
    );
  });

  test('promotion turn-flip race: both orderings converge to atomic completion', () => {
    const runOrdering = (premoveFirst) => {
      const { wss, handlers, game } = createEnv({ computerEnabled: false });
      const white = joinAs(wss, 'white');
      const black = joinAs(wss, 'black');
      game.loadFromFen('k7/8/8/8/8/8/p2K4/8 w - - 0 1');
      const premoveMsg = () => sendPremove(black, 0, 1, 0, 0, 'queen'); // a2a1=Q
      const moveMsg = () => makeMove(white, 3, 1, 3, 0); // Kd2-d1
      if (premoveFirst) {
        premoveMsg();
        moveMsg();
      } else {
        moveMsg();
        premoveMsg();
      }
      return { game, handlers, white, black };
    };

    const a = runOrdering(true);
    const b = runOrdering(false);

    for (const [label, { game, handlers, white, black }] of [
      ['premove-first', a],
      ['move-first', b],
    ]) {
      assert.strictEqual(game.moveHistory.length, 2, `${label}: Kd1 and a1=Q in history`);
      assert.strictEqual(game.turn, 'white', `${label}: turn back on white`);
      assert.strictEqual(game.board[0][0], 11, `${label}: black queen on a1`);
      assert.strictEqual(game.promotingPiece, null, `${label}: no stranded promotingPiece`);
      const blackMoves = white.getSent('move').filter((m) => m.color === 'black');
      assert.strictEqual(blackMoves.length, 1, `${label}: black move broadcast once`);
      assert.strictEqual(blackMoves[0].premove, true, `${label}: carries premove:true`);
      assert.strictEqual(blackMoves[0].promotion, true, `${label}: flagged as promotion`);
      const promos = white.getSent('promotion');
      assert.strictEqual(promos.length, 1, `${label}: exactly one promotion broadcast`);
      assert.strictEqual(promos[0].pieceType, 'queen', `${label}: queen`);
      assert.strictEqual(promos[0].color, 'black', `${label}: black`);
      assert.strictEqual(black.getSent('premoveDiscarded').length, 0, `${label}: no discard`);
      assert.strictEqual(stateOf(handlers, black).premove, null, `${label}: premove slot consumed`);
    }

    // Both orderings converge to the identical final state.
    assert.strictEqual(
      JSON.stringify(a.game.board),
      JSON.stringify(b.game.board),
      'boards converge across orderings'
    );
    assert.deepStrictEqual(a.game.moveHistory, b.game.moveHistory, 'histories converge');
  });
});

// ===========================================================
//  TESTS: opponent promotion pending (§5 row 2)
// ===========================================================

describe('opponent promotion pending', () => {
  test('premove set while opponent promotion is pending: stored, executes after completion', () => {
    const { wss, handlers, game } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    // White pawn a7 (can promote), black pawn d7, white to move.
    game.loadFromFen('8/P2p4/8/8/8/8/8/K6k w - - 0 1');

    // White plays a7a8 (live promotion, pending). The turn does NOT flip.
    makeMove(white, 0, 6, 0, 7); // a7a8
    assert.ok(game.promotingPiece, 'promotion pending');
    assert.strictEqual(game.turn, 'white', 'turn still white');

    // Black stores a premove (d7d5) while white's promotion is pending.
    // Rule 3 only guards the SENDER's own pending promotion, so this is
    // stored normally.
    sendPremove(black, 3, 6, 3, 4); // d7d5
    assert.deepStrictEqual(
      stateOf(handlers, black).premove,
      { fromFile: 3, fromRank: 6, toFile: 3, toRank: 4, promotion: null },
      'premove stored while opponent promotion pending'
    );

    // White completes the promotion → turn flips → finishTurn drains the
    // premove.
    white.emit('message', JSON.stringify({ type: 'promotion', pieceType: 'queen' }));

    assert.strictEqual(game.promotingPiece, null, 'promotion completed');
    assert.strictEqual(game.moveHistory.length, 2, 'a8=Q and d5 in history');
    assert.strictEqual(game.turn, 'white', 'turn back on white');
    assert.strictEqual(game.board[7][0], 5, 'white queen on a8');

    const promos = black.getSent('promotion');
    assert.strictEqual(promos.length, 1, 'promotion broadcast sent');
    assert.strictEqual(promos[0].pieceType, 'queen');
    assert.strictEqual(promos[0].color, 'white');

    const blackMoves = white.getSent('move').filter((m) => m.color === 'black');
    assert.strictEqual(blackMoves.length, 1, 'black premove move broadcast once');
    assert.strictEqual(blackMoves[0].premove, true, 'carries premove:true');
    assert.strictEqual(stateOf(handlers, black).premove, null, 'premove consumed');
  });
});

// ===========================================================
//  TESTS: opponent rejected move (§5 row 3)
// ===========================================================

describe('opponent rejected move', () => {
  test('opponent illegal move leaves the premove pending (turn never flips)', () => {
    const { wss, handlers, game } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    // Black stores a premove (d7d5). It is white's turn, so it is stored.
    sendPremove(black, 3, 6, 3, 4); // d7d5

    // White sends an illegal move (three-square pawn push) → rejected.
    makeMove(white, 4, 1, 4, 4); // e2e5 (illegal)

    const errors = white.getSent('error');
    assert.strictEqual(errors.length, 1, 'white receives the rejection');
    assert.strictEqual(errors[0].reason, 'error.invalid_move');

    // The turn never flipped: the premove stays pending, untouched.
    assert.strictEqual(game.moveHistory.length, 0, 'no move applied');
    assert.strictEqual(game.turn, 'white', 'turn still white');
    assert.strictEqual(black.getSent('premoveDiscarded').length, 0, 'no discard');
    assert.strictEqual(black.getSent('premoveCleared').length, 0, 'no clear');
    assert.deepStrictEqual(
      stateOf(handlers, black).premove,
      { fromFile: 3, fromRank: 6, toFile: 3, toRank: 4, promotion: null },
      'premove still pending'
    );

    // A legal move still triggers the stored premove.
    makeMove(white, 4, 1, 4, 3); // e2e4
    assert.strictEqual(game.moveHistory.length, 2, 'e4 and d5 in history');
  });
});

// ===========================================================
//  TESTS: game over without move broadcast (§5 row 8)
//  Checkmate/concede/draw terminal paths are covered in the lifecycle
//  blocks; stalemate is the remaining move-induced terminal case.
// ===========================================================

describe('game over without move broadcast', () => {
  test('stalemate clears the premove with no move broadcast', () => {
    const { wss, handlers, game } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    // Black king a8, white king a5, white rook b1, white to move. Black
    // premoves Ka8-a7 (legal now). White's Ka5-a6 stalemates the black
    // king (a7/b7 covered by the king, b8 by the rook).
    game.loadFromFen('k7/8/8/K7/8/8/1R6/8 w - - 0 1');
    sendPremove(black, 0, 7, 0, 6); // Ka8-a7 (stored, white to move)

    makeMove(white, 0, 4, 0, 5); // Ka5-a6 → stalemate

    assert.strictEqual(game.gameOver, true, 'game over (stalemate)');
    assert.strictEqual(game.gameResult, 'game.stalemate');
    assert.strictEqual(black.getSent('premoveCleared').length, 1, 'owner gets premoveCleared');
    assert.strictEqual(stateOf(handlers, black).premove, null, 'premove cleared');
    assert.strictEqual(game.moveHistory.length, 1, 'only Ka6 in history (premove did not execute)');
    assert.strictEqual(
      black.getSent('move').filter((m) => m.color === 'black').length,
      0,
      'no black move broadcast (no unintended premove broadcast)'
    );
  });
});

// ===========================================================
//  TESTS: draw rules apply as usual (§5 row 11)
// ===========================================================

describe('draw rules apply as usual', () => {
  test('premove that completes a threefold repetition executes and ends the game by draw', () => {
    const { wss, handlers, game } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    // 1.Nf3 Nf6 2.Ng1 Ng8 3.Nf3 Nf6 — the initial position has now
    // occurred twice. Black premoves 4...Ng8; white's 4.Ng1 flips the turn
    // and the premove executes, making the initial position occur a third
    // time. The premove is a normal move: it executes, and the draw rules
    // apply as usual.
    makeMove(white, 6, 0, 5, 2); // Nf3
    makeMove(black, 6, 7, 5, 5); // Nf6
    makeMove(white, 5, 2, 6, 0); // Ng1
    makeMove(black, 5, 5, 6, 7); // Ng8
    makeMove(white, 6, 0, 5, 2); // Nf3
    makeMove(black, 6, 7, 5, 5); // Nf6

    sendPremove(black, 5, 5, 6, 7); // Ng8 (stored, white to move)
    makeMove(white, 5, 2, 6, 0); // Ng1 → turn flips → premove executes

    assert.strictEqual(game.moveHistory.length, 8, 'all eight moves in history');
    assert.strictEqual(game.gameOver, true, 'game over');
    assert.strictEqual(game.gameResult, 'game.draw_threefold', 'threefold repetition draw');

    const blackPremove = white.getSent('move').find((m) => m.color === 'black' && m.premove);
    assert.ok(blackPremove, 'premove executed (broadcast with premove:true)');
    assert.strictEqual(stateOf(handlers, black).premove, null, 'premove consumed');
  });
});

// ===========================================================
//  TESTS: opponent move onto premove destination (§5 row 14)
// ===========================================================

describe('opponent move onto premove destination', () => {
  test('opponent move ending on the premove destination square discards the premove', () => {
    const { wss, handlers, game } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    // Black pawn e7, white knight f3, white to move. Black premoves the
    // two-square push e7e5; white's Nf3e5 lands on the premove's
    // destination square.
    game.loadFromFen('k7/4p3/8/8/8/5N2/8/K7 w - - 0 1');
    sendPremove(black, 4, 6, 4, 4); // e7e5 (stored)

    makeMove(white, 5, 2, 4, 4); // Nf3e5 (ends on e5)

    const discarded = black.getSent('premoveDiscarded');
    assert.strictEqual(discarded.length, 1, 'black should receive premoveDiscarded');
    assert.strictEqual(discarded[0].reason, 'error.invalid_move');
    assert.strictEqual(game.moveHistory.length, 1, 'only Ne5 in history');
    assert.strictEqual(game.turn, 'black', 'turn is black');
    assert.strictEqual(stateOf(handlers, black).premove, null, 'discarded premove cleared');
  });
});

// ===========================================================
//  TESTS: promotion premove pawn captured (§5 row 15)
// ===========================================================

describe('promotion premove pawn captured', () => {
  test('promotion premove is discarded when the pawn is captured before the turn', () => {
    const { wss, handlers, game } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    // Black pawn a2 (can promote), white knight b4, white king e2, plus
    // rooks so the capture does not end the game by insufficient material.
    // White to move. Black premoves a2a1=Q; white captures the pawn.
    game.loadFromFen('k5r1/8/8/8/1N6/8/p3K3/6R1 w - - 0 1');
    sendPremove(black, 0, 1, 0, 0, 'queen'); // a2a1=Q (stored)

    makeMove(white, 1, 3, 0, 1); // Nb4xa2 (captures the pawn)

    const discarded = black.getSent('premoveDiscarded');
    assert.strictEqual(discarded.length, 1, 'black should receive premoveDiscarded');
    assert.strictEqual(discarded[0].reason, 'error.not_your_turn');
    assert.strictEqual(game.moveHistory.length, 1, 'only Nxa2 in history');
    assert.strictEqual(game.turn, 'black', 'turn is black');
    assert.strictEqual(game.promotingPiece, null, 'no promotion stranded');
    assert.strictEqual(stateOf(handlers, black).premove, null, 'discarded premove cleared');
  });
});

// ===========================================================
//  TESTS: set-time candidate limits (§5 row 20)
// ===========================================================

describe('set-time candidate limits', () => {
  test('premove beyond a friendly blocker on a sliding line is rejected at set time', () => {
    const { wss, handlers, game } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    // Black bishop e3, black pawn d4 (on the bishop's diagonal), white to
    // move. The slide stops at the friendly pawn: d4 (the blocker) is a
    // candidate, d5 (beyond it) is not — the opponent's single move cannot
    // unblock the line. (Known limitation, identical to lichess.)
    game.loadFromFen('k7/8/8/8/3p4/4b3/8/K7 w - - 0 1');
    sendPremove(black, 4, 2, 3, 4); // Be3-d5 (beyond the blocker)

    const errors = black.getSent('error');
    assert.strictEqual(errors.length, 1, 'rejected at set time');
    assert.strictEqual(errors[0].reason, 'error.invalid_move');
    assert.strictEqual(black.getSent('premove').length, 0, 'no echo');
    assert.strictEqual(stateOf(handlers, black).premove, null, 'nothing stored');
  });
});

// ===========================================================
//  TESTS: permissive candidates enabled by opponent move (§5 row 21)
//  Illegal now, legal after the opponent's single move: recapture onto a
//  friendly-occupied square, pin removed, pawn destination vacated.
// ===========================================================

describe('permissive candidates enabled by opponent move', () => {
  test('premoved recapture onto a friendly-occupied square executes after the opponent captures there', () => {
    const { wss, handlers, game } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    // Black pawns d5 and e4, white pawn f3, white to move. Black premoves
    // d5xe4 — the destination is currently occupied by a FRIENDLY pawn, so
    // the move is illegal now but is a permissive candidate. White's
    // f3xe4 leaves a white pawn on e4 to recapture.
    game.loadFromFen('k7/8/8/3p4/4p3/5P2/8/K7 w - - 0 1');
    sendPremove(black, 3, 4, 4, 3); // d5xe4 (stored)

    makeMove(white, 5, 2, 4, 3); // f3xe4

    assert.strictEqual(game.moveHistory.length, 2, 'fxe4 and dxe4 in history');
    assert.strictEqual(game.turn, 'white', 'turn back on white');
    const blackMoves = white.getSent('move').filter((m) => m.color === 'black');
    assert.strictEqual(blackMoves.length, 1, 'black premove move broadcast once');
    assert.strictEqual(blackMoves[0].premove, true, 'carries premove:true');
    assert.strictEqual(blackMoves[0].captured, true, 'executes as a capture');
    assert.strictEqual(game.board[3][4], 7, 'black pawn on e4 (the recapturing pawn)');
    assert.strictEqual(stateOf(handlers, black).premove, null, 'premove consumed');
  });

  test('premove of a pinned piece executes when the opponent move removes the pin', () => {
    const { wss, handlers, game } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    // White rook a8, black rook d8 (pinned along the 8th rank by the white
    // rook), black king e8, white king e1, white to move. Black premoves
    // Rd8-d5 — illegal now (leaves the king in check) but a permissive
    // candidate. White's Ra8-a1 removes the pin.
    game.loadFromFen('R2rk3/8/8/8/8/8/8/4K3 w - - 0 1');
    sendPremove(black, 3, 7, 3, 4); // Rd8-d5 (stored)

    makeMove(white, 0, 7, 0, 0); // Ra8-a1 (removes the pin)

    assert.strictEqual(game.moveHistory.length, 2, 'Ra1 and Rd5 in history');
    assert.strictEqual(game.turn, 'white', 'turn back on white');
    const blackMoves = white.getSent('move').filter((m) => m.color === 'black');
    assert.strictEqual(blackMoves.length, 1, 'black premove move broadcast once');
    assert.strictEqual(blackMoves[0].premove, true, 'carries premove:true');
    assert.strictEqual(stateOf(handlers, black).premove, null, 'premove consumed');
  });

  test('premove pawn push to an enemy-occupied square executes when the opponent vacates it', () => {
    const { wss, handlers, game } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    // Black pawn e5, white knight e4 (in front of the pawn), white to move.
    // Black premoves e5e4 — the destination is currently occupied by an
    // enemy piece, so the push is illegal now but a permissive candidate.
    // White's Ne4-g3 vacates e4.
    game.loadFromFen('k7/8/8/4p3/4N3/8/8/K7 w - - 0 1');
    sendPremove(black, 4, 4, 4, 3); // e5e4 (stored)

    makeMove(white, 4, 3, 6, 2); // Ne4-g3 (vacates e4)

    assert.strictEqual(game.moveHistory.length, 2, 'Ng3 and e4 in history');
    assert.strictEqual(game.turn, 'white', 'turn back on white');
    const blackMoves = white.getSent('move').filter((m) => m.color === 'black');
    assert.strictEqual(blackMoves.length, 1, 'black premove move broadcast once');
    assert.strictEqual(blackMoves[0].premove, true, 'carries premove:true');
    assert.strictEqual(game.board[3][4], 7, 'black pawn on e4');
    assert.strictEqual(stateOf(handlers, black).premove, null, 'premove consumed');
  });
});

// ===========================================================
//  TESTS: computer minMoveDelay after a human move (Phase 1 task 6)
//  The premove variant is covered in the computer interplay block; this is
//  the plain human-move half of the acceptance item.
// ===========================================================

describe('computer minMoveDelay after human move', () => {
  test('a computer move following a human move is delayed by minMoveDelay', async () => {
    const minMoveDelay = 200;
    const { wss } = createEnv({
      mockEngine: createMockEngine({ bestMove: 'e7e5' }),
      minMoveDelay,
    });
    const white = joinAs(wss, 'white');
    await tick(); // let the initial evaluation settle

    activateComputer(white);
    await tick(100); // let activation complete

    // White plays e2e4 (live move) → turn flips to the computer (black).
    // The mock engine responds instantly, but the broadcast must still be
    // delayed by minMoveDelay after the human move broadcast.
    makeMove(white, 4, 1, 4, 3); // e2e4

    const tHuman = await waitForMove(white, 'white', 4, 3);
    const tComputer = await waitForMove(white, 'black', 4, 4);

    const gap = tComputer - tHuman;
    assert.ok(
      gap >= minMoveDelay - 50,
      `computer move should be delayed by ~minMoveDelay after the human move (got ${gap}ms, expected >= ${minMoveDelay - 50}ms)`
    );
  });
});

// -- Run ---------------------------------------------------

run().catch((err) => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
