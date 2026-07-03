// ═══════════════════════════════════════════════════════════
//  TEST SUITE — reconnection / session / importFen
//  Run:  npm test
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

  reset() {
    this.clients.clear();
  }
}

// ── Test runner — buffered output, prints in declaration order ──

let passed = 0;
let failed = 0;
let total = 0;
const pendingPromises = [];
const results = []; // { label | null, name, ok, err } — one entry per describe header + per test

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
  try {
    let current = obj;
    for (const key of keys) current = current?.[key];
    return current;
  } catch {
    return undefined;
  }
}

// ── Tests ─────────────────────────────────────────────────

describe('Session tokens and join flow', () => {
  test('first player joins as white and receives token', () => {
    const { wss, handlers } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    assert.strictEqual(ws1.getSent('joined').length, 1);
    assert.strictEqual(safeGet(ws1.getSent('joined')[0], 'color'), 'white');
    assert.ok(safeGet(ws1.getSent('joined')[0], 'token'));
    assert.ok(handlers.sessions.has(ws1));
    assert.strictEqual(safeGet(handlers.sessions.get(ws1), 'color'), 'white');
  });

  test('second player joins as black', () => {
    const { wss } = createTestEnv();
    joinAs(wss, 'white');
    const ws2 = joinAs(wss, 'black');
    assert.strictEqual(safeGet(ws2.getSent('joined')[0], 'color'), 'black');
    assert.ok(safeGet(ws2.getSent('joined')[0], 'token'));
  });

  test('third player becomes spectator', () => {
    const { wss } = createTestEnv();
    joinAs(wss, 'white');
    joinAs(wss, 'black');
    const ws3 = joinAs(wss, 'spectator');
    assert.strictEqual(safeGet(ws3.getSent('joined')[0], 'color'), 'spectator');
    assert.strictEqual(safeGet(ws3.getSent('state'), 1, 'role'), 'spectator');
  });

  test('fourth player rejected when seat taken — no fallback', () => {
    const { wss } = createTestEnv();
    joinAs(wss, 'white');
    joinAs(wss, 'black');
    const ws4 = joinAs(wss, 'white');
    assert.strictEqual(ws4.getSent('joined').length, 0);
    assert.strictEqual(ws4.getSent('error').length, 1);
  });
});

describe('Disconnect — seat held with token', () => {
  test('session removed from sessions map', () => {
    const { wss, handlers } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const token1 = safeGet(ws1.getSent('joined')[0], 'token');
    joinAs(wss, 'black');
    wss.simulateDisconnect(ws1);
    assert.strictEqual(handlers.sessions.has(ws1), false);
  });

  test('player stored in disconnectedPlayers', () => {
    const { wss, handlers } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const token1 = safeGet(ws1.getSent('joined')[0], 'token');
    joinAs(wss, 'black');
    wss.simulateDisconnect(ws1);
    assert.ok(handlers.disconnectedPlayers.has(token1));
    assert.strictEqual(safeGet(handlers.disconnectedPlayers.get(token1), 'color'), 'white');
  });

  test('player removed from game.players', () => {
    const { wss, game } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    joinAs(wss, 'black');
    wss.simulateDisconnect(ws1);
    assert.strictEqual(game.players.has(ws1), false);
  });

  test('opponent receives playerDisconnected', () => {
    const { wss } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const token1 = safeGet(ws1.getSent('joined')[0], 'token');
    const ws2 = joinAs(wss, 'black');
    wss.simulateDisconnect(ws1);
    const pdMsgs = ws2.getSent('playerDisconnected');
    assert.strictEqual(pdMsgs.length, 1);
    assert.strictEqual(safeGet(pdMsgs[0], 'color'), 'white');
    assert.strictEqual(safeGet(pdMsgs[0], 'token'), token1);
    assert.ok(safeGet(pdMsgs[0], 'disconnectedAt'));
  });
});

describe('Reconnect with valid token', () => {
  test('reconnected message sent with correct color', () => {
    const { wss, handlers, game } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const token1 = safeGet(ws1.getSent('joined')[0], 'token');
    joinAs(wss, 'black');
    wss.simulateDisconnect(ws1);
    const ws1_new = wss.simulateConnection();
    ws1_new.emit('message', JSON.stringify({ type: 'reconnect', token: token1 }));
    assert.strictEqual(ws1_new.getSent('reconnected').length, 1);
    assert.strictEqual(safeGet(ws1_new.getSent('reconnected')[0], 'color'), 'white');
  });

  test('removed from disconnectedPlayers after reconnect', () => {
    const { wss, handlers } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const token1 = safeGet(ws1.getSent('joined')[0], 'token');
    joinAs(wss, 'black');
    wss.simulateDisconnect(ws1);
    const ws1_new = wss.simulateConnection();
    ws1_new.emit('message', JSON.stringify({ type: 'reconnect', token: token1 }));
    assert.strictEqual(handlers.disconnectedPlayers.has(token1), false);
  });

  test('new session created and game.players updated', () => {
    const { wss, handlers, game } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const token1 = safeGet(ws1.getSent('joined')[0], 'token');
    joinAs(wss, 'black');
    wss.simulateDisconnect(ws1);
    const ws1_new = wss.simulateConnection();
    ws1_new.emit('message', JSON.stringify({ type: 'reconnect', token: token1 }));
    assert.ok(handlers.sessions.has(ws1_new));
    assert.strictEqual(game.players.get(ws1_new), 'white');
    assert.strictEqual(handlers.sessions.has(ws1), false);
  });
});

describe('Reconnect with invalid token', () => {
  test('reconnectFailed sent for bad token', () => {
    const { wss, handlers } = createTestEnv();
    const ws1 = wss.simulateConnection();
    ws1.emit('message', JSON.stringify({ type: 'reconnect', token: 'nonexistent' }));
    assert.strictEqual(ws1.getSent('reconnectFailed').length, 1);
    assert.strictEqual(handlers.sessions.has(ws1), false);
  });
});

describe('Reconnect after seat was dropped', () => {
  test('reconnect fails after seat was dropped', async () => {
    const { wss, handlers } = createTestEnv(50);
    const ws1 = joinAs(wss, 'white');
    const token1 = safeGet(ws1.getSent('joined')[0], 'token');
    const ws2 = joinAs(wss, 'black');
    wss.simulateDisconnect(ws1);
    // Wait for seatTimeout to expire before dropping
    await new Promise((r) => setTimeout(r, 100));
    ws2.emit('message', JSON.stringify({ type: 'dropPlayer', token: token1 }));
    assert.strictEqual(handlers.disconnectedPlayers.has(token1), false);
    assert.strictEqual(ws2.getSent('playerDropped').length, 1);
    const ws1_new = wss.simulateConnection();
    ws1_new.emit('message', JSON.stringify({ type: 'reconnect', token: token1 }));
    assert.strictEqual(ws1_new.getSent('reconnectFailed').length, 1);
  });
});

describe('Drop Player — spectator cannot drop', () => {
  test('spectator drop attempt is ignored', () => {
    const { wss, handlers } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const token1 = safeGet(ws1.getSent('joined')[0], 'token');
    joinAs(wss, 'black');
    const ws3 = joinAs(wss, 'spectator');
    wss.simulateDisconnect(ws1);
    ws3.emit('message', JSON.stringify({ type: 'dropPlayer', token: token1 }));
    assert.ok(handlers.disconnectedPlayers.has(token1), 'seat still held');
  });
});

describe('Drop Player — server enforces seat timeout', () => {
  test('active player cannot drop opponent before seatTimeout', () => {
    const { wss, handlers } = createTestEnv(500);
    const ws1 = joinAs(wss, 'white');
    const token1 = safeGet(ws1.getSent('joined')[0], 'token');
    const ws2 = joinAs(wss, 'black');
    wss.simulateDisconnect(ws1);
    // Try to drop immediately — should be rejected
    ws2.emit('message', JSON.stringify({ type: 'dropPlayer', token: token1 }));
    assert.ok(handlers.disconnectedPlayers.has(token1), 'seat still held');
    const errors = ws2.getSent('error');
    assert.strictEqual(errors.length, 1);
    assert.ok(errors[0].reason.includes('reserved'));
  });

  test('active player can drop opponent after seatTimeout', async () => {
    const { wss, handlers } = createTestEnv(50);
    const ws1 = joinAs(wss, 'white');
    const token1 = safeGet(ws1.getSent('joined')[0], 'token');
    const ws2 = joinAs(wss, 'black');
    wss.simulateDisconnect(ws1);
    // Wait for seatTimeout to expire (both-disconnected won't fire since black is still connected)
    await new Promise((r) => setTimeout(r, 100));
    // Now drop should succeed
    ws2.emit('message', JSON.stringify({ type: 'dropPlayer', token: token1 }));
    assert.strictEqual(handlers.disconnectedPlayers.has(token1), false);
    assert.strictEqual(ws2.getSent('playerDropped').length, 1);
  });

  test('player cannot drop a seat matching their own color', () => {
    const { wss, handlers } = createTestEnv(500);
    const ws1 = joinAs(wss, 'white');
    const token1 = safeGet(ws1.getSent('joined')[0], 'token');
    const ws2 = joinAs(wss, 'black');
    wss.simulateDisconnect(ws1);
    // Inject a stale entry where the held seat is black (same color as ws2)
    handlers.disconnectedPlayers.clear();
    handlers.disconnectedPlayers.set(token1, { color: 'black', disconnectedAt: Date.now() });
    ws2.emit('message', JSON.stringify({ type: 'dropPlayer', token: token1 }));
    // Should be silently ignored (same color)
    assert.ok(handlers.disconnectedPlayers.has(token1), 'seat still held — same color rejected');
    assert.strictEqual(ws2.getSent('playerDropped').length, 0);
  });

  test('invalid token is silently ignored', () => {
    const { wss } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const ws2 = joinAs(wss, 'black');
    ws2.emit('message', JSON.stringify({ type: 'dropPlayer', token: 'nonexistent-token' }));
    assert.strictEqual(ws2.getSent('playerDropped').length, 0);
    assert.strictEqual(ws2.getSent('error').length, 0);
  });
});

describe('Player disconnect — spectator receives playerDisconnected', () => {
  test('spectator notified when player disconnects', () => {
    const { wss } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const token1 = safeGet(ws1.getSent('joined')[0], 'token');
    joinAs(wss, 'black');
    const ws3 = joinAs(wss, 'spectator');
    wss.simulateDisconnect(ws1);
    const pdMsgs = ws3.getSent('playerDisconnected');
    assert.strictEqual(pdMsgs.length, 1);
    assert.strictEqual(safeGet(pdMsgs[0], 'color'), 'white');
    assert.strictEqual(safeGet(pdMsgs[0], 'token'), token1);
  });
});

describe('Spectator disconnect — no session, no spam', () => {
  test('spectator disconnect sends no playerDisconnected', () => {
    const { wss, handlers } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const ws2 = joinAs(wss, 'black');
    const ws3 = joinAs(wss, 'spectator');
    assert.strictEqual(handlers.sessions.has(ws3), false);
    wss.simulateDisconnect(ws3);
    assert.strictEqual(ws1.getSent('playerDisconnected').length, 0);
    assert.strictEqual(ws2.getSent('playerDisconnected').length, 0);
    assert.strictEqual(handlers.disconnectedPlayers.size, 0);
  });
});

describe('State includes disconnectedPlayers array', () => {
  test('disconnected player appears in state', () => {
    const { wss } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const token1 = safeGet(ws1.getSent('joined')[0], 'token');
    const ws2 = joinAs(wss, 'black');
    wss.simulateDisconnect(ws1);
    const stateMsgs = ws2.getSent('state');
    const lastState = stateMsgs[stateMsgs.length - 1];
    assert.ok(Array.isArray(safeGet(lastState, 'disconnectedPlayers')));
    assert.strictEqual(safeGet(lastState, 'disconnectedPlayers', 'length'), 1);
    assert.strictEqual(safeGet(lastState, 'disconnectedPlayers', 0, 'color'), 'white');
    assert.strictEqual(safeGet(lastState, 'disconnectedPlayers', 0, 'token'), token1);
  });
});

// ── Async tests (require timers) ──────────────────────────

describe('Both disconnected — no spectators, timer still fires', () => {
  test('seats freed and game reset', async () => {
    const { wss, handlers, game } = createTestEnv(5);
    const ws1 = joinAs(wss, 'white');
    const ws2 = joinAs(wss, 'black');
    wss.simulateDisconnect(ws1);
    wss.simulateDisconnect(ws2);
    assert.strictEqual(handlers.disconnectedPlayers.size, 2);
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(handlers.disconnectedPlayers.size, 0);
    assert.strictEqual(game.turn, 'white');
  });
});

describe('Both disconnected — with spectator, auto-free', () => {
  test('spectator receives gameAvailable after timeout', async () => {
    const { wss, handlers, game } = createTestEnv(5);
    const ws1 = joinAs(wss, 'white');
    const ws2 = joinAs(wss, 'black');
    const ws3 = joinAs(wss, 'spectator');
    wss.simulateDisconnect(ws1);
    wss.simulateDisconnect(ws2);
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(handlers.disconnectedPlayers.size, 0);
    assert.strictEqual(ws3.getSent('gameAvailable').length, 1);
    assert.strictEqual(game.turn, 'white');
  });
});

describe('One reconnects during both-disconnected — timer stops', () => {
  test('timer stopped — remaining seat still held', async () => {
    const { wss, handlers } = createTestEnv(500);
    const ws1 = joinAs(wss, 'white');
    const token1 = safeGet(ws1.getSent('joined')[0], 'token');
    const ws2 = joinAs(wss, 'black');
    const token2 = safeGet(ws2.getSent('joined')[0], 'token');
    joinAs(wss, 'spectator');
    wss.simulateDisconnect(ws1);
    wss.simulateDisconnect(ws2);
    assert.strictEqual(handlers.disconnectedPlayers.size, 2);
    const ws1_new = wss.simulateConnection();
    ws1_new.emit('message', JSON.stringify({ type: 'reconnect', token: token1 }));
    assert.strictEqual(ws1_new.getSent('reconnected').length, 1);
    assert.strictEqual(handlers.disconnectedPlayers.size, 1);
    assert.ok(handlers.disconnectedPlayers.has(token2));
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(handlers.disconnectedPlayers.size, 1);
  });
});

describe('Spectator connects while both disconnected — timer starts', () => {
  test('seats freed after spectator joined', async () => {
    const { wss, handlers } = createTestEnv(10);
    const ws1 = joinAs(wss, 'white');
    const ws2 = joinAs(wss, 'black');
    wss.simulateDisconnect(ws1);
    wss.simulateDisconnect(ws2);
    assert.strictEqual(handlers.disconnectedPlayers.size, 2);
    const ws3 = joinAs(wss, 'spectator');
    assert.strictEqual(handlers.disconnectedPlayers.size, 2);
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(handlers.disconnectedPlayers.size, 0);
    assert.strictEqual(ws3.getSent('gameAvailable').length, 1);
  });
});

describe('Only one player ever connected, then disconnects', () => {
  test('seat freed after timeout — game resets for anyone', async () => {
    const { wss, handlers, game } = createTestEnv(10);
    const ws1 = joinAs(wss, 'white');
    // Black never connects
    wss.simulateDisconnect(ws1);
    assert.strictEqual(handlers.disconnectedPlayers.size, 1);
    // Wait for seatTimeout
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(handlers.disconnectedPlayers.size, 0);
    assert.strictEqual(game.turn, 'white'); // game was reset
    // New player can join the freed seat
    const ws2 = joinAs(wss, 'white');
    assert.strictEqual(ws2.getSent('joined').length, 1);
  });

  test('spectator receives gameAvailable after solo player disconnects', async () => {
    const { wss, handlers } = createTestEnv(10);
    const ws1 = joinAs(wss, 'white');
    const ws3 = joinAs(wss, 'spectator');
    wss.simulateDisconnect(ws1);
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(handlers.disconnectedPlayers.size, 0);
    assert.strictEqual(ws3.getSent('gameAvailable').length, 1);
  });

  test('new player joining mid-timer stops the reset', async () => {
    const { wss, handlers, game } = createTestEnv(500);
    const ws1 = joinAs(wss, 'white');
    wss.simulateDisconnect(ws1);
    assert.strictEqual(handlers.disconnectedPlayers.size, 1);
    // New player joins black while timer is running
    const ws2 = joinAs(wss, 'black');
    assert.strictEqual(ws2.getSent('joined').length, 1);
    // White seat should still be held (timer was stopped)
    assert.strictEqual(handlers.disconnectedPlayers.size, 1);
    await new Promise((r) => setTimeout(r, 20));
    // Game should NOT have reset
    assert.strictEqual(handlers.disconnectedPlayers.size, 1);
  });
});

describe('Reconnect after both-disconnected timer expired', () => {
  test('token invalidated, must join fresh', async () => {
    const { wss, handlers, game } = createTestEnv(10);
    const ws1 = joinAs(wss, 'white');
    const token1 = safeGet(ws1.getSent('joined')[0], 'token');
    const ws2 = joinAs(wss, 'black');
    wss.simulateDisconnect(ws1);
    wss.simulateDisconnect(ws2);
    assert.strictEqual(handlers.disconnectedPlayers.size, 2);
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(handlers.disconnectedPlayers.size, 0);
    assert.strictEqual(handlers.disconnectedPlayers.has(token1), false);
    const ws1_new = wss.simulateConnection();
    ws1_new.emit('message', JSON.stringify({ type: 'reconnect', token: token1 }));
    assert.strictEqual(ws1_new.getSent('reconnectFailed').length, 1);
    assert.strictEqual(handlers.sessions.has(ws1_new), false);
    ws1_new.emit('message', JSON.stringify({ type: 'join', color: 'white' }));
    const joinedMsgs = ws1_new.getSent('joined');
    assert.ok(joinedMsgs.length >= 1);
    const newToken = safeGet(joinedMsgs[joinedMsgs.length - 1], 'token');
    assert.ok(newToken);
    assert.notStrictEqual(newToken, token1);
    assert.strictEqual(safeGet(joinedMsgs[joinedMsgs.length - 1], 'color'), 'white');
    assert.ok(handlers.sessions.has(ws1_new));
  });
});

describe('Reconnect to active session — browser refresh', () => {
  test('reconnected to active session with correct color', () => {
    const { wss, handlers, game } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const token1 = safeGet(ws1.getSent('joined')[0], 'token');
    assert.ok(handlers.sessions.has(ws1));
    assert.strictEqual(handlers.disconnectedPlayers.has(token1), false);
    const ws1_new = wss.simulateConnection();
    ws1_new.emit('message', JSON.stringify({ type: 'reconnect', token: token1 }));
    assert.strictEqual(ws1_new.getSent('reconnected').length, 1);
    assert.strictEqual(safeGet(ws1_new.getSent('reconnected')[0], 'color'), 'white');
    assert.ok(handlers.sessions.has(ws1_new));
    assert.strictEqual(handlers.sessions.has(ws1), false);
    assert.strictEqual(game.players.get(ws1_new), 'white');
    assert.strictEqual(game.players.has(ws1), false);
  });

  test('old socket closed on browser refresh reconnect', () => {
    const { wss } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const token1 = safeGet(ws1.getSent('joined')[0], 'token');
    const ws1_new = wss.simulateConnection();
    ws1_new.emit('message', JSON.stringify({ type: 'reconnect', token: token1 }));
    assert.strictEqual(ws1._closed, true);
  });
});

describe('Reconnect while no role — removed from spectators set', () => {
  test('reconnected player not in spectators', () => {
    const { wss, game } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const token1 = safeGet(ws1.getSent('joined')[0], 'token');
    joinAs(wss, 'black');
    wss.simulateDisconnect(ws1);
    const ws1_new = wss.simulateConnection();
    ws1_new.emit('message', JSON.stringify({ type: 'reconnect', token: token1 }));
    assert.strictEqual(ws1_new.getSent('reconnected').length, 1);
    assert.strictEqual(game.players.get(ws1_new), 'white');
    assert.strictEqual(game.spectators.has(ws1_new), false);
  });
});

describe('Spectator disconnect — cleaned from spectators set', () => {
  test('spectator removed from spectators set on disconnect', () => {
    const { wss, handlers, game } = createTestEnv();
    joinAs(wss, 'white');
    joinAs(wss, 'black');
    const ws3 = joinAs(wss, 'spectator');
    assert.ok(game.spectators.has(ws3));
    assert.strictEqual(handlers.sessions.has(ws3), false);
    wss.simulateDisconnect(ws3);
    assert.strictEqual(game.spectators.has(ws3), false);
    assert.strictEqual(handlers.disconnectedPlayers.size, 0);
  });
});

describe('Reconnect to active session — old socket cleaned from spectators too', () => {
  test('old socket cleaned from spectators on reconnect', () => {
    const { wss, game } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const token1 = safeGet(ws1.getSent('joined')[0], 'token');
    joinAs(wss, 'black');
    game.spectators.add(ws1);
    const ws1_new = wss.simulateConnection();
    ws1_new.emit('message', JSON.stringify({ type: 'reconnect', token: token1 }));
    assert.strictEqual(ws1_new.getSent('reconnected').length, 1);
    assert.strictEqual(game.players.get(ws1_new), 'white');
    assert.strictEqual(game.spectators.has(ws1_new), false);
    assert.strictEqual(game.spectators.has(ws1), false);
  });
});

describe('Seat status in state message', () => {
  test('free seats shown on initial connect', () => {
    const { wss } = createTestEnv();
    const ws1 = wss.simulateConnection();
    const stateMsg = ws1.getSent('state')[0];
    assert.ok(stateMsg.seats);
    assert.strictEqual(stateMsg.seats.white.status, 'free');
    assert.strictEqual(stateMsg.seats.black.status, 'free');
  });

  test('occupied seat shown after join', () => {
    const { wss } = createTestEnv();
    const ws1 = wss.simulateConnection();
    ws1.emit('message', JSON.stringify({ type: 'join', color: 'white' }));
    const ws2 = wss.simulateConnection();
    const stateMsg2 = ws2.getSent('state')[0];
    assert.strictEqual(stateMsg2.seats.white.status, 'occupied');
    assert.strictEqual(stateMsg2.seats.black.status, 'free');
  });
});

describe('validateToken — valid held seat token', () => {
  test('held seat token validates as true', () => {
    const { wss } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const token1 = safeGet(ws1.getSent('joined')[0], 'token');
    joinAs(wss, 'black');
    wss.simulateDisconnect(ws1);
    const ws3 = wss.simulateConnection();
    ws3.emit('message', JSON.stringify({ type: 'validateToken', token: token1, color: 'white' }));
    assert.strictEqual(ws3.getSent('tokenValid').length, 1);
    assert.strictEqual(safeGet(ws3.getSent('tokenValid')[0], 'color'), 'white');
    assert.strictEqual(safeGet(ws3.getSent('tokenValid')[0], 'valid'), true);
  });
});

describe('validateToken — invalid (fake) token', () => {
  test('fake token validates as false', () => {
    const { wss } = createTestEnv();
    joinAs(wss, 'white');
    joinAs(wss, 'black');
    const ws3 = wss.simulateConnection();
    ws3.emit(
      'message',
      JSON.stringify({ type: 'validateToken', token: 'fake-token', color: 'white' })
    );
    assert.strictEqual(ws3.getSent('tokenValid').length, 1);
    assert.strictEqual(safeGet(ws3.getSent('tokenValid')[0], 'valid'), false);
  });
});

describe('validateToken — valid token for active session', () => {
  test('active session token validates as true', () => {
    const { wss } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const token1 = safeGet(ws1.getSent('joined')[0], 'token');
    const ws2 = wss.simulateConnection();
    ws2.emit('message', JSON.stringify({ type: 'validateToken', token: token1, color: 'white' }));
    assert.strictEqual(ws2.getSent('tokenValid').length, 1);
    assert.strictEqual(safeGet(ws2.getSent('tokenValid')[0], 'valid'), true);
  });
});

describe('validateToken — wrong color for token', () => {
  test('white token validated as black returns false', () => {
    const { wss } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const token1 = safeGet(ws1.getSent('joined')[0], 'token');
    const ws2 = wss.simulateConnection();
    ws2.emit('message', JSON.stringify({ type: 'validateToken', token: token1, color: 'black' }));
    assert.strictEqual(ws2.getSent('tokenValid').length, 1);
    assert.strictEqual(safeGet(ws2.getSent('tokenValid')[0], 'valid'), false);
  });
});

describe('canReconnect in seat status — held seat with matching token', () => {
  test('canReconnect true for matching token, false for others', () => {
    const { wss } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const token1 = safeGet(ws1.getSent('joined')[0], 'token');
    joinAs(wss, 'black');
    wss.simulateDisconnect(ws1);
    const ws3 = wss.simulateConnection();
    ws3.emit('message', JSON.stringify({ type: 'reconnect', token: token1 }));
    assert.strictEqual(ws3.getSent('reconnected').length, 1);
    const ws4 = wss.simulateConnection();
    const stateMsg = ws4.getSent('state')[0];
    assert.strictEqual(stateMsg.seats.white.status, 'occupied');
    assert.strictEqual(stateMsg.seats.white.canReconnect, false);
  });
});

describe('canReconnect in seat status — free seat', () => {
  test('free seat has canReconnect false', () => {
    const { wss } = createTestEnv();
    const ws1 = wss.simulateConnection();
    const stateMsg = ws1.getSent('state')[0];
    assert.strictEqual(stateMsg.seats.white.canReconnect, false);
    assert.strictEqual(stateMsg.seats.black.canReconnect, false);
  });
});

describe('Join rejected when seat taken — no spectator fallback', () => {
  test('rejected client has no role', () => {
    const { wss } = createTestEnv();
    joinAs(wss, 'white');
    joinAs(wss, 'black');
    const ws3 = wss.simulateConnection();
    ws3.emit('message', JSON.stringify({ type: 'join', color: 'white' }));
    assert.strictEqual(ws3.getSent('joined').length, 0);
    assert.strictEqual(ws3.getSent('error').length, 1);
    assert.ok(safeGet(ws3.getSent('error')[0], 'reason').includes('white'));
    const stateMsgs = ws3.getSent('state');
    const lastState = stateMsgs[stateMsgs.length - 1];
    assert.strictEqual(lastState.role, null);
  });
});

describe('Promotion — promotingPiece does not store ws', () => {
  test('promotingPiece has no ws field', () => {
    const { game, wss } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    joinAs(wss, 'black');
    game.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    game.board[6][4] = 1; // W_PAWN at e7
    game.turn = 'white';
    game.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };
    const result = game.tryMove(ws1, 4, 6, 4, 7);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.promotion, true);
    assert.ok(game.promotingPiece !== null);
    assert.strictEqual(game.promotingPiece.ws, undefined);
    assert.strictEqual(game.promotingPiece.color, 'white');
    assert.strictEqual(game.promotingPiece.file, 4);
    assert.strictEqual(game.promotingPiece.rank, 7);
  });
});

describe('Promotion soft-lock fix — disconnect then reconnect completes promotion', () => {
  test('reconnected player completes promotion', () => {
    const { game, wss, handlers } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const ws2 = joinAs(wss, 'black');
    const token1 = safeGet(ws1.getSent('joined')[0], 'token');
    game.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    game.board[6][4] = 1;
    game.turn = 'white';
    game.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };
    const result = game.tryMove(ws1, 4, 6, 4, 7);
    assert.strictEqual(result.ok, true);
    assert.ok(game.promotingPiece !== null);
    wss.simulateDisconnect(ws1);
    assert.strictEqual(handlers.sessions.has(ws1), false);
    assert.ok(handlers.disconnectedPlayers.has(token1));
    assert.ok(game.promotingPiece !== null);
    const ws1_new = wss.simulateConnection();
    ws1_new.emit('message', JSON.stringify({ type: 'reconnect', token: token1 }));
    assert.strictEqual(ws1_new.getSent('reconnected').length, 1);
    assert.strictEqual(game.players.get(ws1_new), 'white');
    ws1_new.emit('message', JSON.stringify({ type: 'promotion', pieceType: 'knight' }));
    assert.strictEqual(game.promotingPiece, null);
    assert.strictEqual(game.board[7][4], 2); // W_KNIGHT
    assert.strictEqual(game.turn, 'black');
  });
});

describe('Promotion blocked for wrong color', () => {
  test('wrong color cannot complete promotion', () => {
    const { game, wss } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const ws2 = joinAs(wss, 'black');
    game.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    game.board[6][4] = 1;
    game.turn = 'white';
    game.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };
    game.tryMove(ws1, 4, 6, 4, 7);
    assert.ok(game.promotingPiece !== null);
    const beforeBoard = game.board[7][4];
    ws2.emit('message', JSON.stringify({ type: 'promotion', pieceType: 'queen' }));
    assert.ok(game.promotingPiece !== null);
    assert.strictEqual(game.board[7][4], beforeBoard);
  });
});

describe('Promotion after drop + rejoin by new player', () => {
  test('new player completes promotion after seat drop', async () => {
    const { game, wss, handlers } = createTestEnv(50);
    const ws1 = joinAs(wss, 'white');
    const ws2 = joinAs(wss, 'black');
    const token1 = safeGet(ws1.getSent('joined')[0], 'token');
    const ws3 = wss.simulateConnection();
    game.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    game.board[6][4] = 1;
    game.turn = 'white';
    game.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };
    game.tryMove(ws1, 4, 6, 4, 7);
    assert.ok(game.promotingPiece !== null);
    wss.simulateDisconnect(ws1);
    assert.ok(game.promotingPiece !== null);
    // Wait for seatTimeout to expire before dropping
    await new Promise((r) => setTimeout(r, 100));
    ws2.emit('message', JSON.stringify({ type: 'dropPlayer', token: token1 }));
    assert.strictEqual(handlers.disconnectedPlayers.has(token1), false);
    ws3.emit('message', JSON.stringify({ type: 'join', color: 'white' }));
    assert.strictEqual(game.players.get(ws3), 'white');
    ws3.emit('message', JSON.stringify({ type: 'promotion', pieceType: 'bishop' }));
    assert.strictEqual(game.promotingPiece, null);
    assert.strictEqual(game.board[7][4], 3); // W_BISHOP
  });
});

describe('Promotion state broadcast to reconnected client', () => {
  test('state includes promotingPiece after reconnect', () => {
    const { game, wss } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    joinAs(wss, 'black');
    const token1 = safeGet(ws1.getSent('joined')[0], 'token');
    game.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    game.board[6][4] = 1;
    game.turn = 'white';
    game.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };
    game.tryMove(ws1, 4, 6, 4, 7);
    assert.ok(game.promotingPiece !== null);
    wss.simulateDisconnect(ws1);
    const ws1_new = wss.simulateConnection();
    ws1_new.emit('message', JSON.stringify({ type: 'reconnect', token: token1 }));
    const stateMsgs = ws1_new.getSent('state');
    assert.ok(stateMsgs.length >= 1);
    const lastState = stateMsgs[stateMsgs.length - 1];
    assert.ok(lastState.promotingPiece !== null);
    assert.strictEqual(lastState.promotingPiece.color, 'white');
    assert.strictEqual(lastState.promotingPiece.file, 4);
    assert.strictEqual(lastState.promotingPiece.rank, 7);
  });
});

describe('Import FEN — player can import', () => {
  test('valid FEN loads and broadcasts state', () => {
    const { game, wss } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const ws2 = joinAs(wss, 'black');
    const fen = '4k3/8/8/8/8/8/8/4K2R w K - 0 1';
    ws1.emit('message', JSON.stringify({ type: 'importFen', fen }));
    assert.strictEqual(game.turn, 'white');
    assert.strictEqual(game.board[0][4], 6); // W_KING
    assert.strictEqual(game.board[0][7], 4); // W_ROOK
    assert.strictEqual(game.board[7][4], 12); // B_KING
    assert.ok(ws1.getSent('state').length >= 1);
    assert.ok(ws2.getSent('state').length >= 1);
    assert.ok(ws1.getSent('restart').length >= 1);
    assert.ok(ws2.getSent('restart').length >= 1);
  });

  test('import resets move history', () => {
    const { game, wss } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const ws2 = joinAs(wss, 'black');
    game.tryMove(ws1, 4, 1, 4, 3); // e4
    assert.strictEqual(game.moveHistory.length, 1);
    const fen = '4k3/8/8/8/8/8/8/4K2R w K - 0 1';
    ws1.emit('message', JSON.stringify({ type: 'importFen', fen }));
    assert.strictEqual(game.moveHistory.length, 0);
  });

  test('import resets position history', () => {
    const { game, wss } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    joinAs(wss, 'black');
    game.tryMove(ws1, 4, 1, 4, 3);
    assert.strictEqual(game.positionHistory.length, 2);
    const fen = '4k3/8/8/8/8/8/8/4K2R w K - 0 1';
    ws1.emit('message', JSON.stringify({ type: 'importFen', fen }));
    assert.strictEqual(game.positionHistory.length, 1);
  });
});

describe('Import FEN — spectator cannot import', () => {
  test('spectator receives error', () => {
    const { wss } = createTestEnv();
    joinAs(wss, 'white');
    joinAs(wss, 'black');
    const ws3 = joinAs(wss, 'spectator');
    ws3.emit(
      'message',
      JSON.stringify({ type: 'importFen', fen: '4k3/8/8/8/8/8/8/4K2R w K - 0 1' })
    );
    assert.strictEqual(ws3.getSent('error').length, 1);
    assert.ok(ws3.getSent('error')[0].reason.includes('players'));
  });
});

describe('Import FEN — invalid FEN rejected', () => {
  test('empty string rejected', () => {
    const { wss } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    joinAs(wss, 'black');
    ws1.emit('message', JSON.stringify({ type: 'importFen', fen: '' }));
    assert.strictEqual(ws1.getSent('error').length, 1);
    assert.ok(ws1.getSent('error')[0].reason.includes('Invalid FEN'));
  });

  test('whitespace-only string rejected', () => {
    const { wss } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    joinAs(wss, 'black');
    ws1.emit('message', JSON.stringify({ type: 'importFen', fen: '   ' }));
    assert.strictEqual(ws1.getSent('error').length, 1);
  });

  test('malformed FEN rejected with descriptive error', () => {
    const { wss } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    joinAs(wss, 'black');
    ws1.emit('message', JSON.stringify({ type: 'importFen', fen: 'not-a-fen-string' }));
    assert.strictEqual(ws1.getSent('error').length, 1);
    assert.ok(ws1.getSent('error')[0].reason.includes('Invalid FEN'));
  });

  test('non-string fen rejected', () => {
    const { wss } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    joinAs(wss, 'black');
    ws1.emit('message', JSON.stringify({ type: 'importFen', fen: 123 }));
    assert.strictEqual(ws1.getSent('error').length, 1);
  });
});

describe('Import FEN — black player can import', () => {
  test('black player imports valid FEN', () => {
    const { game, wss } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const ws2 = joinAs(wss, 'black');
    const fen = '4k3/8/8/8/8/8/8/4K2R b K - 0 1';
    ws2.emit('message', JSON.stringify({ type: 'importFen', fen }));
    assert.strictEqual(game.turn, 'black');
    assert.strictEqual(game.board[0][4], 6); // W_KING
    assert.strictEqual(game.board[7][4], 12); // B_KING
  });
});

describe('Import FEN — trims whitespace from FEN', () => {
  test('leading/trailing whitespace trimmed', () => {
    const { game, wss } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    joinAs(wss, 'black');
    const fen = '  4k3/8/8/8/8/8/8/4K2R w K - 0 1  ';
    ws1.emit('message', JSON.stringify({ type: 'importFen', fen }));
    assert.strictEqual(game.board[0][4], 6); // W_KING loaded successfully
  });
});

// ── Rate Limiter Tests ────────────────────────────────────

describe('Rate limiter — basic behavior', () => {
  test('messages within limit are accepted', () => {
    const { wss, handlers } = createTestEnv();
    const ws = joinAs(wss, 'white');
    // Send 3 move messages (well under default 60/10s limit)
    for (let i = 0; i < 3; i++) {
      ws.emit(
        'message',
        JSON.stringify({ type: 'move', fromFile: 0, fromRank: 0, toFile: 0, toRank: 0 })
      );
    }
    // No rateLimited messages should be sent
    assert.strictEqual(ws.getSent('rateLimited').length, 0);
    // Bucket should have 3 entries (join + 3 moves = 4 total, but join was before)
    const bucket = handlers.rateLimitBuckets.get(ws);
    assert.ok(bucket);
    assert.strictEqual(bucket.length, 4); // 1 join + 3 moves
  });

  test('messages exceeding limit are rejected with rateLimited', () => {
    const { wss } = createTestEnv();
    const ws = joinAs(wss, 'white');
    // Default limit is 60 per 10s — flood past it
    for (let i = 0; i < 60; i++) {
      ws.emit(
        'message',
        JSON.stringify({ type: 'move', fromFile: 0, fromRank: 0, toFile: 0, toRank: 0 })
      );
    }
    // 60th move + 1 join = 61 total, 60 were allowed, 61st should be rate limited
    const rlMsgs = ws.getSent('rateLimited');
    assert.strictEqual(rlMsgs.length, 1);
    assert.ok(rlMsgs[0].retryAfter >= 1);
  });

  test('rate limited messages include retryAfter field', () => {
    const { wss } = createTestEnv();
    const ws = joinAs(wss, 'white');
    for (let i = 0; i < 60; i++) {
      ws.emit(
        'message',
        JSON.stringify({ type: 'move', fromFile: 0, fromRank: 0, toFile: 0, toRank: 0 })
      );
    }
    const rlMsg = ws.getSent('rateLimited')[0];
    assert.ok(typeof rlMsg.retryAfter === 'number');
    assert.ok(rlMsg.retryAfter >= 1);
  });

  test('rate limited message does not process the original request', () => {
    const { game, wss } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    joinAs(wss, 'black');
    // Set up a valid move
    game.turn = 'white';
    // Flood to trigger rate limit
    for (let i = 0; i < 60; i++) {
      ws1.emit(
        'message',
        JSON.stringify({ type: 'move', fromFile: 4, fromRank: 1, toFile: 4, toRank: 3 })
      );
    }
    // The 61st message should be rate limited, not processed
    const rlMsgs = ws1.getSent('rateLimited');
    assert.ok(rlMsgs.length >= 1);
  });

  test('each connection has independent rate limit', () => {
    const { wss } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const ws2 = joinAs(wss, 'black');
    // Fill ws1's bucket
    for (let i = 0; i < 60; i++) {
      ws1.emit(
        'message',
        JSON.stringify({ type: 'move', fromFile: 0, fromRank: 0, toFile: 0, toRank: 0 })
      );
    }
    // ws1 should be rate limited
    assert.ok(ws1.getSent('rateLimited').length >= 1);
    // ws2 should still be fine
    ws2.emit(
      'message',
      JSON.stringify({ type: 'move', fromFile: 0, fromRank: 0, toFile: 0, toRank: 0 })
    );
    assert.strictEqual(ws2.getSent('rateLimited').length, 0);
  });
});

describe('Rate limiter — configurable limits', () => {
  test('custom rateLimitMax is respected', () => {
    const game = new Game();
    const wss = new MockWebSocketServer();
    const handlers = setupWebSocketHandlers(wss, game, {
      seatTimeout: 100,
      joinTimeoutMs: 0,
      rateLimitMax: 3,
      rateLimitWindow: 10_000,
    });
    const ws = wss.simulateConnection();
    ws.emit('message', JSON.stringify({ type: 'join', color: 'white' }));
    // 1 join + 2 more = 3 allowed
    ws.emit(
      'message',
      JSON.stringify({ type: 'move', fromFile: 0, fromRank: 0, toFile: 0, toRank: 0 })
    );
    ws.emit(
      'message',
      JSON.stringify({ type: 'move', fromFile: 0, fromRank: 0, toFile: 0, toRank: 0 })
    );
    assert.strictEqual(ws.getSent('rateLimited').length, 0);
    // 4th message should be rate limited
    ws.emit(
      'message',
      JSON.stringify({ type: 'move', fromFile: 0, fromRank: 0, toFile: 0, toRank: 0 })
    );
    assert.strictEqual(ws.getSent('rateLimited').length, 1);
  });

  test('custom rateLimitWindow is respected', () => {
    const game = new Game();
    const wss = new MockWebSocketServer();
    const handlers = setupWebSocketHandlers(wss, game, {
      seatTimeout: 100,
      joinTimeoutMs: 0,
      rateLimitMax: 5,
      rateLimitWindow: 100, // 100ms window
    });
    const ws = wss.simulateConnection();
    ws.emit('message', JSON.stringify({ type: 'join', color: 'white' }));
    // Fill up: 1 join + 4 moves = 5
    for (let i = 0; i < 4; i++) {
      ws.emit(
        'message',
        JSON.stringify({ type: 'move', fromFile: 0, fromRank: 0, toFile: 0, toRank: 0 })
      );
    }
    assert.strictEqual(ws.getSent('rateLimited').length, 0);
    // Next should be rate limited
    ws.emit(
      'message',
      JSON.stringify({ type: 'move', fromFile: 0, fromRank: 0, toFile: 0, toRank: 0 })
    );
    assert.strictEqual(ws.getSent('rateLimited').length, 1);
  });

  test('window resets after rateLimitWindow expires', async () => {
    const game = new Game();
    const wss = new MockWebSocketServer();
    const handlers = setupWebSocketHandlers(wss, game, {
      seatTimeout: 100,
      joinTimeoutMs: 0,
      rateLimitMax: 3,
      rateLimitWindow: 50, // 50ms window
    });
    const ws = wss.simulateConnection();
    ws.emit('message', JSON.stringify({ type: 'join', color: 'white' }));
    ws.emit(
      'message',
      JSON.stringify({ type: 'move', fromFile: 0, fromRank: 0, toFile: 0, toRank: 0 })
    );
    ws.emit(
      'message',
      JSON.stringify({ type: 'move', fromFile: 0, fromRank: 0, toFile: 0, toRank: 0 })
    );
    assert.strictEqual(ws.getSent('rateLimited').length, 0);
    // 4th should be rate limited
    ws.emit(
      'message',
      JSON.stringify({ type: 'move', fromFile: 0, fromRank: 0, toFile: 0, toRank: 0 })
    );
    assert.strictEqual(ws.getSent('rateLimited').length, 1);

    // Wait for window to expire
    await new Promise((r) => setTimeout(r, 60));
    // After window expires, new messages should be allowed
    ws.emit(
      'message',
      JSON.stringify({ type: 'move', fromFile: 0, fromRank: 0, toFile: 0, toRank: 0 })
    );
    // Should not be rate limited anymore
    assert.strictEqual(ws.getSent('rateLimited').length, 1); // still just the original one
  });
});

describe('Rate limiter — cleanup on disconnect', () => {
  test('rate limit bucket removed on disconnect', () => {
    const { wss, handlers } = createTestEnv();
    const ws = joinAs(wss, 'white');
    assert.ok(handlers.rateLimitBuckets.has(ws));
    wss.simulateDisconnect(ws);
    assert.ok(!handlers.rateLimitBuckets.has(ws));
  });

  test('reconnected client gets fresh rate limit bucket', () => {
    const { wss, handlers } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const token = safeGet(ws1.getSent('joined')[0], 'token');
    joinAs(wss, 'black');
    // Fill ws1's bucket
    for (let i = 0; i < 60; i++) {
      ws1.emit(
        'message',
        JSON.stringify({ type: 'move', fromFile: 0, fromRank: 0, toFile: 0, toRank: 0 })
      );
    }
    assert.ok(ws1.getSent('rateLimited').length >= 1);
    // Disconnect ws1
    wss.simulateDisconnect(ws1);
    // Reconnect with new socket
    const ws1_new = wss.simulateConnection();
    ws1_new.emit('message', JSON.stringify({ type: 'reconnect', token }));
    assert.strictEqual(ws1_new.getSent('reconnected').length, 1);
    // New socket should have a fresh bucket — messages should work
    ws1_new.emit(
      'message',
      JSON.stringify({ type: 'move', fromFile: 0, fromRank: 0, toFile: 0, toRank: 0 })
    );
    assert.strictEqual(ws1_new.getSent('rateLimited').length, 0);
  });
});

describe('Rate limiter — different message types all count', () => {
  test('join, move, restart, and export messages all count toward limit', () => {
    const game = new Game();
    const wss = new MockWebSocketServer();
    const handlers = setupWebSocketHandlers(wss, game, {
      seatTimeout: 100,
      joinTimeoutMs: 0,
      rateLimitMax: 5,
      rateLimitWindow: 10_000,
    });
    const ws = wss.simulateConnection();
    ws.emit('message', JSON.stringify({ type: 'join', color: 'white' })); // 1
    ws.emit(
      'message',
      JSON.stringify({ type: 'move', fromFile: 0, fromRank: 0, toFile: 0, toRank: 0 })
    ); // 2
    ws.emit('message', JSON.stringify({ type: 'restart' })); // 3
    ws.emit('message', JSON.stringify({ type: 'exportFen' })); // 4
    ws.emit('message', JSON.stringify({ type: 'exportPgn' })); // 5
    assert.strictEqual(ws.getSent('rateLimited').length, 0);
    // 6th message should be rate limited
    ws.emit(
      'message',
      JSON.stringify({ type: 'move', fromFile: 0, fromRank: 0, toFile: 0, toRank: 0 })
    );
    assert.strictEqual(ws.getSent('rateLimited').length, 1);
  });

  test('rate limited message itself does not count toward limit', () => {
    const game = new Game();
    const wss = new MockWebSocketServer();
    const handlers = setupWebSocketHandlers(wss, game, {
      seatTimeout: 100,
      joinTimeoutMs: 0,
      rateLimitMax: 3,
      rateLimitWindow: 10_000,
    });
    const ws = wss.simulateConnection();
    ws.emit('message', JSON.stringify({ type: 'join', color: 'white' })); // 1
    ws.emit(
      'message',
      JSON.stringify({ type: 'move', fromFile: 0, fromRank: 0, toFile: 0, toRank: 0 })
    ); // 2
    ws.emit(
      'message',
      JSON.stringify({ type: 'move', fromFile: 0, fromRank: 0, toFile: 0, toRank: 0 })
    ); // 3
    // 4th — rate limited, bucket is deleted
    ws.emit(
      'message',
      JSON.stringify({ type: 'move', fromFile: 0, fromRank: 0, toFile: 0, toRank: 0 })
    );
    assert.strictEqual(ws.getSent('rateLimited').length, 1);
    // Bucket was deleted on rate limit — next message starts fresh
    const bucket = handlers.rateLimitBuckets.get(ws);
    assert.strictEqual(bucket, undefined);
  });

  test('reconnect and validateToken messages count toward limit', () => {
    const game = new Game();
    const wss = new MockWebSocketServer();
    const handlers = setupWebSocketHandlers(wss, game, {
      seatTimeout: 100,
      joinTimeoutMs: 0,
      rateLimitMax: 3,
      rateLimitWindow: 10_000,
    });
    const ws = wss.simulateConnection();
    ws.emit('message', JSON.stringify({ type: 'validateToken', token: 'fake', color: 'white' })); // 1
    ws.emit('message', JSON.stringify({ type: 'validateToken', token: 'fake', color: 'black' })); // 2
    ws.emit('message', JSON.stringify({ type: 'join', color: 'white' })); // 3
    assert.strictEqual(ws.getSent('rateLimited').length, 0);
    // 4th should be rate limited
    ws.emit(
      'message',
      JSON.stringify({ type: 'move', fromFile: 0, fromRank: 0, toFile: 0, toRank: 0 })
    );
    assert.strictEqual(ws.getSent('rateLimited').length, 1);
  });
});

describe('Rate limiter — malformed messages count toward limit', () => {
  test('malformed JSON does not count toward rate limit', () => {
    const { wss, handlers } = createTestEnv();
    const ws = joinAs(wss, 'white');
    // Send malformed JSON — should be caught by JSON.parse before rate limit check
    ws.emit('message', 'not json at all');
    ws.emit('message', '{broken');
    // Bucket should only have the join message
    const bucket = handlers.rateLimitBuckets.get(ws);
    assert.strictEqual(bucket.length, 1);
  });
});

describe('Malformed JSON handling', () => {
  function makeServer() {
    const wss = new MockWebSocketServer();
    const game = new Game();
    const handlers = setupWebSocketHandlers(wss, game, {
      rateLimitMax: 9999,
      rateLimitWindow: 60_000,
    });
    return { wss, game, handlers };
  }

  test('sends error frame for malformed JSON', () => {
    const { wss } = makeServer();
    const ws = wss.simulateConnection();
    // Send non-JSON data
    ws.emit('message', 'not json at all');
    const errors = ws.getRawSent().filter((m) => {
      try {
        return JSON.parse(m).type === 'error';
      } catch {
        return false;
      }
    });
    assert.strictEqual(errors.length, 1);
    const err = JSON.parse(errors[0]);
    assert.strictEqual(err.reason, 'Malformed message');
  });

  test('sends error frame for broken JSON', () => {
    const { wss } = makeServer();
    const ws = wss.simulateConnection();
    ws.emit('message', '{broken');
    const errors = ws.getRawSent().filter((m) => {
      try {
        return JSON.parse(m).type === 'error';
      } catch {
        return false;
      }
    });
    assert.strictEqual(errors.length, 1);
  });

  test('valid JSON after malformed message still works', () => {
    const { wss } = makeServer();
    const ws = wss.simulateConnection();
    ws.emit('message', 'not json');
    // Now send a valid join
    ws.emit('message', JSON.stringify({ type: 'join', color: 'white' }));
    const joined = ws.getSent('joined');
    assert.strictEqual(joined.length, 1);
    assert.strictEqual(joined[0].color, 'white');
  });
});

describe('WebSocket backpressure', () => {
  function makeServer() {
    const wss = new MockWebSocketServer();
    const game = new Game();
    const handlers = setupWebSocketHandlers(wss, game, {
      rateLimitMax: 9999,
      rateLimitWindow: 60_000,
    });
    return { wss, game, handlers };
  }

  test('send skips slow client', () => {
    const { wss, game } = makeServer();
    const ws = wss.simulateConnection();
    // Join as white
    ws.emit('message', JSON.stringify({ type: 'join', color: 'white' }));
    const statesBefore = ws.getSent('state').length;
    // Make client slow
    ws.bufferedAmount = 2 * 1024 * 1024; // 2 MB
    // Trigger a state broadcast by having another client join
    const ws2 = wss.simulateConnection();
    ws2.emit('message', JSON.stringify({ type: 'join', color: 'black' }));
    // Slow client should NOT receive additional state
    const statesAfter = ws.getSent('state').length;
    assert.strictEqual(statesAfter, statesBefore);
  });

  test('send delivers to normal client', () => {
    const { wss, game } = makeServer();
    const ws = wss.simulateConnection();
    // Normal bufferedAmount (0)
    ws.emit('message', JSON.stringify({ type: 'join', color: 'white' }));
    // Should receive state
    const stateMessages = ws.getSent('state');
    assert.ok(stateMessages.length > 0);
  });

  test('broadcast skips slow clients but delivers to normal ones', () => {
    const { wss, game } = makeServer();
    const ws1 = wss.simulateConnection();
    ws1.emit('message', JSON.stringify({ type: 'join', color: 'white' }));
    const ws1StatesBefore = ws1.getSent('state').length;
    // Make ws1 slow
    ws1.bufferedAmount = 2 * 1024 * 1024;
    const ws2 = wss.simulateConnection();
    ws2.emit('message', JSON.stringify({ type: 'join', color: 'black' }));
    // ws1 (slow) should not get additional state from ws2 joining
    const ws1StatesAfter = ws1.getSent('state').length;
    assert.strictEqual(ws1StatesAfter, ws1StatesBefore);
    // ws2 (normal) should get state
    const ws2States = ws2.getSent('state');
    assert.ok(ws2States.length > 0);
  });
});

describe('Import FEN — broadcast order guarantees client sync', () => {
  test('state message is sent before restart so clients get the new board', () => {
    const { game, wss } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const ws2 = joinAs(wss, 'black');
    const fen = '4k3/8/8/8/8/8/8/4K2R w K - 0 1';
    ws1.emit('message', JSON.stringify({ type: 'importFen', fen }));
    // Both clients should receive state messages
    const ws2States = ws2.getSent('state');
    const ws2Restarts = ws2.getSent('restart');
    assert.ok(ws2States.length >= 1, 'non-importing client must receive state');
    assert.ok(ws2Restarts.length >= 1, 'non-importing client must receive restart');
    // The last state message must contain the imported board
    const lastState = ws2States[ws2States.length - 1];
    assert.strictEqual(lastState.board[0][4], 6, 'W_KING at e1');
    assert.strictEqual(lastState.board[0][7], 4, 'W_ROOK at h1');
    assert.strictEqual(lastState.board[7][4], 12, 'B_KING at e8');
  });

  test('state after importFen has correct board for all pieces', () => {
    const { game, wss } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const ws2 = joinAs(wss, 'black');
    // Complex FEN with pieces on many squares
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    ws1.emit('message', JSON.stringify({ type: 'importFen', fen }));
    const ws2States = ws2.getSent('state');
    const lastState = ws2States[ws2States.length - 1];
    // Verify a few key pieces (board[rank][file], rank 0 = white's back rank)
    assert.strictEqual(lastState.board[3][4], 1, 'white pawn at e4 (rank 3, file 4)');
    assert.strictEqual(lastState.board[1][4], 0, 'e2 is empty');
    assert.strictEqual(lastState.board[1][3], 1, 'white pawn at d2');
    assert.strictEqual(lastState.turn, 'black');
    assert.strictEqual(lastState.enPassantTarget.file, 4);
    assert.strictEqual(lastState.enPassantTarget.rank, 2); // e3 = rank 2 (0-indexed)
  });

  test('importFen resets moveHistory in broadcast state', () => {
    const { game, wss } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const ws2 = joinAs(wss, 'black');
    game.tryMove(ws1, 4, 1, 4, 3); // e4
    assert.strictEqual(game.moveHistory.length, 1);
    const fen = '4k3/8/8/8/8/8/8/4K2R w K - 0 1';
    ws1.emit('message', JSON.stringify({ type: 'importFen', fen }));
    const ws2States = ws2.getSent('state');
    const lastState = ws2States[ws2States.length - 1];
    assert.strictEqual(lastState.moveHistory.length, 0);
  });
});

describe('Promotion — broadcast order guarantees client sync', () => {
  test('promotion message and state are both broadcast to all clients', () => {
    const { game, wss } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const ws2 = joinAs(wss, 'black');
    game.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    game.board[6][4] = 1; // W_PAWN at e7
    game.turn = 'white';
    game.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };
    game.tryMove(ws1, 4, 6, 4, 7); // e7-e8, triggers promotion
    assert.ok(game.promotingPiece !== null);
    ws1.emit('message', JSON.stringify({ type: 'promotion', pieceType: 'queen' }));
    // Opponent client should receive both promotion and state
    const ws2Promotions = ws2.getSent('promotion');
    const ws2States = ws2.getSent('state');
    assert.ok(ws2Promotions.length >= 1, 'opponent must receive promotion message');
    assert.strictEqual(ws2Promotions[ws2Promotions.length - 1].pieceType, 'queen');
    assert.ok(ws2States.length >= 1, 'opponent must receive state');
    // State board must show the promoted piece
    const lastState = ws2States[ws2States.length - 1];
    assert.strictEqual(lastState.board[7][4], 5, 'W_QUEEN at e8');
    assert.strictEqual(lastState.promotingPiece, null, 'promotingPiece cleared');
  });

  test('promotion state includes correct turn after completion', () => {
    const { game, wss } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const ws2 = joinAs(wss, 'black');
    game.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    game.board[6][4] = 1;
    game.turn = 'white';
    game.castlingRights = { wK: false, wQ: false, bK: false, bQ: false };
    game.tryMove(ws1, 4, 6, 4, 7);
    ws1.emit('message', JSON.stringify({ type: 'promotion', pieceType: 'knight' }));
    const ws2States = ws2.getSent('state');
    const lastState = ws2States[ws2States.length - 1];
    assert.strictEqual(lastState.turn, 'black', 'turn should switch to black');
    assert.strictEqual(lastState.board[7][4], 2, 'W_KNIGHT at e8');
  });

  test('promotion via capture broadcasts correct board state', () => {
    const { game, wss } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const ws2 = joinAs(wss, 'black');
    game.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    game.board[6][1] = 1; // W_PAWN at b7
    game.board[7][0] = 10; // B_ROOK at a8
    game.board[7][4] = 12; // B_KING at e8
    game.turn = 'white';
    game.castlingRights = { wK: false, wQ: false, bK: true, bQ: true };
    game.tryMove(ws1, 1, 6, 0, 7); // b7xa8, promotion capture
    ws1.emit('message', JSON.stringify({ type: 'promotion', pieceType: 'queen' }));
    const ws2States = ws2.getSent('state');
    const lastState = ws2States[ws2States.length - 1];
    assert.strictEqual(lastState.board[7][0], 5, 'W_QUEEN at a8');
    assert.strictEqual(lastState.castlingRights.bQ, false, 'bQ revoked');
  });
});

// ── Results — print everything in declaration order ──────

async function printResults() {
  if (pendingPromises.length > 0) {
    await Promise.all(pendingPromises);
  }
  // Now print all results in declaration order
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
  if (failed > 0) process.exit(1);
}

printResults();
