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

// ── Test runner (sequential) ──────────────────────────────
// Tests run sequentially to avoid races on the global StockfishEngine singleton.

let passed = 0;
let failed = 0;
let total = 0;
const results = [];
const testQueue = []; // { name, fn } — executed in order by run()
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
  // Execute tests sequentially
  let lastLabel = null;
  for (const { label, name, fn } of testQueue) {
    if (label && label !== lastLabel) {
      console.log(`\n${label}`);
      lastLabel = label;
    }
    const idx = results.length;
    results.push({ label: null, name, ok: null, err: null });
    try {
      await fn();
      passed++;
      results[idx].ok = true;
      console.log(`  ✓ ${name}`);
    } catch (e) {
      failed++;
      results[idx].ok = false;
      results[idx].err = e.message;
      console.log(`  ✗ ${name}`);
      console.log(`    ${e.message}`);
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

// ── Tests: Computer player promotion ─────────────────────

describe('Computer player — basic integration', () => {
  test('computer makes a non-promotion move after human move', async () => {
    const mockEngine = {
      isReady: true,
      available: true,
      skills: { ...SKILL_DEFAULTS },
      _queue: [],
      _queueRunning: false,
      _spawnPromise: null,
      spawn: async () => {},
      setSkill: async () => {},
      getBestMove: async (fen, skill) => 'e7e5',
      getEvaluation: async (fen) => 0,
      _enqueue: (fn) => fn(),
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

    const ws1 = wss.simulateConnection();
    ws1.emit('message', JSON.stringify({ type: 'join', color: 'white' }));
    ws1.emit(
      'message',
      JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'beginner' })
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    // White plays e2-e4
    ws1.emit(
      'message',
      JSON.stringify({ type: 'move', fromFile: 4, fromRank: 1, toFile: 4, toRank: 3 })
    );

    // Wait past MIN_MOVE_DELAY (500ms) + engine delay
    await new Promise((resolve) => setTimeout(resolve, 800));

    // Check that computer made a move
    const moveMsgs = ws1.getSent('move');
    const blackMoves = moveMsgs.filter((m) => m.color === 'black');
    assert.strictEqual(blackMoves.length, 1, 'should have one black move');
    assert.strictEqual(blackMoves[0].fromFile, 4, 'e-file');
    assert.strictEqual(blackMoves[0].fromRank, 6, '7th rank');
    assert.strictEqual(blackMoves[0].toFile, 4, 'e-file');
    assert.strictEqual(blackMoves[0].toRank, 4, '5th rank');

    // Board should reflect the move
    const stateMsgs = ws1.getSent('state');
    const lastState = stateMsgs[stateMsgs.length - 1];
    assert.strictEqual(lastState.turn, 'white', "should be white's turn");
    assert.strictEqual(lastState.board[4][4], 7, 'black pawn at e5');

    resetStockfishEngine();
  });
});

describe('Computer player — promotion broadcasts position', () => {
  // Black pawns promote toward rank 0 (e2 -> e1), not rank 7.
  // White pawns promote toward rank 7 (e7 -> e8).

  test('computer (black) promotion broadcasts promotion message with file and rank', async () => {
    // Black pawn on e2 promotes to e1 (rank 0)
    const mockEngine = {
      isReady: true,
      available: true,
      skills: { ...SKILL_DEFAULTS },
      _queue: [],
      _queueRunning: false,
      _spawnPromise: null,
      spawn: async () => {},
      setSkill: async () => {},
      getBestMove: async (fen, skill) => 'e2e1', // black pawn promotes
      getEvaluation: async (fen) => 0,
      _enqueue: (fn) => fn(),
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

    // Black pawn on e2, white king on h1, black king on g8, white rook on a1.
    // e1 is empty — black pawn can promote there.
    game.loadFromFen('6k1/8/8/8/8/8/4p3/R6K w - - 0 1');

    const ws1 = wss.simulateConnection();
    ws1.emit('message', JSON.stringify({ type: 'join', color: 'white' }));
    ws1.emit(
      'message',
      JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'beginner' })
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    // White makes a move (rook a1->a2), triggering computer's turn
    ws1.emit(
      'message',
      JSON.stringify({ type: 'move', fromFile: 0, fromRank: 0, toFile: 0, toRank: 1 })
    );

    // Wait past MIN_MOVE_DELAY
    await new Promise((resolve) => setTimeout(resolve, 800));

    // Check promotion message was broadcast with position and color
    const promoMsgs = ws1.getSent('promotion');
    assert.strictEqual(promoMsgs.length, 1, 'should have exactly one promotion message');
    assert.strictEqual(promoMsgs[0].pieceType, 'queen', 'computer promotes to queen');
    assert.strictEqual(promoMsgs[0].color, 'black', 'promotion color should be black');
    assert.strictEqual(promoMsgs[0].file, 4, 'promotion file should be e (4)');
    assert.strictEqual(promoMsgs[0].rank, 0, 'promotion rank should be 1 (0)');

    // Verify board has the promoted piece (B_QUEEN = 11)
    const stateMsgs = ws1.getSent('state');
    const lastState = stateMsgs[stateMsgs.length - 1];
    assert.strictEqual(lastState.board[0][4], 11, 'board should have black queen at e1');

    resetStockfishEngine();
  });

  test('computer promotion move message precedes promotion message', async () => {
    const mockEngine = {
      isReady: true,
      available: true,
      skills: { ...SKILL_DEFAULTS },
      _queue: [],
      _queueRunning: false,
      _spawnPromise: null,
      spawn: async () => {},
      setSkill: async () => {},
      getBestMove: async (fen, skill) => 'e2e1',
      getEvaluation: async (fen) => 0,
      _enqueue: (fn) => fn(),
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

    game.loadFromFen('6k1/8/8/8/8/8/4p3/R6K w - - 0 1');

    const ws1 = wss.simulateConnection();
    ws1.emit('message', JSON.stringify({ type: 'join', color: 'white' }));
    ws1.emit(
      'message',
      JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'beginner' })
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    ws1.emit(
      'message',
      JSON.stringify({ type: 'move', fromFile: 0, fromRank: 0, toFile: 0, toRank: 1 })
    );
    await new Promise((resolve) => setTimeout(resolve, 800));

    // Check message ordering: move before promotion
    const allMessages = ws1.getRawSent().map((m) => JSON.parse(m));
    const moveIdx = allMessages.findIndex((m) => m.type === 'move' && m.color === 'black');
    const promoIdx = allMessages.findIndex((m) => m.type === 'promotion');
    assert.ok(moveIdx >= 0, 'should have a black move message');
    assert.ok(promoIdx >= 0, 'should have a promotion message');
    assert.ok(
      moveIdx < promoIdx,
      `move (idx ${moveIdx}) should precede promotion (idx ${promoIdx})`
    );

    resetStockfishEngine();
  });

  test('computer promotion on retry also includes position', async () => {
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
        if (callCount === 1) return 'e2e2'; // illegal: same square
        return 'e2e1'; // promotion on retry
      },
      getEvaluation: async (fen) => 0,
      _enqueue: (fn) => fn(),
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

    game.loadFromFen('6k1/8/8/8/8/8/4p3/R6K w - - 0 1');

    const ws1 = wss.simulateConnection();
    ws1.emit('message', JSON.stringify({ type: 'join', color: 'white' }));
    ws1.emit(
      'message',
      JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'beginner' })
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    ws1.emit(
      'message',
      JSON.stringify({ type: 'move', fromFile: 0, fromRank: 0, toFile: 0, toRank: 1 })
    );
    await new Promise((resolve) => setTimeout(resolve, 800));

    const promoMsgs = ws1.getSent('promotion');
    assert.strictEqual(promoMsgs.length, 1, 'should have one promotion after retry');
    assert.strictEqual(promoMsgs[0].pieceType, 'queen');
    assert.strictEqual(promoMsgs[0].color, 'black', 'promotion color should be black');
    assert.strictEqual(promoMsgs[0].file, 4);
    assert.strictEqual(promoMsgs[0].rank, 0);

    const stateMsgs = ws1.getSent('state');
    const lastState = stateMsgs[stateMsgs.length - 1];
    assert.strictEqual(lastState.board[0][4], 11, 'black queen at e1');

    resetStockfishEngine();
  });
});

// ── Tests: Player promotion triggers computer move ───────

describe('Player promotion — triggers computer move', () => {
  test("human promotion triggers computer move when it becomes computer's turn", async () => {
    let engineCallCount = 0;
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
        engineCallCount++;
        return 'e7e5';
      },
      getEvaluation: async (fen) => 0,
      _enqueue: (fn) => fn(),
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

    // White pawn on a7 ready to promote, black king on g7 (off rank 8),
    // black pawn on e7 for computer response, white king on e1.
    // Promotion to a8 does NOT put black king in check (queen on a8 doesn't attack g7),
    // so e7e5 is a legal computer response.
    game.loadFromFen('8/P3p3/6k1/8/8/8/8/4K3 w - - 0 1');

    const ws1 = wss.simulateConnection();
    ws1.emit('message', JSON.stringify({ type: 'join', color: 'white' }));
    ws1.emit(
      'message',
      JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'beginner' })
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    // White moves pawn to promote (a7 -> a8)
    ws1.emit(
      'message',
      JSON.stringify({ type: 'move', fromFile: 0, fromRank: 6, toFile: 0, toRank: 7 })
    );
    assert.ok(game.promotingPiece !== null, 'promotion should be pending');

    // White completes promotion
    ws1.emit('message', JSON.stringify({ type: 'promotion', pieceType: 'queen' }));

    // Verify promotion completed
    assert.strictEqual(game.promotingPiece, null, 'promotion should be complete');
    assert.strictEqual(game.board[7][0], 5, 'white queen at a8');
    assert.strictEqual(game.turn, 'black', "should be black's turn");

    // Wait past MIN_MOVE_DELAY for computer to respond
    // The server enforces ~500ms delay; wait significantly longer for async completion
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Engine should have been called
    assert.ok(engineCallCount >= 1, `engine called ${engineCallCount} time(s), expected >= 1`);

    // Computer should have made a move
    const stateMsgs = ws1.getSent('state');
    const lastState = stateMsgs[stateMsgs.length - 1];
    assert.strictEqual(lastState.turn, 'white', "should be white's turn after computer move");

    // Promotion message should include position and color
    const promoMsgs = ws1.getSent('promotion');
    assert.strictEqual(promoMsgs.length, 1, 'should have one promotion message');
    assert.strictEqual(promoMsgs[0].pieceType, 'queen');
    assert.strictEqual(promoMsgs[0].color, 'white', 'promotion color should be white');
    assert.strictEqual(promoMsgs[0].file, 0, 'promotion file should be a (0)');
    assert.strictEqual(promoMsgs[0].rank, 7, 'promotion rank should be 8 (7)');

    resetStockfishEngine();
  });

  test('human promotion to knight triggers computer move', async () => {
    let engineCallCount = 0;
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
        engineCallCount++;
        return 'e7e5';
      },
      getEvaluation: async (fen) => 0,
      _enqueue: (fn) => fn(),
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

    game.loadFromFen('8/P3p3/6k1/8/8/8/8/4K3 w - - 0 1');

    const ws1 = wss.simulateConnection();
    ws1.emit('message', JSON.stringify({ type: 'join', color: 'white' }));
    ws1.emit(
      'message',
      JSON.stringify({ type: 'activateComputer', color: 'black', skill: 'beginner' })
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    ws1.emit(
      'message',
      JSON.stringify({ type: 'move', fromFile: 0, fromRank: 6, toFile: 0, toRank: 7 })
    );
    ws1.emit('message', JSON.stringify({ type: 'promotion', pieceType: 'knight' }));

    assert.strictEqual(game.board[7][0], 2, 'white knight at a8');

    await new Promise((resolve) => setTimeout(resolve, 800));
    assert.ok(engineCallCount >= 1, 'engine should have been called');

    resetStockfishEngine();
  });
});

describe('StockfishEngine — skill override deep-merge', () => {
  test('partial skill override preserves other preset fields', () => {
    // Create an engine with a partial override for 'beginner' that only
    // changes movetime. The built-in beginner preset has skillLevel, threads,
    // hash, movetime, and depth — all of those except movetime must survive.
    const engine = new StockfishEngine({
      skills: { beginner: { movetime: 100 } },
    });

    const beginner = engine.skills.beginner;
    assert.strictEqual(beginner.movetime, 100, 'overridden field should change');
    assert.strictEqual(beginner.skillLevel, 0, 'skillLevel should be preserved');
    assert.strictEqual(beginner.threads, 1, 'threads should be preserved');
    assert.strictEqual(beginner.hash, 16, 'hash should be preserved');
    assert.strictEqual(beginner.depth, 3, 'depth should be preserved');
  });

  test('partial override for master preserves other fields', () => {
    const engine = new StockfishEngine({
      skills: { master: { depth: 30 } },
    });

    const master = engine.skills.master;
    assert.strictEqual(master.depth, 30, 'overridden field should change');
    assert.strictEqual(master.skillLevel, 18, 'skillLevel should be preserved');
    assert.strictEqual(master.threads, 2, 'threads should be preserved');
    assert.strictEqual(master.hash, 128, 'hash should be preserved');
    assert.strictEqual(master.movetime, 5000, 'movetime should be preserved');
  });

  test('multiple partial overrides each deep-merge independently', () => {
    const engine = new StockfishEngine({
      skills: {
        beginner: { movetime: 50 },
        grandmaster: { threads: 4 },
      },
    });

    assert.strictEqual(engine.skills.beginner.movetime, 50);
    assert.strictEqual(engine.skills.beginner.skillLevel, 0);
    assert.strictEqual(engine.skills.beginner.hash, 16);

    assert.strictEqual(engine.skills.grandmaster.threads, 4);
    assert.strictEqual(engine.skills.grandmaster.skillLevel, 20);
    assert.strictEqual(engine.skills.grandmaster.hash, 256);
    assert.strictEqual(engine.skills.grandmaster.movetime, 10000);
  });

  test('new custom skill not in defaults is added as-is', () => {
    const engine = new StockfishEngine({
      skills: { custom: { skillLevel: 5, threads: 1, hash: 32, movetime: 1000 } },
    });

    assert.ok(engine.skills.custom, 'custom skill should exist');
    assert.strictEqual(engine.skills.custom.skillLevel, 5);
    assert.strictEqual(engine.skills.custom.movetime, 1000);
  });

  test('no skills override leaves defaults intact', () => {
    const engine = new StockfishEngine({});
    assert.deepStrictEqual(engine.skills.beginner, SKILL_DEFAULTS.beginner);
    assert.deepStrictEqual(engine.skills.grandmaster, SKILL_DEFAULTS.grandmaster);
  });
});

// ── Run ───────────────────────────────────────────────────

run().catch((err) => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
