// ===========================================================
//  TEST SUITE -- Computer-player server integration
//  Covers S3: activateComputer validation, seat status, eviction,
//  disconnect, engine unavailable, skill changes, draw offers,
//  and stale-result guards -- all with a mock engine (no real Stockfish).
//  Run:  node test/server/computer_player.test.js
// ===========================================================

const assert = require('assert');

const { Game } = require('../../shared/chess');
const { setupWebSocketHandlers } = require('../../server');
const {
  resetStockfishEngine,
  setStockfishEngine,
  SKILL_DEFAULTS,
} = require('../../shared/stockfish_engine');

// -- Mock WebSocket ----------------------------------------

class MockWebSocket {
  constructor() {
    this.readyState = 1; // OPEN
    this.sentMessages = [];
    this._listeners = {};
    this._closed = false;
    this.bufferedAmount = 0;
  }

  send(data) {
    this.sentMessages.push(data);
  }

  getSent(type) {
    return this.sentMessages
      .filter((m) => {
        try {
          return JSON.parse(m).type === type;
        } catch {
          return false;
        }
      })
      .map((m) => JSON.parse(m));
  }

  getRawSent() {
    return this.sentMessages;
  }

  on(event, fn) {
    this._listeners[event] = fn;
  }

  emit(event, data) {
    if (this._listeners[event]) this._listeners[event](data);
  }

  close() {
    this.readyState = 3; // CLOSED
    this._closed = true;
    if (this._listeners.close) this._listeners.close();
  }
}

// -- Mock WebSocketServer ----------------------------------

class MockWebSocketServer {
  constructor() {
    this.clients = new Set();
    this._listeners = {};
  }

  on(event, fn) {
    this._listeners[event] = fn;
  }

  simulateConnection() {
    const ws = new MockWebSocket();
    this.clients.add(ws);
    if (this._listeners.connection) this._listeners.connection(ws);
    return ws;
  }

  simulateDisconnect(ws) {
    this.clients.delete(ws);
    ws.close();
  }
}

// -- Mock engine factory -----------------------------------
// Creates a mock engine that satisfies the interface used by server.js.
// All operations are synchronous (no real UCI delay).

function createMockEngine(opts = {}) {
  const {
    bestMove = 'e7e5',
    evaluation = 0,
    throwOnGetBestMove = null,
    throwOnSpawn = null,
  } = opts;

  let callCount = 0;

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
    getBestMove: async (fen, skill) => {
      callCount++;
      if (throwOnGetBestMove) throw throwOnGetBestMove;
      if (typeof bestMove === 'function') return bestMove(callCount);
      return bestMove;
    },
    getEvaluation: async () => evaluation,
    _enqueue: (fn) => fn(),
    kill: () => {},
    quit: async () => {},
    _getCallCount: () => callCount,
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
  if (opts.mockEngine !== false) {
    setStockfishEngine(opts.mockEngine || createMockEngine());
  }

  const game = opts.game || new Game();
  const wss = new MockWebSocketServer();
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

function getLastState(ws) {
  const states = ws.getSent('state');
  return states[states.length - 1];
}

// ===========================================================
//  TESTS: activateComputer validation rules
// ===========================================================

describe('activateComputer -- validation rules', () => {
  test('spectator cannot activate computer', () => {
    const { wss } = createEnv();
    const spec = joinAs(wss, 'spectator');
    spec.emit(
      'message',
      JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'beginner' })
    );
    const errors = spec.getSent('error');
    assert.ok(errors.length > 0, 'should receive an error');
    assert.ok(
      errors[0].reason.includes('seated'),
      `expected "seated" in reason, got: ${errors[0].reason}`
    );
  });

  test('non-seated client cannot activate computer', () => {
    const { wss } = createEnv();
    const ws = wss.simulateConnection();
    // Don't join -- just send activateComputer
    ws.emit(
      'message',
      JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'beginner' })
    );
    const errors = ws.getSent('error');
    assert.ok(errors.length > 0, 'should receive an error');
  });

  test('wrong color (own color) rejected', () => {
    const { wss } = createEnv();
    const ws = joinAs(wss, 'white');
    // White tries to activate computer as white (should be black)
    ws.emit(
      'message',
      JSON.stringify({ type: 'activateComputer', color: 'white', skill: 'beginner' })
    );
    const errors = ws.getSent('error');
    assert.ok(errors.length > 0, 'should receive an error');
    assert.ok(
      errors[0].reason.includes('Computer must play'),
      `expected "Computer must play", got: ${errors[0].reason}`
    );
  });

  test('invalid skill level rejected', () => {
    const { wss } = createEnv();
    const ws = joinAs(wss, 'white');
    ws.emit(
      'message',
      JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'supergrandmaster' })
    );
    const errors = ws.getSent('error');
    assert.ok(errors.length > 0, 'should receive an error');
    assert.ok(
      errors[0].reason.includes('Invalid skill'),
      `expected "Invalid skill", got: ${errors[0].reason}`
    );
  });

  test('seat not free (occupied by human) rejected', () => {
    const { wss } = createEnv();
    const ws1 = joinAs(wss, 'white');
    joinAs(wss, 'black'); // black seat is occupied
    ws1.emit(
      'message',
      JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'beginner' })
    );
    const errors = ws1.getSent('error');
    assert.ok(errors.length > 0, 'should receive an error');
    assert.ok(
      errors[0].reason.includes('not available'),
      `expected "not available", got: ${errors[0].reason}`
    );
  });

  test('game over rejected', () => {
    const { game, wss } = createEnv();
    const ws = joinAs(wss, 'white');
    game.gameOver = true;
    game.gameResult = 'Test over';
    ws.emit(
      'message',
      JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'beginner' })
    );
    const errors = ws.getSent('error');
    assert.ok(errors.length > 0, 'should receive an error');
    assert.ok(
      errors[0].reason.includes('Game is over'),
      `expected "Game is over", got: ${errors[0].reason}`
    );
  });

  test('computer player disabled rejected', () => {
    const { wss } = createEnv({ computerEnabled: false });
    const ws = joinAs(wss, 'white');
    ws.emit(
      'message',
      JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'beginner' })
    );
    const errors = ws.getSent('error');
    assert.ok(errors.length > 0, 'should receive an error');
    assert.ok(
      errors[0].reason.includes('disabled'),
      `expected "disabled", got: ${errors[0].reason}`
    );
  });

  test('successful activation broadcasts computerActivated and updates state', async () => {
    const { wss } = createEnv();
    const ws = joinAs(wss, 'white');
    ws.emit(
      'message',
      JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'beginner' })
    );

    // Wait for async activation
    await new Promise((resolve) => setTimeout(resolve, 100));

    const activated = ws.getSent('computerActivated');
    assert.strictEqual(activated.length, 1, 'should have computerActivated message');
    assert.strictEqual(activated[0].color, 'black');
    assert.strictEqual(activated[0].skill, 'beginner');

    // State should show computer seat
    const state = getLastState(ws);
    assert.strictEqual(state.seats.black.status, 'computer');
    assert.strictEqual(state.seats.black.skill, 'beginner');
    assert.deepStrictEqual(state.computerPlayer, { color: 'black', skill: 'beginner' });
  });
});

// ===========================================================
//  TESTS: computer seat status in state messages
// ===========================================================

describe('computer seat status -- state messages', () => {
  test('state shows computer seat with skill after activation', async () => {
    const { wss } = createEnv();
    const ws = joinAs(wss, 'white');
    ws.emit(
      'message',
      JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'master' })
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    const state = getLastState(ws);
    assert.strictEqual(state.seats.black.status, 'computer');
    assert.strictEqual(state.seats.black.skill, 'master');
  });

  test('state shows free seat after computer eviction (restart)', async () => {
    const { wss } = createEnv();
    const ws = joinAs(wss, 'white');
    ws.emit(
      'message',
      JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'beginner' })
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Restart evicts computer
    ws.emit('message', JSON.stringify({ type: 'restart' }));

    const state = getLastState(ws);
    assert.strictEqual(state.seats.black.status, 'free');
    assert.strictEqual(state.computerPlayer, null);
  });

  test('state shows free seat after computer eviction (FEN import)', async () => {
    const { wss } = createEnv();
    const ws = joinAs(wss, 'white');
    ws.emit(
      'message',
      JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'beginner' })
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    // FEN import evicts computer
    ws.emit(
      'message',
      JSON.stringify({
        type: 'importFen',
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      })
    );

    const state = getLastState(ws);
    assert.strictEqual(state.seats.black.status, 'free');
    assert.strictEqual(state.computerPlayer, null);
  });

  test('spectator receives computer seat status in state', async () => {
    const { wss } = createEnv();
    const wsWhite = joinAs(wss, 'white');
    const spec = joinAs(wss, 'spectator');

    wsWhite.emit(
      'message',
      JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'beginner' })
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    const state = getLastState(spec);
    assert.strictEqual(state.seats.black.status, 'computer');
    assert.strictEqual(state.seats.black.skill, 'beginner');
  });
});

// ===========================================================
//  TESTS: restart / FEN import eviction behavior
// ===========================================================

describe('eviction -- restart and FEN import', () => {
  test('restart evicts computer player and clears computerColor', async () => {
    const { wss, handlers } = createEnv();
    const ws = joinAs(wss, 'white');
    ws.emit(
      'message',
      JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'beginner' })
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify computer is active
    let state = getLastState(ws);
    assert.strictEqual(state.computerPlayer.color, 'black');

    // Restart
    ws.emit('message', JSON.stringify({ type: 'restart' }));

    state = getLastState(ws);
    assert.strictEqual(state.computerPlayer, null, 'computerPlayer should be null after restart');
    assert.strictEqual(state.seats.black.status, 'free', 'black seat should be free');
  });

  test('FEN import evicts computer player', async () => {
    const { wss } = createEnv();
    const ws = joinAs(wss, 'white');
    ws.emit(
      'message',
      JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'beginner' })
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify computer is active
    let state = getLastState(ws);
    assert.strictEqual(state.computerPlayer.color, 'black');

    // FEN import
    ws.emit(
      'message',
      JSON.stringify({
        type: 'importFen',
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      })
    );

    state = getLastState(ws);
    assert.strictEqual(
      state.computerPlayer,
      null,
      'computerPlayer should be null after FEN import'
    );
  });

  test('concede does not evict computer player', async () => {
    const { wss, game } = createEnv();
    const ws1 = joinAs(wss, 'white');
    ws1.emit(
      'message',
      JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'beginner' })
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Concede
    ws1.emit('message', JSON.stringify({ type: 'concede' }));

    const state = getLastState(ws1);
    // Computer player should still be listed (game is over, but computer not evicted)
    assert.ok(state.computerPlayer, 'computerPlayer should still be present after concede');
    assert.strictEqual(state.gameOver, true);
  });
});

// ===========================================================
//  TESTS: human disconnect while computer is seated
// ===========================================================

describe('human disconnect -- computer remains seated', () => {
  test('human disconnects, computer stays active, seat held for reconnect', async () => {
    const { wss } = createEnv();
    const ws = joinAs(wss, 'white');
    ws.emit(
      'message',
      JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'beginner' })
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Simulate human disconnect
    wss.simulateDisconnect(ws);

    // The computer seat should still be 'computer' in state to remaining clients
    // (no other clients in this test, but the internal state should be unchanged)
    // Verify via a new spectator joining
    const spec = joinAs(wss, 'spectator');
    const state = getLastState(spec);
    assert.strictEqual(state.seats.black.status, 'computer', 'computer seat should remain');
    // White seat should be held (disconnected)
    assert.strictEqual(state.seats.white.status, 'held', 'white seat should be held');
  });
});

// ===========================================================
//  TESTS: engine crash / unavailable behavior
// ===========================================================

describe('engine unavailable -- computerUnavailable broadcast', () => {
  test('engine returns "0000" (no legal moves) -> computerUnavailable', async () => {
    const mockEngine = createMockEngine({ bestMove: '0000' });
    const { wss } = createEnv({ mockEngine });

    const ws = joinAs(wss, 'white');
    ws.emit(
      'message',
      JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'beginner' })
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    // White makes a move to trigger computer's turn
    ws.emit(
      'message',
      JSON.stringify({ type: 'move', fromFile: 4, fromRank: 1, toFile: 4, toRank: 3 })
    );

    // Wait for async computer move
    await new Promise((resolve) => setTimeout(resolve, 800));

    const unavailable = ws.getSent('computerUnavailable');
    assert.strictEqual(unavailable.length, 1, 'should have computerUnavailable message');
    assert.strictEqual(unavailable[0].color, 'black');
    assert.ok(
      unavailable[0].reason.includes('invalid move') || unavailable[0].reason.includes('Invalid'),
      `reason should mention invalid move, got: ${unavailable[0].reason}`
    );
  });

  test('engine returns short move (< 4 chars) -> computerUnavailable', async () => {
    const mockEngine = createMockEngine({ bestMove: 'e2' });
    const { wss } = createEnv({ mockEngine });

    const ws = joinAs(wss, 'white');
    ws.emit(
      'message',
      JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'beginner' })
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    ws.emit(
      'message',
      JSON.stringify({ type: 'move', fromFile: 4, fromRank: 1, toFile: 4, toRank: 3 })
    );
    await new Promise((resolve) => setTimeout(resolve, 800));

    const unavailable = ws.getSent('computerUnavailable');
    assert.ok(unavailable.length >= 1, 'should have computerUnavailable message');
  });

  test('all retries fail -> computerUnavailable with "could not find" reason', async () => {
    // Engine always returns an illegal move (same square)
    const mockEngine = createMockEngine({ bestMove: 'e7e7' });
    const { wss } = createEnv({ mockEngine });

    const ws = joinAs(wss, 'white');
    ws.emit(
      'message',
      JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'beginner' })
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    ws.emit(
      'message',
      JSON.stringify({ type: 'move', fromFile: 4, fromRank: 1, toFile: 4, toRank: 3 })
    );
    // Wait for primary + 2 retries
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const unavailable = ws.getSent('computerUnavailable');
    assert.ok(unavailable.length >= 1, 'should have computerUnavailable after all retries fail');
    assert.ok(
      unavailable[0].reason.includes('could not find'),
      `reason should mention "could not find", got: ${unavailable[0].reason}`
    );
  });

  test('engine throws ENOENT -> computerUnavailable with "not found" reason', async () => {
    const mockEngine = createMockEngine({
      throwOnGetBestMove: Object.assign(new Error('Stockfish binary not found'), {
        code: 'ENOENT',
      }),
    });
    const { wss } = createEnv({ mockEngine });

    const ws = joinAs(wss, 'white');
    ws.emit(
      'message',
      JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'beginner' })
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    ws.emit(
      'message',
      JSON.stringify({ type: 'move', fromFile: 4, fromRank: 1, toFile: 4, toRank: 3 })
    );
    await new Promise((resolve) => setTimeout(resolve, 800));

    const unavailable = ws.getSent('computerUnavailable');
    assert.ok(unavailable.length >= 1, 'should have computerUnavailable');
    assert.ok(
      unavailable[0].reason.includes('not found'),
      `reason should mention "not found", got: ${unavailable[0].reason}`
    );
  });
});

// ===========================================================
//  TESTS: skill changes while computer is active
// ===========================================================

describe('changeSkill -- while computer is active', () => {
  test('valid skill change broadcasts computerSkillChanged', async () => {
    const { wss } = createEnv();
    const ws = joinAs(wss, 'white');
    ws.emit(
      'message',
      JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'beginner' })
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Change skill
    ws.emit('message', JSON.stringify({ type: 'changeSkill', skill: 'master' }));
    await new Promise((resolve) => setTimeout(resolve, 100));

    const changed = ws.getSent('computerSkillChanged');
    assert.strictEqual(changed.length, 1, 'should have computerSkillChanged message');
    assert.strictEqual(changed[0].color, 'black');
    assert.strictEqual(changed[0].skill, 'master');

    // State should reflect new skill
    const state = getLastState(ws);
    assert.strictEqual(state.seats.black.skill, 'master');
    assert.strictEqual(state.computerPlayer.skill, 'master');
  });

  test('invalid skill level rejected', async () => {
    const { wss } = createEnv();
    const ws = joinAs(wss, 'white');
    ws.emit(
      'message',
      JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'beginner' })
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    ws.emit('message', JSON.stringify({ type: 'changeSkill', skill: 'supergrandmaster' }));
    const errors = ws.getSent('error');
    assert.ok(errors.length > 0, 'should receive an error');
    assert.ok(errors[0].reason.includes('Invalid skill'));
  });

  test('no computer active -> error', () => {
    const { wss } = createEnv();
    const ws = joinAs(wss, 'white');
    ws.emit('message', JSON.stringify({ type: 'changeSkill', skill: 'master' }));
    const errors = ws.getSent('error');
    assert.ok(errors.length > 0, 'should receive an error');
    assert.ok(errors[0].reason.includes('No computer player'));
  });

  test('computer-color player cannot change skill (only human)', async () => {
    // This is a logical test: the human is white, computer is black.
    // A spectator cannot change skill.
    const { wss } = createEnv();
    const ws = joinAs(wss, 'white');
    ws.emit(
      'message',
      JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'beginner' })
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Spectator tries to change skill
    const spec = joinAs(wss, 'spectator');
    spec.emit('message', JSON.stringify({ type: 'changeSkill', skill: 'master' }));
    const errors = spec.getSent('error');
    assert.ok(errors.length > 0, 'spectator should receive an error');
    assert.ok(errors[0].reason.includes('Only the human player'));
  });
});

// ===========================================================
//  TESTS: draw offer handling against the computer
// ===========================================================

describe('draw offer -- against computer', () => {
  test('computer accepts draw when evaluation is within threshold', async () => {
    const mockEngine = createMockEngine({ evaluation: 10 }); // within +/-50
    const { wss, game } = createEnv({ mockEngine });

    const ws = joinAs(wss, 'white');
    ws.emit(
      'message',
      JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'beginner' })
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Offer draw
    ws.emit('message', JSON.stringify({ type: 'offerDraw' }));
    // Wait for async evaluation
    await new Promise((resolve) => setTimeout(resolve, 200));

    const drawResults = ws.getSent('drawResult');
    const accepted = drawResults.find((r) => r.accepted === true);
    assert.ok(accepted, 'should have an accepted draw result');
    assert.strictEqual(game.gameOver, true);
    assert.ok(game.gameResult.includes('Draw'));
  });

  test('computer declines draw when evaluation is outside threshold', async () => {
    const mockEngine = createMockEngine({ evaluation: 200 }); // outside +/-50
    const { wss, game } = createEnv({ mockEngine });

    const ws = joinAs(wss, 'white');
    ws.emit(
      'message',
      JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'beginner' })
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Offer draw
    ws.emit('message', JSON.stringify({ type: 'offerDraw' }));
    await new Promise((resolve) => setTimeout(resolve, 200));

    const drawResults = ws.getSent('drawResult');
    const declined = drawResults.find((r) => r.accepted === false);
    assert.ok(declined, 'should have a declined draw result');
    assert.ok(
      declined.reason.includes('declined'),
      `reason should mention "declined", got: ${declined.reason}`
    );
    assert.strictEqual(game.gameOver, false, 'game should not be over');
  });

  test('draw offer with no opponent and no computer -> error', () => {
    const { wss } = createEnv();
    const ws = joinAs(wss, 'white');
    // No black player, no computer
    ws.emit('message', JSON.stringify({ type: 'offerDraw' }));
    const errors = ws.getSent('error');
    assert.ok(errors.length > 0, 'should receive an error');
    assert.ok(errors[0].reason.includes('No opponent'));
  });

  test('draw offer when game is over -> error', async () => {
    const { game, wss } = createEnv();
    const ws = joinAs(wss, 'white');
    game.gameOver = true;
    game.gameResult = 'Test';
    ws.emit('message', JSON.stringify({ type: 'offerDraw' }));
    const errors = ws.getSent('error');
    assert.ok(errors.length > 0, 'should receive an error');
    assert.ok(errors[0].reason.includes('already over'));
  });

  test('draw offer discarded when game ends during async evaluation', async () => {
    // Engine whose getEvaluation is delayed, simulating a slow Stockfish call
    let resolveEval;
    const mockEngine = createMockEngine({
      evaluation: 10, // within threshold — would accept if not for the race
      getBestMove: async () => 'e7e5',
    });
    // Override getEvaluation with a controllable promise
    mockEngine.getEvaluation = async () => {
      return new Promise((resolve) => {
        resolveEval = () => resolve(10);
      });
    };

    const { wss, game } = createEnv({ mockEngine });

    const ws = joinAs(wss, 'white');
    ws.emit(
      'message',
      JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'beginner' })
    );
    await new Promise((r) => setTimeout(r, 100));

    // Offer draw — this starts the async evaluation
    ws.emit('message', JSON.stringify({ type: 'offerDraw' }));

    // Game ends during evaluation (restart bumps revision)
    await new Promise((r) => setTimeout(r, 50));
    ws.emit('message', JSON.stringify({ type: 'restart' }));

    // Now resolve the evaluation
    resolveEval();
    await new Promise((r) => setTimeout(r, 200));

    // The draw must NOT have been applied — game was restarted
    assert.strictEqual(game.gameOver, false, 'game should not be over after restart');
    assert.strictEqual(game.gameResult, null, 'gameResult should be null');
  });
});

// ===========================================================
//  TESTS: stale engine results discarded (revision guard)
// ===========================================================

describe('stale engine results -- revision guard', () => {
  test('restart during thinking discards engine result', async () => {
    // Engine that takes a while to respond
    let resolveBestMove;
    const mockEngine = createMockEngine({
      bestMove: () =>
        new Promise((resolve) => {
          resolveBestMove = resolve;
        }),
    });
    const { wss, handlers } = createEnv({ mockEngine });

    const ws = joinAs(wss, 'white');
    ws.emit(
      'message',
      JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'beginner' })
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    // White makes a move to trigger computer thinking
    ws.emit(
      'message',
      JSON.stringify({ type: 'move', fromFile: 4, fromRank: 1, toFile: 4, toRank: 3 })
    );

    // Wait a bit for the engine call to start
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Restart while engine is thinking -- this bumps revision and evicts computer
    ws.emit('message', JSON.stringify({ type: 'restart' }));

    // Now resolve the engine's best move
    resolveBestMove('e7e5');

    // Wait for any async processing
    await new Promise((resolve) => setTimeout(resolve, 200));

    // The computer move should NOT have been applied (stale result discarded)
    const blackMoves = ws.getSent('move').filter((m) => m.color === 'black');
    assert.strictEqual(
      blackMoves.length,
      0,
      'stale computer move should be discarded after restart'
    );

    // Computer should be evicted
    const state = getLastState(ws);
    assert.strictEqual(state.computerPlayer, null, 'computer should be evicted after restart');
  });

  test('FEN import during thinking discards engine result', async () => {
    let resolveBestMove;
    const mockEngine = createMockEngine({
      bestMove: () =>
        new Promise((resolve) => {
          resolveBestMove = resolve;
        }),
    });
    const { wss } = createEnv({ mockEngine });

    const ws = joinAs(wss, 'white');
    ws.emit(
      'message',
      JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'beginner' })
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    // White makes a move to trigger computer thinking
    ws.emit(
      'message',
      JSON.stringify({ type: 'move', fromFile: 4, fromRank: 1, toFile: 4, toRank: 3 })
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    // FEN import while engine is thinking -- bumps revision and evicts computer
    ws.emit(
      'message',
      JSON.stringify({
        type: 'importFen',
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      })
    );

    // Resolve the engine's best move
    resolveBestMove('e7e5');

    await new Promise((resolve) => setTimeout(resolve, 200));

    // The computer move should NOT have been applied
    const blackMoves = ws.getSent('move').filter((m) => m.color === 'black');
    assert.strictEqual(
      blackMoves.length,
      0,
      'stale computer move should be discarded after FEN import'
    );

    const state = getLastState(ws);
    assert.strictEqual(state.computerPlayer, null, 'computer should be evicted after FEN import');
  });

  test('concede during thinking discards engine result and preserves game-over state', async () => {
    let resolveBestMove;
    const mockEngine = createMockEngine({
      bestMove: () =>
        new Promise((resolve) => {
          resolveBestMove = resolve;
        }),
    });
    const { wss, game } = createEnv({ mockEngine });

    const ws = joinAs(wss, 'white');
    ws.emit(
      'message',
      JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'beginner' })
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    // White makes a move to trigger computer thinking
    ws.emit(
      'message',
      JSON.stringify({ type: 'move', fromFile: 4, fromRank: 1, toFile: 4, toRank: 3 })
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Human concedes while engine is thinking -- bumps revision and sets gameOver
    ws.emit('message', JSON.stringify({ type: 'concede' }));

    // Verify game is over immediately after concede
    assert.strictEqual(game.gameOver, true, 'game should be over after concede');
    assert.ok(game.gameResult, 'gameResult should be set after concede');

    // Now resolve the stale engine best move
    resolveBestMove('e7e5');

    await new Promise((resolve) => setTimeout(resolve, 200));

    // The computer move should NOT have been applied (stale result discarded)
    const blackMoves = ws.getSent('move').filter((m) => m.color === 'black');
    assert.strictEqual(
      blackMoves.length,
      0,
      'stale computer move should be discarded after concede'
    );

    // Game-over state should remain intact
    assert.strictEqual(game.gameOver, true, 'game should still be over after stale result');
    assert.ok(game.gameResult, 'gameResult should still be set');
  });
});

// ===========================================================
//  TESTS: computerThinking broadcast
// ===========================================================

describe('computerThinking -- broadcast on computer turn', () => {
  test('computerThinking broadcast when computer starts thinking', async () => {
    const mockEngine = createMockEngine({ bestMove: 'e7e5' });
    const { wss } = createEnv({ mockEngine });

    const ws = joinAs(wss, 'white');
    ws.emit(
      'message',
      JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'beginner' })
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    // White makes a move to trigger computer's turn
    ws.emit(
      'message',
      JSON.stringify({ type: 'move', fromFile: 4, fromRank: 1, toFile: 4, toRank: 3 })
    );

    // Wait for computerThinking broadcast (sent before the move resolves)
    await new Promise((resolve) => setTimeout(resolve, 50));

    const thinking = ws.getSent('computerThinking');
    assert.ok(thinking.length >= 1, 'should have computerThinking message');
    assert.strictEqual(thinking[0].color, 'black');
  });
});

// -- Run ---------------------------------------------------

run().catch((err) => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
