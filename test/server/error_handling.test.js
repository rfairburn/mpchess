// ═══════════════════════════════════════════════════════════
//  TEST SUITE — async error handling consistency (C8)
//  Covers gracefulShutdown error catching and ws-handlers
//  async IIFE error paths.
//  Run:  node test/server/error_handling.test.js
// ═══════════════════════════════════════════════════════════

const assert = require('assert');
const http = require('http');

const { createGracefulShutdown } = require('../../server');
const { resetStockfishEngine, setStockfishEngine } = require('../../shared/stockfish_engine');

// ── Mock WebSocket ────────────────────────────────────────

class MockWebSocket {
  constructor() {
    this.readyState = 1;
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
    this.readyState = 3;
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
}

// ── Test runner ───────────────────────────────────────────

let passed = 0;
let failed = 0;
let total = 0;
const results = [];
const pendingPromises = [];

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

function waitForPending() {
  return Promise.all(pendingPromises);
}

// ═══════════════════════════════════════════════════════════
//  TESTS — gracefulShutdown error handling
//  Uses per-test tagged error capture to avoid cross-test pollution
//  when tests run concurrently.
// ═══════════════════════════════════════════════════════════

// Global collectors with test tags so concurrent tests don't interfere
const _errorCollector = [];
const origConsoleError = console.error;
console.error = (...args) => {
  _errorCollector.push(args.join(' '));
};

const _exitCollector = [];
const origProcessExit = process.exit;
process.exit = (code) => {
  _exitCollector.push(code);
};

function collectErrorsFor(tag) {
  return _errorCollector.filter((m) => m.includes(tag));
}

describe('gracefulShutdown — async error handling', () => {
  test('catches engine quit error and still closes server', async () => {
    const TAG = '[T1]';
    const snapshot = _exitCollector.length;
    const mockEngine = {
      quit: async () => {
        throw new Error(`${TAG} engine crash during quit`);
      },
    };
    setStockfishEngine(mockEngine);

    const server = http.createServer();
    let closed = false;
    server.close = (cb) => {
      closed = true;
      if (cb) setImmediate(cb);
    };

    const handler = createGracefulShutdown(server);
    handler('SIGTERM');

    await new Promise((r) => setTimeout(r, 100));

    const taggedErrors = collectErrorsFor(TAG);
    assert.ok(
      taggedErrors.some((e) => e.includes('Engine quit error')),
      `Expected tagged error log, got: ${taggedErrors.join(', ')}`
    );
    assert.strictEqual(closed, true, 'Server should have been closed');
    assert.ok(_exitCollector.slice(snapshot).includes(0), 'Should exit cleanly');
  });

  test('closes server cleanly when engine quit succeeds', async () => {
    const TAG = '[T2]';
    const snapshot = _exitCollector.length;
    const mockEngine = {
      quit: async () => {},
    };
    setStockfishEngine(mockEngine);

    const server = http.createServer();
    let closed = false;
    server.close = (cb) => {
      closed = true;
      if (cb) setImmediate(cb);
    };

    const handler = createGracefulShutdown(server);
    handler('SIGINT');

    await new Promise((r) => setTimeout(r, 100));

    const taggedErrors = collectErrorsFor(TAG);
    assert.strictEqual(taggedErrors.length, 0, `No tagged errors, got: ${taggedErrors.join(', ')}`);
    assert.strictEqual(closed, true, 'Server should have been closed');
    assert.ok(_exitCollector.slice(snapshot).includes(0), 'Should exit cleanly');
  });

  test('handles engine with no transport (quit returns undefined)', async () => {
    const snapshot = _exitCollector.length;
    const mockEngine = {
      quit: () => undefined,
    };
    setStockfishEngine(mockEngine);

    const server = http.createServer();
    let closed = false;
    server.close = (cb) => {
      closed = true;
      if (cb) setImmediate(cb);
    };

    const handler = createGracefulShutdown(server);
    handler('SIGTERM');

    await new Promise((r) => setTimeout(r, 100));

    assert.strictEqual(closed, true, 'Server should have been closed');
    assert.ok(_exitCollector.slice(snapshot).includes(0), 'Should exit cleanly');
  });

  test('server.close() is deferred until quit promise settles', async () => {
    const TAG = '[T3]';
    let quitResolved = false;
    const mockEngine = {
      quit: async () => {
        // Simulate a slow engine shutdown
        await new Promise((r) => setTimeout(r, 80));
        quitResolved = true;
      },
    };
    setStockfishEngine(mockEngine);

    const server = http.createServer();
    let closed = false;
    let closeTime = 0;
    let quitResolveTime = 0;
    server.close = (cb) => {
      closed = true;
      closeTime = Date.now();
      if (cb) setImmediate(cb);
    };

    const origSetTimeout = global.setTimeout;
    // Track when quit resolves
    const origQuit = mockEngine.quit;
    mockEngine.quit = async () => {
      await origQuit();
      quitResolveTime = Date.now();
    };

    const handler = createGracefulShutdown(server);
    handler('SIGTERM');

    // Check immediately — server should NOT be closed yet
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(closed, false, 'Server should NOT be closed before quit settles');

    // Wait for quit to settle
    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(quitResolved, true, 'Quit should have resolved');
    assert.strictEqual(closed, true, 'Server should be closed after quit settles');
    assert.ok(
      closeTime >= quitResolveTime,
      `Server closed at ${closeTime} should be >= quit resolved at ${quitResolveTime}`
    );
  });

  test('catches synchronous throw from quit()', async () => {
    const TAG = '[T4]';
    const snapshot = _exitCollector.length;
    const mockEngine = {
      quit: () => {
        throw new Error(`${TAG} sync crash in quit`);
      },
    };
    setStockfishEngine(mockEngine);

    const server = http.createServer();
    let closed = false;
    server.close = (cb) => {
      closed = true;
      if (cb) setImmediate(cb);
    };

    const handler = createGracefulShutdown(server);
    // This should NOT throw — the sync error is caught by Promise.resolve().then()
    handler('SIGTERM');

    await new Promise((r) => setTimeout(r, 100));

    const taggedErrors = collectErrorsFor(TAG);
    assert.ok(
      taggedErrors.some((e) => e.includes('Engine quit error')),
      `Expected tagged error log for sync throw, got: ${taggedErrors.join(', ')}`
    );
    assert.strictEqual(closed, true, 'Server should have been closed after sync throw');
    assert.ok(_exitCollector.slice(snapshot).includes(0), 'Should exit cleanly');
  });

  test('force-exit timer stays active when server.close() callback never fires', async () => {
    // Track all timer IDs created and cleared during this test's window.
    // We identify the force-exit timer by its 5000ms delay, then verify
    // it is NOT cleared before the close callback fires, and IS cleared
    // after.
    const realSetTimeout = global.setTimeout;
    const realClearTimeout = global.clearTimeout;
    const timerIds = new Map(); // id -> delay
    const clearedIds = new Set();

    global.setTimeout = (fn, delay, ...args) => {
      const id = realSetTimeout(fn, delay, ...args);
      timerIds.set(id, delay);
      return id;
    };
    global.clearTimeout = (id) => {
      clearedIds.add(id);
      realClearTimeout(id);
    };

    const mockEngine = {
      quit: async () => {},
    };
    setStockfishEngine(mockEngine);

    const server = http.createServer();
    let closed = false;
    let closeCallback = null;
    server.close = (cb) => {
      closed = true;
      closeCallback = cb;
      // intentionally do NOT call cb()
    };

    const handler = createGracefulShutdown(server);
    handler('SIGTERM');

    // Wait for quit to settle and server.close() to be called
    await new Promise((r) => realSetTimeout(r, 100));

    assert.strictEqual(closed, true, 'server.close() should have been called');

    // Find the force-exit timer (5000ms delay) among timers created
    let forceExitId = null;
    for (const [id, delay] of timerIds) {
      if (delay === 5000) {
        forceExitId = id;
        break;
      }
    }
    assert.ok(forceExitId !== null, 'Force-exit timer (5s) should have been scheduled');
    assert.ok(
      !clearedIds.has(forceExitId),
      'Force-exit timer should NOT have been cleared before close callback fires'
    );

    // Now invoke the close callback — this should clear the timer
    if (closeCallback) closeCallback();
    await new Promise((r) => realSetTimeout(r, 10));

    assert.ok(
      clearedIds.has(forceExitId),
      'Force-exit timer should have been cleared after close callback fires'
    );

    // Restore
    global.setTimeout = realSetTimeout;
    global.clearTimeout = realClearTimeout;
  });
});

// ═══════════════════════════════════════════════════════════
//  TESTS — ws-handlers async IIFE error paths
// ═══════════════════════════════════════════════════════════

describe('ws-handlers — async IIFE error handling', () => {
  test('handleActivateComputer rolls back state on engine spawn failure', async () => {
    const { Game } = require('../../shared/chess');
    const { setupWebSocketHandlers } = require('../../server');

    const mockEngine = {
      isReady: false,
      spawn: async () => {
        throw new Error('spawn failed');
      },
      skills: { beginner: {}, novice: {} },
      setSkill: async () => {},
      getBestMove: async () => 'e2e4',
      getEvaluation: async () => 0,
      quit: async () => {},
      kill: () => {},
    };
    setStockfishEngine(mockEngine);

    const game = new Game();
    const wss = new MockWebSocketServer();
    setupWebSocketHandlers(wss, game, {
      computerPlayer: { enabled: true },
    });

    const ws = wss.simulateConnection();

    // Join as white
    ws.emit('message', JSON.stringify({ type: 'join', color: 'white' }));
    await new Promise((r) => setImmediate(r));

    // Try to activate computer as black — engine will fail
    ws.emit(
      'message',
      JSON.stringify({
        type: 'activateComputer',
        color: 'black',
        skill: 'beginner',
      })
    );
    await new Promise((r) => setTimeout(r, 50));

    // Verify: error sent to client
    const errors = ws.getSent('error');
    assert.ok(errors.length > 0, 'Should send error to client');

    // Verify: computer player state was rolled back (not active)
    const stateMsgs = ws.getSent('state');
    const lastState = stateMsgs[stateMsgs.length - 1];
    assert.strictEqual(
      lastState.computerPlayer,
      null,
      'Computer player should be null after failure'
    );

    resetStockfishEngine();
  });

  test('changeSkill rolls back on engine setSkill failure', async () => {
    const { Game } = require('../../shared/chess');
    const { setupWebSocketHandlers } = require('../../server');

    const mockEngine = {
      isReady: true,
      spawn: async () => {},
      skills: { beginner: {}, novice: {} },
      setSkill: async (skill) => {
        if (skill === 'novice') throw new Error('setSkill failed');
      },
      getBestMove: async () => 'e2e4',
      getEvaluation: async () => 0,
      quit: async () => {},
      kill: () => {},
    };
    setStockfishEngine(mockEngine);

    const game = new Game();
    const wss = new MockWebSocketServer();
    setupWebSocketHandlers(wss, game, {
      computerPlayer: { enabled: true },
    });

    const ws = wss.simulateConnection();

    // Join as white
    ws.emit('message', JSON.stringify({ type: 'join', color: 'white' }));
    await new Promise((r) => setImmediate(r));

    // Activate computer as black (succeeds since spawn works)
    ws.emit(
      'message',
      JSON.stringify({
        type: 'activateComputer',
        color: 'black',
        skill: 'beginner',
      })
    );
    await new Promise((r) => setTimeout(r, 50));

    // Verify computer is active
    let stateMsgs = ws.getSent('state');
    let lastState = stateMsgs[stateMsgs.length - 1];
    assert.strictEqual(lastState.computerPlayer?.skill, 'beginner', 'Computer should be active');

    // Try to change skill — engine will fail
    ws.emit(
      'message',
      JSON.stringify({
        type: 'changeSkill',
        skill: 'novice',
      })
    );
    await new Promise((r) => setTimeout(r, 50));

    // Verify: error sent to client
    const errors = ws.getSent('error');
    assert.ok(
      errors.some((e) => e.reason && e.reason.includes('Skill change failed')),
      `Should send skill change error, got: ${errors.map((e) => e.reason).join(', ')}`
    );

    // Verify: skill rolled back to 'beginner'
    stateMsgs = ws.getSent('state');
    lastState = stateMsgs[stateMsgs.length - 1];
    assert.strictEqual(
      lastState.computerPlayer?.skill,
      'beginner',
      'Skill should be rolled back to previous value'
    );

    resetStockfishEngine();
  });
});

// ═══════════════════════════════════════════════════════════
//  Run tests
// ═══════════════════════════════════════════════════════════

(async () => {
  await waitForPending();

  // Restore console.error and process.exit before any timers fire
  console.error = origConsoleError;
  process.exit = origProcessExit;

  for (const r of results) {
    if (r.label) {
      console.log(`\n${r.label}`);
    } else if (r.name) {
      const status = r.ok ? 'PASS' : 'FAIL';
      console.log(`  ${status}: ${r.name}${r.err ? ` — ${r.err}` : ''}`);
    }
  }

  console.log(`\n==================================================`);
  console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
  // Exit immediately to prevent 5s force-exit timers from firing
  process.exit(failed > 0 ? 1 : 0);
})();
