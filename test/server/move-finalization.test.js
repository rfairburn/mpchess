// ===========================================================
//  TEST SUITE -- Unified completed-turn finalization (Phase 1B)
//  Covers the shared applyAndBroadcastMove / finishTurn refactor:
//    - normal live move broadcasts include the mover's color
//    - a live promotion stays pending until completePromotion succeeds
//    - the helper validates a supplied promotion before tryMove mutates
//    - a computer move whose attempts all fail does NOT finalize
//    - a successful computer move finalizes exactly once
//  All with a mock engine (no real Stockfish).
//  Run:  node test/server/move-finalization.test.js
// ===========================================================

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { Game } = require('../../shared/chess.mjs');
const { setupWebSocketHandlers } = require('../../server');
const {
  resetStockfishEngine,
  setStockfishEngine,
  SKILL_DEFAULTS,
} = require('../../shared/stockfish_engine');

const { createMockWebSocketServer } = require('./test-helpers');

// -- Mock engine factory -----------------------------------
// Tracks getEvaluation() calls so tests can assert how many times a
// completed turn was finalized: each finalization that schedules an
// evaluation results in exactly one getEvaluation() call.

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

const tick = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

function createEnv(opts = {}) {
  resetStockfishEngine();
  const mockEngine = opts.mockEngine || createMockEngine();
  setStockfishEngine(mockEngine);

  const game = opts.game || new Game();
  const wss = createMockWebSocketServer({ trackRaw: true });
  setupWebSocketHandlers(wss, game, {
    seatTimeout: opts.seatTimeout != null ? opts.seatTimeout : 100,
    joinTimeoutMs: 0,
    computerPlayer: { enabled: opts.computerEnabled !== false },
    minMoveDelay: opts.minMoveDelay != null ? opts.minMoveDelay : 0,
  });
  return { game, wss, mockEngine };
}

function joinAs(wss, color) {
  const ws = wss.simulateConnection();
  ws.emit('message', JSON.stringify({ type: 'join', color }));
  return ws;
}

function activateComputer(ws) {
  ws.emit(
    'message',
    JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'beginner' })
  );
}

function makeMove(ws, fromFile, fromRank, toFile, toRank) {
  ws.emit('message', JSON.stringify({ type: 'move', fromFile, fromRank, toFile, toRank }));
}

// ===========================================================
//  TESTS: normal live move broadcast
// ===========================================================

describe('normal live move -- broadcast shape', () => {
  test('move broadcast includes mover color and premove:false', () => {
    const { wss } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    makeMove(white, 4, 1, 4, 3); // e2e4

    // The move is broadcast to every client (including the mover).
    const whiteMoves = white.getSent('move');
    const blackMoves = black.getSent('move');
    assert.ok(whiteMoves.length >= 1, 'mover should receive the move broadcast');
    assert.ok(blackMoves.length >= 1, 'opponent should receive the move broadcast');

    const m = blackMoves[blackMoves.length - 1];
    assert.strictEqual(m.color, 'white', 'move broadcast should include the mover color');
    assert.strictEqual(m.premove, false, 'a live move should carry premove:false');
    assert.strictEqual(m.fromFile, 4);
    assert.strictEqual(m.fromRank, 1);
    assert.strictEqual(m.toFile, 4);
    assert.strictEqual(m.toRank, 3);
  });
});

// ===========================================================
//  TESTS: live promotion stays pending, then completes
// ===========================================================

describe('live promotion -- pending then completes', () => {
  test('promotion move defers finalization until completePromotion succeeds', async () => {
    const { wss, game, mockEngine } = createEnv({ computerEnabled: false });
    const white = joinAs(wss, 'white');
    joinAs(wss, 'black');

    // Position where white can promote: pawn on a7, kings out of the way.
    game.loadFromFen('8/P7/8/8/8/8/7k/K7 w - - 0 1');
    await tick(); // let the initial evaluation settle

    const evalCallsBefore = mockEngine._getEvalCalls();

    // White plays a7-a8 (a promotion)
    makeMove(white, 0, 6, 0, 7);

    // The move is broadcast and flagged as a promotion
    const moves = white.getSent('move');
    const promoMove = moves[moves.length - 1];
    assert.strictEqual(promoMove.promotion, true, 'move should be flagged as a promotion');
    assert.strictEqual(promoMove.color, 'white', 'promotion move should carry mover color');

    // No promotion message yet — the piece is still to be chosen
    assert.strictEqual(white.getSent('promotion').length, 0, 'no promotion message yet');

    // Promotion is pending: promotingPiece set, turn NOT flipped
    assert.ok(game.promotingPiece, 'promotingPiece should be set (pending)');
    assert.strictEqual(game.turn, 'white', 'turn should NOT have flipped yet');

    // Finalization is deferred: no evaluation scheduled while pending
    assert.strictEqual(
      mockEngine._getEvalCalls(),
      evalCallsBefore,
      'no evaluation should be scheduled while the promotion is pending'
    );

    // Now complete the promotion
    white.emit('message', JSON.stringify({ type: 'promotion', pieceType: 'queen' }));

    // The promotion is broadcast with the chosen piece and position
    const promos = white.getSent('promotion');
    assert.strictEqual(promos.length, 1, 'promotion message should be broadcast');
    assert.strictEqual(promos[0].pieceType, 'queen');
    assert.strictEqual(promos[0].color, 'white');
    assert.strictEqual(promos[0].file, 0);
    assert.strictEqual(promos[0].rank, 7);

    // Promotion completed: promotingPiece cleared, turn flipped
    assert.strictEqual(game.promotingPiece, null, 'promotingPiece should be cleared');
    assert.strictEqual(game.turn, 'black', 'turn should have flipped to black');

    // Finalization happened exactly once, now that the turn flipped
    assert.strictEqual(
      mockEngine._getEvalCalls(),
      evalCallsBefore + 1,
      'exactly one evaluation should be scheduled after the promotion completes'
    );
  });
});

// ===========================================================
//  TESTS: helper promotion validation (structural)
// ===========================================================

describe('applyAndBroadcastMove -- promotion validation', () => {
  test('supplied promotion is validated before tryMove can mutate (structural)', () => {
    // The premove protocol that would exercise this branch does not exist yet,
    // so pin the invariant structurally: the promotion enum check must appear
    // before the tryMove call inside applyAndBroadcastMove.
    const src = fs.readFileSync(path.join(__dirname, '../../server/ws-handlers.js'), 'utf8');
    const start = src.indexOf('function applyAndBroadcastMove(');
    assert.ok(start !== -1, 'applyAndBroadcastMove should exist');
    const end = src.indexOf('function finishTurn(', start);
    assert.ok(end !== -1, 'finishTurn should follow applyAndBroadcastMove');
    const body = src.slice(start, end);

    const validationIdx = body.indexOf("['queen', 'rook', 'bishop', 'knight'].includes(promotion)");
    const tryMoveIdx = body.indexOf('game.tryMove(');
    assert.ok(validationIdx !== -1, 'promotion enum validation should be present');
    assert.ok(tryMoveIdx !== -1, 'tryMove call should be present');
    assert.ok(
      validationIdx < tryMoveIdx,
      'promotion validation must occur before tryMove (an invalid value must not mutate the board)'
    );
  });
});

// ===========================================================
//  TESTS: computer move finalization
// ===========================================================

describe('computer move -- finalization', () => {
  test('failed computer attempts do not finalize (no evaluation scheduled)', async () => {
    // Engine always returns an illegal move (same square)
    const { wss, game, mockEngine } = createEnv({
      mockEngine: createMockEngine({ bestMove: 'e7e7' }),
    });
    const white = joinAs(wss, 'white');
    await tick(); // let the initial evaluation settle
    const evalCallsBefore = mockEngine._getEvalCalls();

    activateComputer(white);
    await tick(100); // let activation complete

    // White moves, handing the turn to the computer
    makeMove(white, 4, 1, 4, 3); // e2e4

    // Wait for the computer to try (and fail) primary + 2 retries
    await tick(500);

    // computerUnavailable should be broadcast
    const unavailable = white.getSent('computerUnavailable');
    assert.ok(unavailable.length >= 1, 'computerUnavailable should be broadcast');
    assert.strictEqual(unavailable[0].reason, 'error.engine_no_move');

    // No evaluation should have been scheduled — failed attempts do not finalize
    assert.strictEqual(
      mockEngine._getEvalCalls(),
      evalCallsBefore,
      'no evaluation should be scheduled after a failed computer move'
    );

    // The turn should still be the computer's — nothing changed
    assert.strictEqual(game.turn, 'black', 'turn should still be black (computer)');
  });

  test('successful computer move finalizes exactly once', async () => {
    const { wss, game, mockEngine } = createEnv({
      mockEngine: createMockEngine({ bestMove: 'e7e5' }),
    });
    const white = joinAs(wss, 'white');
    await tick(); // let the initial evaluation settle
    const evalCallsBefore = mockEngine._getEvalCalls();

    activateComputer(white);
    await tick(100); // let activation complete

    // White moves, handing the turn to the computer
    makeMove(white, 4, 1, 4, 3); // e2e4

    // Wait for the computer to make its move
    await tick(500);

    // The computer's move should be applied and broadcast exactly once
    const blackMoves = white.getSent('move').filter((m) => m.color === 'black');
    assert.strictEqual(blackMoves.length, 1, 'computer move should be broadcast once');

    // The turn should have flipped back to white
    assert.strictEqual(game.turn, 'white', 'turn should be white after the computer move');

    // Exactly one evaluation should have been scheduled (finalized once)
    assert.strictEqual(
      mockEngine._getEvalCalls(),
      evalCallsBefore + 1,
      'exactly one evaluation should be scheduled after the computer move'
    );
  });
});

// -- Run ---------------------------------------------------

run().catch((err) => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
