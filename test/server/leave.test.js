// ═══════════════════════════════════════════════════════════
//  TEST SUITE — voluntary leave (give up spot)
//  Run:  node test/server/leave.test.js
// ═══════════════════════════════════════════════════════════

const assert = require('assert');

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

// ── Test runner ───────────────────────────────────────────

let passed = 0;
let failed = 0;
let total = 0;
const results = [];

function test(name, fn) {
  total++;
  const idx = results.length;
  results.push({ label: null, name, ok: null, err: null });
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
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

// ── Helpers ───────────────────────────────────────────────

function createTestEnv(seatTimeout) {
  const game = new Game();
  const wss = new MockWebSocketServer();
  const handlers = setupWebSocketHandlers(wss, game, {
    seatTimeout: seatTimeout != null ? seatTimeout : 100,
    joinTimeoutMs: 0,
  });
  return { game, wss, handlers };
}

function joinAs(wss, color) {
  const ws = wss.simulateConnection();
  ws.emit('message', JSON.stringify({ type: 'join', color }));
  return ws;
}

function safeGet(obj, ...keys) {
  let current = obj;
  for (const key of keys) current = current?.[key];
  return current;
}

// ── Tests ─────────────────────────────────────────────────

describe('Leave — player voluntarily gives up seat', () => {
  test('player receives left message with correct color', () => {
    const { wss, handlers, game } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    assert.strictEqual(safeGet(handlers.sessions.get(ws1), 'color'), 'white');
    ws1.emit('message', JSON.stringify({ type: 'leave' }));
    const leftMsgs = ws1.getSent('left');
    assert.strictEqual(leftMsgs.length, 1);
    assert.strictEqual(leftMsgs[0].color, 'white');
  });

  test('session removed from sessions map', () => {
    const { wss, handlers } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    assert.ok(handlers.sessions.has(ws1));
    ws1.emit('message', JSON.stringify({ type: 'leave' }));
    assert.strictEqual(handlers.sessions.has(ws1), false);
  });

  test('player removed from game.players', () => {
    const { wss, game } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    assert.strictEqual(game.players.get(ws1), 'white');
    ws1.emit('message', JSON.stringify({ type: 'leave' }));
    assert.strictEqual(game.players.has(ws1), false);
  });

  test('seat freed immediately — no disconnectedPlayers entry', () => {
    const { wss, handlers } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const token1 = safeGet(ws1.getSent('joined')[0], 'token');
    ws1.emit('message', JSON.stringify({ type: 'leave' }));
    assert.strictEqual(handlers.disconnectedPlayers.has(token1), false);
    assert.strictEqual(handlers.disconnectedPlayers.size, 0);
  });

  test('seat is free in broadcast state', () => {
    const { wss } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    ws1.emit('message', JSON.stringify({ type: 'leave' }));
    // New connection should see white seat as free
    const ws3 = wss.simulateConnection();
    const stateMsg = ws3.getSent('state')[0];
    assert.strictEqual(stateMsg.seats.white.status, 'free');
  });

  test('new player can join the freed seat immediately', () => {
    const { wss } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    ws1.emit('message', JSON.stringify({ type: 'leave' }));
    const ws2 = joinAs(wss, 'white');
    assert.strictEqual(ws2.getSent('joined').length, 1);
    assert.strictEqual(safeGet(ws2.getSent('joined')[0], 'color'), 'white');
  });
});

describe('Leave — opponent and spectator notifications', () => {
  test('opponent receives playerLeft (not playerDisconnected)', () => {
    const { wss } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const ws2 = joinAs(wss, 'black');
    ws1.emit('message', JSON.stringify({ type: 'leave' }));
    const playerLeftMsgs = ws2.getSent('playerLeft');
    assert.strictEqual(playerLeftMsgs.length, 1);
    assert.strictEqual(playerLeftMsgs[0].color, 'white');
    // Should NOT receive playerDisconnected
    assert.strictEqual(ws2.getSent('playerDisconnected').length, 0);
  });

  test('spectator receives playerLeft', () => {
    const { wss } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    joinAs(wss, 'black');
    const ws3 = joinAs(wss, 'spectator');
    ws1.emit('message', JSON.stringify({ type: 'leave' }));
    const playerLeftMsgs = ws3.getSent('playerLeft');
    assert.strictEqual(playerLeftMsgs.length, 1);
    assert.strictEqual(playerLeftMsgs[0].color, 'white');
  });

  test('leaving player does not receive playerLeft about themselves', () => {
    const { wss } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    joinAs(wss, 'black');
    ws1.emit('message', JSON.stringify({ type: 'leave' }));
    assert.strictEqual(ws1.getSent('playerLeft').length, 0);
  });
});

describe('Leave — spectator', () => {
  test('spectator removed from spectators set', () => {
    const { wss, game } = createTestEnv();
    joinAs(wss, 'white');
    joinAs(wss, 'black');
    const ws3 = joinAs(wss, 'spectator');
    assert.ok(game.spectators.has(ws3));
    ws3.emit('message', JSON.stringify({ type: 'leave' }));
    assert.strictEqual(game.spectators.has(ws3), false);
  });

  test('spectator receives left message with null color', () => {
    const { wss } = createTestEnv();
    joinAs(wss, 'white');
    joinAs(wss, 'black');
    const ws3 = joinAs(wss, 'spectator');
    ws3.emit('message', JSON.stringify({ type: 'leave' }));
    const leftMsgs = ws3.getSent('left');
    assert.strictEqual(leftMsgs.length, 1);
    assert.strictEqual(leftMsgs[0].color, undefined);
  });

  test('spectator leave does not add to disconnectedPlayers', () => {
    const { wss, handlers } = createTestEnv();
    joinAs(wss, 'white');
    joinAs(wss, 'black');
    const ws3 = joinAs(wss, 'spectator');
    ws3.emit('message', JSON.stringify({ type: 'leave' }));
    assert.strictEqual(handlers.disconnectedPlayers.size, 0);
  });
});

describe('Leave — draw offer cleanup', () => {
  test('draw offer cleared when offerer leaves', () => {
    const { wss } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const ws2 = joinAs(wss, 'black');
    // White offers draw
    ws1.emit('message', JSON.stringify({ type: 'offerDraw' }));
    assert.strictEqual(ws2.getSent('drawOffer').length, 1);
    // White leaves
    ws1.emit('message', JSON.stringify({ type: 'leave' }));
    // Black tries to accept — should fail because offer was cleared
    ws2.emit('message', JSON.stringify({ type: 'drawResponse', accepted: true }));
    const errors = ws2.getSent('error');
    assert.strictEqual(errors.length, 1);
    assert.ok(errors[0].reason.includes('No draw offer'));
  });

  test('draw offer cleared when responder leaves', () => {
    const { wss } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const ws2 = joinAs(wss, 'black');
    // White offers draw
    ws1.emit('message', JSON.stringify({ type: 'offerDraw' }));
    assert.strictEqual(ws2.getSent('drawOffer').length, 1);
    // Black (responder) leaves
    ws2.emit('message', JSON.stringify({ type: 'leave' }));
    // White should receive drawOfferCancelled
    const cancelledMsgs = ws1.getSent('drawOfferCancelled');
    assert.strictEqual(cancelledMsgs.length, 1);
  });

  test('draw offer cleared prevents stale game end', () => {
    const { wss, game } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const ws2 = joinAs(wss, 'black');
    // White offers draw
    ws1.emit('message', JSON.stringify({ type: 'offerDraw' }));
    // White leaves
    ws1.emit('message', JSON.stringify({ type: 'leave' }));
    // Black tries to accept — game should NOT end
    ws2.emit('message', JSON.stringify({ type: 'drawResponse', accepted: true }));
    assert.strictEqual(game.gameOver, false);
    assert.strictEqual(game.gameResult, null);
  });
});

describe('Leave — both-disconnected timer not affected', () => {
  test('single leave does not start both-disconnected timer', () => {
    const { wss, handlers, game } = createTestEnv(10);
    const ws1 = joinAs(wss, 'white');
    const ws2 = joinAs(wss, 'black');
    ws1.emit('message', JSON.stringify({ type: 'leave' }));
    // disconnectedPlayers should be empty (no held seat)
    assert.strictEqual(handlers.disconnectedPlayers.size, 0);
    // Game should NOT have reset
    assert.strictEqual(game.players.size, 1); // only black remains
  });

  test('both players leave — seats freed, no timer needed', () => {
    const { wss, handlers, game } = createTestEnv(10);
    const ws1 = joinAs(wss, 'white');
    const ws2 = joinAs(wss, 'black');
    ws1.emit('message', JSON.stringify({ type: 'leave' }));
    ws2.emit('message', JSON.stringify({ type: 'leave' }));
    // No disconnected players, no timer
    assert.strictEqual(handlers.disconnectedPlayers.size, 0);
    // Both seats should be free
    const ws3 = wss.simulateConnection();
    const stateMsg = ws3.getSent('state')[0];
    assert.strictEqual(stateMsg.seats.white.status, 'free');
    assert.strictEqual(stateMsg.seats.black.status, 'free');
  });
});

describe('Leave — unassigned client', () => {
  test('unassigned client leave is handled gracefully', () => {
    const { wss, game } = createTestEnv();
    const ws = wss.simulateConnection();
    // Client hasn't joined yet
    assert.strictEqual(game.players.has(ws), false);
    assert.strictEqual(game.spectators.has(ws), false);
    ws.emit('message', JSON.stringify({ type: 'leave' }));
    // Should receive left message
    const leftMsgs = ws.getSent('left');
    assert.strictEqual(leftMsgs.length, 1);
  });
});

// ── Print results ─────────────────────────────────────────

async function printResults() {
  // Wait for any pending async tests
  await new Promise((r) => setTimeout(r, 100));

  let lastLabel = null;
  for (const r of results) {
    if (r.label) {
      lastLabel = r.label;
      console.log(`\n${lastLabel}`);
    } else {
      const icon = r.ok ? '  ✓' : `  ✗ ${r.name}`;
      console.log(`${icon} ${r.name}`);
    }
  }

  console.log(`\n==================================================`);
  console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

printResults();
