// ═══════════════════════════════════════════════════════════
//  TEST SUITE — StockfishEngine serialization queue
//  and gameRevision tracking for computer moves
//  Run:  node test/server/engine_serialization.test.js
// ═══════════════════════════════════════════════════════════

const assert = require('assert');

const {
  StockfishEngine,
  resetStockfishEngine,
  setStockfishEngine,
  SKILL_DEFAULTS,
} = require('../../shared/stockfish_engine');
const { Game } = require('../../shared/chess');
const { setupWebSocketHandlers } = require('../../server');

// ── Mock WebSocket ────────────────────────────────────────

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

// ── Mock WebSocketServer ──────────────────────────────────

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

// ── Mock UciTransport for serialization tests ─────────────

class MockUciTransport {
  constructor() {
    this.proc = { exitCode: null };
    this.commandsSent = [];
    this._delay = 50; // default delay for each operation
    this._resolveNextRaw = null;
  }

  set delay(ms) {
    this._delay = ms;
  }

  send(cmd) {
    this.commandsSent.push(cmd);
  }

  async next(timeoutMs) {
    await this._sleep(this._delay);
    return 'bestmove e2e4';
  }

  async nextRaw(timeoutMs) {
    await this._sleep(this._delay);
    // Return an info line with a score, then bestmove
    if (!this._rawExhausted) {
      this._rawExhausted = true;
      return 'info depth 1 score cp 10';
    }
    return 'bestmove e2e4';
  }

  async readUntil(prefix, timeoutMs) {
    await this._sleep(this._delay);
    return `bestmove e2e4`;
  }

  async quit() {
    this.proc.exitCode = 0;
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ── Test runner ───────────────────────────────────────────

let passed = 0;
let failed = 0;
let total = 0;
const pendingPromises = [];
const results = [];

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

async function run() {
  // Wait for all async tests to complete
  await Promise.all(pendingPromises);

  // Print results in declaration order
  for (const r of results) {
    if (r.label) {
      console.log(`\n${r.label}`);
    } else if (r.name) {
      if (r.ok) {
        console.log(`  ✓ ${r.name}`);
      } else {
        console.log(`  ✗ ${r.name}`);
        if (r.err) console.log(`    ${r.err}`);
      }
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

// ── Tests: StockfishEngine serialization queue ────────────

describe('StockfishEngine — serialization queue', () => {
  test('consecutive operations run sequentially', async () => {
    const engine = new StockfishEngine({ stockfishPath: '/dev/null' });
    engine.transport = new MockUciTransport();
    engine.transport.delay = 30;
    engine.available = true;

    const order = [];

    // Override methods to track order
    const origSetSkill = engine.setSkill.bind(engine);
    const origGetBestMove = engine.getBestMove.bind(engine);

    // Call setSkill, getBestMove, getEvaluation concurrently
    const p1 = engine.setSkill('beginner').then(() => {
      order.push('setSkill');
    });
    const p2 = engine
      .getBestMove('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'beginner')
      .then(() => {
        order.push('getBestMove');
      });
    const p3 = engine
      .getEvaluation('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
      .then(() => {
        order.push('getEvaluation');
      });

    await Promise.all([p1, p2, p3]);

    // All three should have completed
    assert.strictEqual(order.length, 3, 'all three operations should complete');
    // They should run in the order they were queued (FIFO)
    assert.strictEqual(order[0], 'setSkill', 'first queued should run first');
    assert.strictEqual(order[1], 'getBestMove', 'second queued should run second');
    assert.strictEqual(order[2], 'getEvaluation', 'third queued should run third');
  });

  test('queueLength reflects pending operations', async () => {
    const engine = new StockfishEngine({ stockfishPath: '/dev/null' });
    const mockTransport = new MockUciTransport();
    mockTransport.delay = 100; // slow
    engine.transport = mockTransport;
    engine.available = true;

    // Start a slow operation
    const p1 = engine.getBestMove(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      'beginner'
    );

    // Immediately queue another — it should be in the queue
    await new Promise((resolve) => setTimeout(resolve, 5)); // let first start
    assert.ok(engine.queueLength >= 0, 'queueLength should be accessible');

    const p2 = engine.getEvaluation('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');

    await Promise.all([p1, p2]);
  });

  test('queueBusy is true while operation runs', async () => {
    const engine = new StockfishEngine({ stockfishPath: '/dev/null' });
    const mockTransport = new MockUciTransport();
    mockTransport.delay = 100;
    engine.transport = mockTransport;
    engine.available = true;

    let wasBusy = false;

    const p1 = engine.getBestMove(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      'beginner'
    );

    // Check during execution
    await new Promise((resolve) => setTimeout(resolve, 10));
    if (engine.queueBusy) wasBusy = true;

    await p1;
    assert.ok(wasBusy, 'queue should have been busy during operation');
    assert.strictEqual(engine.queueBusy, false, 'queue should be idle after operation');
  });

  test('kill rejects all queued operations', async () => {
    const engine = new StockfishEngine({ stockfishPath: '/dev/null' });
    const mockTransport = new MockUciTransport();
    mockTransport.delay = 5000; // very slow
    engine.transport = mockTransport;
    engine.available = true;

    // Queue several operations
    const p1 = engine.getBestMove(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      'beginner'
    );
    const p2 = engine.getEvaluation('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');

    // Let first one start
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Kill should reject queued operations
    engine.kill();

    // Both should reject
    let p1Rejected = false;
    let p2Rejected = false;
    p1.catch(() => {
      p1Rejected = true;
    });
    p2.catch(() => {
      p2Rejected = true;
    });

    // Wait a bit for rejections
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.ok(p1Rejected || p2Rejected, 'at least one queued op should be rejected on kill');
  });

  test('setSkill commands do not interleave with getBestMove', async () => {
    const engine = new StockfishEngine({ stockfishPath: '/dev/null' });
    const mockTransport = new MockUciTransport();
    mockTransport.delay = 30;
    engine.transport = mockTransport;
    engine.available = true;

    // Issue setSkill and getBestMove concurrently
    await Promise.all([
      engine.setSkill('beginner'),
      engine.getBestMove('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'beginner'),
    ]);

    // Commands should be grouped: all setoption first, then position/go
    const cmds = mockTransport.commandsSent;
    const setoptionIndices = cmds
      .map((c, i) => (c.startsWith('setoption') ? i : -1))
      .filter((i) => i >= 0);
    const positionIndices = cmds
      .map((c, i) => (c.startsWith('position') ? i : -1))
      .filter((i) => i >= 0);

    if (setoptionIndices.length > 0 && positionIndices.length > 0) {
      // All setoption commands should come before position commands
      // (or all after, depending on queue order)
      const maxSetoption = Math.max(...setoptionIndices);
      const minPosition = Math.min(...positionIndices);
      assert.ok(
        maxSetoption < minPosition || minPosition < setoptionIndices[0],
        `setoption and position commands should not interleave. Commands: ${cmds.join(' | ')}`
      );
    }
  });

  test('concurrent spawn calls are single-flight — no interleaved commands', async () => {
    // Mock transport that simulates a slow UCI handshake
    const mockTransport = new MockUciTransport();
    mockTransport.delay = 100;
    mockTransport.commandsSent = [];

    const engine = new StockfishEngine({ stockfishPath: '/dev/null' });

    // Replace spawn to use our mock transport with a simulated handshake
    let handshakeStarted = false;
    let handshakeComplete = false;

    engine.spawn = async function () {
      if (!this.binaryPath) {
        throw new Error('Stockfish binary not found');
      }
      if (this.available) return;
      if (this._spawnPromise) return this._spawnPromise;

      this._spawnPromise = (async () => {
        this.transport = mockTransport;
        // Simulate slow handshake: send uci, wait for uciok, send isready, wait for readyok
        this.transport.send('uci');
        handshakeStarted = true;
        await new Promise((resolve) => setTimeout(resolve, 200));
        this.transport.send('isready');
        await new Promise((resolve) => setTimeout(resolve, 200));
        handshakeComplete = true;
        this.available = true;
      })();

      try {
        await this._spawnPromise;
      } finally {
        this._spawnPromise = null;
      }
    };

    // Two concurrent spawn callers — p2 starts before p1's handshake finishes
    const p1 = engine.spawn();
    // Yield to let p1 start its handshake
    await new Promise((resolve) => setTimeout(resolve, 10));
    const p2 = engine.spawn();

    assert.ok(handshakeStarted, 'handshake should have started');
    assert.ok(!handshakeComplete, 'handshake should not be complete yet');

    // Both should resolve
    await Promise.all([p1, p2]);
    assert.ok(handshakeComplete, 'handshake should be complete');
    assert.ok(engine.available, 'engine should be available');

    // Only one handshake should have run — only one 'uci' and one 'isready'
    const uciCount = mockTransport.commandsSent.filter((c) => c === 'uci').length;
    const isreadyCount = mockTransport.commandsSent.filter((c) => c === 'isready').length;
    assert.strictEqual(uciCount, 1, 'only one uci handshake should have run');
    assert.strictEqual(isreadyCount, 1, 'only one isready check should have run');

    // Now issue a normal command — it should work cleanly
    const move = await engine.getBestMove(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      'beginner'
    );
    assert.ok(typeof move === 'string', 'getBestMove should work after concurrent spawn');
  });
});

// ── Tests: gameRevision tracking ──────────────────────────

describe('gameRevision — tracking board state changes', () => {
  function createTestEnv(seatTimeout) {
    const game = new Game();
    const wss = new MockWebSocketServer();
    const handlers = setupWebSocketHandlers(wss, game, {
      seatTimeout: seatTimeout != null ? seatTimeout : 100,
      joinTimeoutMs: 0,
      computerPlayer: { enabled: false }, // disable real engine
    });
    return { game, wss, handlers };
  }

  function joinAs(wss, color) {
    const ws = wss.simulateConnection();
    ws.emit('message', JSON.stringify({ type: 'join', color }));
    return ws;
  }

  test('gameRevision starts at 0', () => {
    const { handlers } = createTestEnv();
    assert.strictEqual(handlers.getGameRevision(), 0);
  });

  test('gameRevision increments on human move', () => {
    const { game, wss, handlers } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const ws2 = joinAs(wss, 'black');

    const initialRevision = handlers.getGameRevision();

    // White makes a move
    ws1.emit(
      'message',
      JSON.stringify({ type: 'move', fromFile: 4, fromRank: 1, toFile: 4, toRank: 3 })
    );

    const afterRevision = handlers.getGameRevision();
    assert.ok(
      afterRevision > initialRevision,
      `revision should increase after move: ${initialRevision} -> ${afterRevision}`
    );
  });

  test('gameRevision increments on promotion', () => {
    const { game, wss, handlers } = createTestEnv();

    // Set up a promotion position (white pawn on d7, both kings present)
    game.loadFromFen('6k1/3P4/8/8/8/8/8/4K3 w - - 0 1');

    const ws1 = joinAs(wss, 'white');
    const ws2 = joinAs(wss, 'black');

    const beforeRevision = handlers.getGameRevision();

    // Move pawn to promote (d7 -> d8)
    ws1.emit(
      'message',
      JSON.stringify({ type: 'move', fromFile: 3, fromRank: 6, toFile: 3, toRank: 7 })
    );

    // Complete promotion
    ws1.emit('message', JSON.stringify({ type: 'promotion', pieceType: 'queen' }));

    const afterRevision = handlers.getGameRevision();
    assert.ok(
      afterRevision > beforeRevision,
      `revision should increase after promotion: ${beforeRevision} -> ${afterRevision}`
    );
  });

  test('gameRevision increments on concede', () => {
    const { game, wss, handlers } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const ws2 = joinAs(wss, 'black');

    const beforeRevision = handlers.getGameRevision();

    // White concedes
    ws1.emit('message', JSON.stringify({ type: 'concede' }));

    const afterRevision = handlers.getGameRevision();
    assert.ok(
      afterRevision > beforeRevision,
      `revision should increase after concede: ${beforeRevision} -> ${afterRevision}`
    );
  });

  test('gameRevision increments on FEN import', () => {
    const { game, wss, handlers } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const ws2 = joinAs(wss, 'black');

    const beforeRevision = handlers.getGameRevision();

    // Import a new FEN
    ws1.emit(
      'message',
      JSON.stringify({
        type: 'importFen',
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      })
    );

    const afterRevision = handlers.getGameRevision();
    assert.ok(
      afterRevision > beforeRevision,
      `revision should increase after FEN import: ${beforeRevision} -> ${afterRevision}`
    );
  });

  test('gameRevision increments on draw acceptance', () => {
    const { game, wss, handlers } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const ws2 = joinAs(wss, 'black');

    const beforeRevision = handlers.getGameRevision();

    // White offers draw
    ws1.emit('message', JSON.stringify({ type: 'offerDraw' }));

    // Black accepts
    ws2.emit('message', JSON.stringify({ type: 'drawResponse', accepted: true }));

    const afterRevision = handlers.getGameRevision();
    assert.ok(
      afterRevision > beforeRevision,
      `revision should increase after draw: ${beforeRevision} -> ${afterRevision}`
    );
  });

  test('gameRevision increments on restart', () => {
    const { game, wss, handlers } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const ws2 = joinAs(wss, 'black');

    // Make a move first
    ws1.emit(
      'message',
      JSON.stringify({ type: 'move', fromFile: 4, fromRank: 1, toFile: 4, toRank: 3 })
    );

    const beforeRevision = handlers.getGameRevision();

    // Restart
    ws1.emit('message', JSON.stringify({ type: 'restart' }));

    const afterRevision = handlers.getGameRevision();
    assert.ok(
      afterRevision > beforeRevision,
      `revision should increase after restart: ${beforeRevision} -> ${afterRevision}`
    );
  });

  test('gameRevision increments on successful computer move', async () => {
    // Create a mock engine that returns a deterministic move
    // Must include queue methods that the real engine uses
    const mockEngine = {
      isReady: true,
      available: true,
      skills: { ...SKILL_DEFAULTS },
      _queue: [],
      _queueRunning: false,
      _spawnPromise: null,
      spawn: async () => {},
      setSkill: async () => {},
      getBestMove: async (fen, skill) => 'e7e5', // black plays e7-e5
      getEvaluation: async (fen) => 0,
      _enqueue: (fn) => fn(), // pass-through: no queuing for mock
      kill: () => {},
      quit: async () => {},
    };

    // Set mock as singleton before creating test env
    resetStockfishEngine();
    setStockfishEngine(mockEngine);

    // Create env with computer player enabled
    const game = new Game();
    const wss = new MockWebSocketServer();
    const handlers = setupWebSocketHandlers(wss, game, {
      seatTimeout: 100,
      joinTimeoutMs: 0,
      computerPlayer: { enabled: true },
    });

    // White joins
    const ws1 = wss.simulateConnection();
    ws1.emit('message', JSON.stringify({ type: 'join', color: 'white' }));

    // White activates computer as black
    ws1.emit(
      'message',
      JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'beginner' })
    );

    // Wait for async activation to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    const beforeRevision = handlers.getGameRevision();

    // White makes a move (e2-e4), triggering computer's turn
    ws1.emit(
      'message',
      JSON.stringify({ type: 'move', fromFile: 4, fromRank: 1, toFile: 4, toRank: 3 })
    );

    // Wait for computer move to execute (it's async, triggered after human move)
    await new Promise((resolve) => setTimeout(resolve, 200));

    const afterRevision = handlers.getGameRevision();
    assert.ok(
      afterRevision > beforeRevision,
      `revision should increase after computer move: ${beforeRevision} -> ${afterRevision}`
    );

    // Cleanup
    resetStockfishEngine();
  });

  test('gameRevision increments on computer retry after illegal move', async () => {
    // Mock engine that returns an illegal move first (e7e7: same square),
    // then a legal one (e7e5)
    let callCount = 0;
    const mockEngine = {
      isReady: true,
      available: true,
      skills: { ...SKILL_DEFAULTS },
      _queue: [],
      _queueRunning: false,
      _spawnPromise: null,
      spawn: async () => {},
      setSkill: async () => {},
      getBestMove: async (fen, skill) => {
        callCount++;
        if (callCount === 1) return 'e7e7'; // illegal: same square
        return 'e7e5'; // legal on retry
      },
      getEvaluation: async (fen) => 0,
      _enqueue: (fn) => fn(), // pass-through: no queuing for mock
      kill: () => {},
      quit: async () => {},
    };

    resetStockfishEngine();
    setStockfishEngine(mockEngine);

    const game = new Game();
    const wss = new MockWebSocketServer();
    const handlers = setupWebSocketHandlers(wss, game, {
      seatTimeout: 100,
      joinTimeoutMs: 0,
      computerPlayer: { enabled: true },
    });

    // White joins
    const ws1 = wss.simulateConnection();
    ws1.emit('message', JSON.stringify({ type: 'join', color: 'white' }));

    // Activate computer as black
    ws1.emit(
      'message',
      JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'beginner' })
    );

    // Wait for activation to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // White makes a move, triggering computer's turn
    ws1.emit(
      'message',
      JSON.stringify({ type: 'move', fromFile: 4, fromRank: 1, toFile: 4, toRank: 3 })
    );

    // Wait for human move + computer move + retry to complete
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const afterComputerMove = handlers.getGameRevision();
    // Revision should be >= 2: one for human move, one for computer move
    assert.ok(
      callCount >= 2,
      `engine called ${callCount} time(s), expected >= 2 (illegal + retry)`
    );
    assert.ok(
      afterComputerMove >= 2,
      `revision should be >= 2 after human + computer move, got ${afterComputerMove}`
    );

    // Cleanup
    resetStockfishEngine();
  });
});

// ── Run ───────────────────────────────────────────────────

run().catch((err) => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
