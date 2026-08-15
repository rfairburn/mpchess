// ===========================================================
//  TEST SUITE -- Evaluation bar (server-side)
//  Covers: evaluation broadcast after moves, state inclusion,
//  game-over reset, stale-result guards, engine-unavailable
//  degradation, and evaluation after restart/FEN import.
//  All with a mock engine (no real Stockfish).
//  Run:  node test/server/evaluation.test.js
// ===========================================================

const assert = require('assert');

const { Game } = require('../../shared/chess.mjs');
const { setupWebSocketHandlers } = require('../../server');
const {
  resetStockfishEngine,
  setStockfishEngine,
  SKILL_DEFAULTS,
} = require('../../shared/stockfish_engine');

const { createMockWebSocketServer } = require('./test-helpers');

// -- Mock engine factory -----------------------------------

function createMockEngine(opts = {}) {
  const { bestMove = 'e7e5', evaluation = 0, throwOnSpawn = null } = opts;

  return {
    isReady: true,
    available: true,
    skills: { ...SKILL_DEFAULTS },
    _queue: [],
    _queueRunning: false,
    _spawnPromise: null,
    spawn: async () => {
      if (throwOnSpawn) throw throwOnSpawn;
    },
    setSkill: async () => {},
    getBestMove: async () => bestMove,
    getEvaluation: async () => evaluation,
    _enqueue: (fn) => fn(),
    kill: () => {},
    quit: async () => {},
  };
}

/**
 * Mock engine whose first getEvaluation() call is deferred until
 * _resolveEval() is called, so tests can interleave a board change
 * while an evaluation is in flight.
 */
function createDeferredEvalEngine() {
  let resolveEval = null;
  let evalCalls = 0;
  const scores = [999, 50]; // score returned per call index

  return {
    isReady: true,
    available: true,
    skills: { ...SKILL_DEFAULTS },
    _queue: [],
    _queueRunning: false,
    _spawnPromise: null,
    spawn: async () => {},
    setSkill: async () => {},
    getBestMove: async () => 'e7e5',
    getEvaluation: async () => {
      evalCalls++;
      const idx = evalCalls - 1;
      if (idx === 0) {
        return new Promise((resolve) => {
          resolveEval = resolve;
        });
      }
      return scores[idx] ?? 0;
    },
    _enqueue: (fn) => fn(),
    kill: () => {},
    quit: async () => {},
    _resolveEval: (value) => resolveEval(value),
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
  setStockfishEngine(opts.mockEngine || createMockEngine());

  const game = opts.game || new Game();
  const wss = createMockWebSocketServer({ trackRaw: true });
  const handlers = setupWebSocketHandlers(wss, game, {
    seatTimeout: opts.seatTimeout != null ? opts.seatTimeout : 100,
    joinTimeoutMs: 0,
    computerPlayer: { enabled: opts.computerEnabled !== false },
  });
  return { game, wss, handlers };
}

function joinAs(wss, color) {
  const ws = wss.simulateConnection();
  ws.emit('message', JSON.stringify({ type: 'join', color }));
  return ws;
}

function makeMove(ws, fromFile, fromRank, toFile, toRank) {
  ws.emit('message', JSON.stringify({ type: 'move', fromFile, fromRank, toFile, toRank }));
}

// ===========================================================
//  TESTS
// ===========================================================

describe('evaluation -- broadcast after moves', () => {
  test('human move triggers evaluation broadcast', async () => {
    const mockEngine = createMockEngine({ evaluation: 150 });
    const { wss } = createEnv({ mockEngine });

    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');
    makeMove(white, 4, 1, 4, 3); // e2e4 → black to move
    await tick();

    const evals = white.getSent('evaluation');
    assert.strictEqual(evals.length, 1, 'white should receive one evaluation');
    // Engine score is side-to-move relative (mock: +150 for black) →
    // normalized to white perspective: -150
    assert.strictEqual(evals[0].score, -150);
    assert.ok(typeof evals[0].fen === 'string' && evals[0].fen.length > 0, 'fen included');

    // Black (the other client) receives it too
    const evalsBlack = black.getSent('evaluation');
    assert.strictEqual(evalsBlack.length, 1, 'black should receive the evaluation');
    assert.strictEqual(evalsBlack[0].score, -150);
  });

  test('computer move triggers evaluation broadcast', async () => {
    const mockEngine = createMockEngine({ evaluation: -220, bestMove: 'e7e5' });
    const { wss } = createEnv({ mockEngine });

    const white = joinAs(wss, 'white');
    white.emit(
      'message',
      JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'beginner' })
    );
    await tick(100);

    makeMove(white, 4, 1, 4, 3); // e2e4 → computer replies e7e5
    // Computer move is delayed by the 500ms minimum move delay
    await tick(900);

    const evals = white.getSent('evaluation');
    assert.ok(
      evals.length >= 2,
      `expected >=2 evaluations (human + computer move), got ${evals.length}`
    );
    // The last evaluation reflects the position after the computer's move
    assert.strictEqual(evals[evals.length - 1].score, -220);
  });

  test('restart triggers fresh evaluation', async () => {
    const mockEngine = createMockEngine({ evaluation: 300 });
    const { wss } = createEnv({ mockEngine });

    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');
    makeMove(white, 4, 1, 4, 3);
    await tick();

    white.emit('message', JSON.stringify({ type: 'restart' }));
    await tick();

    const evals = white.getSent('evaluation');
    assert.ok(evals.length >= 2, 'restart should trigger a new evaluation');
    assert.strictEqual(evals[evals.length - 1].score, 300);
    // FEN should be the starting position
    assert.ok(evals[evals.length - 1].fen.startsWith('rnbqkbnr/'), 'starting FEN after restart');
  });

  test('FEN import triggers fresh evaluation', async () => {
    const mockEngine = createMockEngine({ evaluation: 400 });
    const { wss } = createEnv({ mockEngine });

    const white = joinAs(wss, 'white');
    white.emit(
      'message',
      JSON.stringify({
        type: 'importFen',
        fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
      })
    );
    await tick();

    const evals = white.getSent('evaluation');
    assert.strictEqual(evals.length, 1, 'FEN import should trigger one evaluation');
    // Imported FEN is black to move → engine +400 (for black) flips to -400
    assert.strictEqual(evals[0].score, -400);
  });
});

describe('evaluation -- initial position', () => {
  test('connecting to a fresh position triggers initial evaluation', async () => {
    const mockEngine = createMockEngine({ evaluation: 42 });
    const { wss } = createEnv({ mockEngine });

    const ws = wss.simulateConnection();
    await tick();

    const evals = ws.getSent('evaluation');
    assert.strictEqual(evals.length, 1, 'initial evaluation broadcast on connect');
    assert.strictEqual(evals[0].score, 42);
    assert.ok(evals[0].fen.startsWith('rnbqkbnr/'), 'starting position FEN');
  });

  test('second connection does not re-evaluate an already-evaluated position', async () => {
    const mockEngine = createMockEngine({ evaluation: 42 });
    const { wss } = createEnv({ mockEngine });

    const first = wss.simulateConnection();
    await tick();
    const second = wss.simulateConnection();
    await tick();

    assert.strictEqual(first.getSent('evaluation').length, 1);
    // The second client gets the evaluation via its state message, not a
    // fresh engine call
    const states = second.getSent('state');
    assert.strictEqual(states[states.length - 1].evaluation, 42);
  });

  test('evaluation normalized to white perspective when black to move', async () => {
    const mockEngine = createMockEngine({ evaluation: 150 });
    const { wss } = createEnv({ mockEngine });

    const white = joinAs(wss, 'white');
    await tick(); // let the initial evaluation complete
    const black = joinAs(wss, 'black');
    makeMove(white, 4, 1, 4, 3); // e2e4 → black to move
    await tick();

    const evals = white.getSent('evaluation');
    // Initial position (white to move): engine +150 → white perspective +150
    assert.strictEqual(evals[0].score, 150);
    // After e2e4 (black to move): engine +150 is from black's perspective →
    // flipped to -150 from white's perspective
    assert.strictEqual(evals[evals.length - 1].score, -150);
  });
});

describe('evaluation -- state message inclusion', () => {
  test('new client receives latest evaluation in state', async () => {
    const mockEngine = createMockEngine({ evaluation: 150 });
    const { wss } = createEnv({ mockEngine });

    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');
    makeMove(white, 4, 1, 4, 3);
    await tick();

    // New connection should get the evaluation in its initial state
    const late = wss.simulateConnection();
    const states = late.getSent('state');
    assert.ok(states.length >= 1, 'late client should receive state');
    // Position is black to move → stored white-perspective value is -150
    assert.strictEqual(states[states.length - 1].evaluation, -150);
  });

  test('state evaluation is null before any evaluation', async () => {
    const { wss } = createEnv();
    const ws = wss.simulateConnection();
    const states = ws.getSent('state');
    assert.strictEqual(states[states.length - 1].evaluation, null);
  });
});

describe('evaluation -- game over reset', () => {
  test('concede resets evaluation to null', async () => {
    const mockEngine = createMockEngine({ evaluation: 150 });
    const { wss } = createEnv({ mockEngine });

    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');
    makeMove(white, 4, 1, 4, 3);
    await tick();
    assert.strictEqual(white.getSent('evaluation').length, 1);

    black.emit('message', JSON.stringify({ type: 'concede' }));
    await tick();

    const evals = white.getSent('evaluation');
    assert.strictEqual(evals.length, 2, 'concede should broadcast a reset evaluation');
    assert.strictEqual(evals[1].score, null);
  });

  test('no evaluation broadcast for moves after game over', async () => {
    const mockEngine = createMockEngine({ evaluation: 150 });
    const { wss } = createEnv({ mockEngine });

    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');
    makeMove(white, 4, 1, 4, 3);
    await tick();
    assert.strictEqual(white.getSent('evaluation').length, 1);

    black.emit('message', JSON.stringify({ type: 'concede' }));
    await tick();
    assert.strictEqual(white.getSent('evaluation').length, 2, 'game-over reset broadcast');

    // Any stray move is rejected (game over) — no further evaluation
    makeMove(white, 4, 1, 4, 3);
    await tick();
    assert.strictEqual(white.getSent('evaluation').length, 2, 'no evaluation after game over');
  });
});

describe('evaluation -- stale result guards', () => {
  test('stale evaluation is discarded when position changes mid-flight', async () => {
    const mockEngine = createDeferredEvalEngine();
    const { wss } = createEnv({ mockEngine });

    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');

    // Start an evaluation (deferred)
    makeMove(white, 4, 1, 4, 3); // e2e4
    await tick();
    assert.strictEqual(mockEngine._getEvalCalls(), 1, 'first evaluation in flight');

    // Change the position while the evaluation is in flight
    white.emit(
      'message',
      JSON.stringify({
        type: 'importFen',
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      })
    );
    await tick();

    // Resolve the stale evaluation — it must be discarded
    mockEngine._resolveEval(999);
    await tick(150);

    const evals = white.getSent('evaluation');
    // The stale 999 must NOT appear; the chained evaluation (score 50) must
    assert.ok(
      !evals.some((e) => e.score === 999),
      `stale evaluation 999 must be discarded, got: ${JSON.stringify(evals)}`
    );
    assert.ok(
      evals.some((e) => e.score === 50),
      `chained evaluation 50 expected, got: ${JSON.stringify(evals)}`
    );
  });
});

describe('evaluation -- engine unavailable', () => {
  test('spawn failure degrades gracefully (no evaluation, no crash)', async () => {
    const mockEngine = createMockEngine({ throwOnSpawn: new Error('no binary') });
    mockEngine.isReady = false;
    const { wss } = createEnv({ mockEngine });

    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');
    makeMove(white, 4, 1, 4, 3);
    await tick(100);

    assert.strictEqual(
      white.getSent('evaluation').length,
      0,
      'no evaluation when engine unavailable'
    );
    // No computerUnavailable either — that is computer-player specific
    assert.strictEqual(white.getSent('computerUnavailable').length, 0);
    // State still works
    const states = white.getSent('state');
    assert.strictEqual(states[states.length - 1].evaluation, null);
  });

  test('getEvaluation returning null keeps bar neutral', async () => {
    const mockEngine = createMockEngine({ evaluation: null });
    const { wss } = createEnv({ mockEngine });

    const white = joinAs(wss, 'white');
    const black = joinAs(wss, 'black');
    makeMove(white, 4, 1, 4, 3);
    await tick();

    const evals = white.getSent('evaluation');
    assert.strictEqual(evals.length, 1);
    assert.strictEqual(evals[0].score, null);
  });
});

run();
