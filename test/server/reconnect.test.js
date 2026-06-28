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
  }

  send(data) {
    this.sentMessages.push(JSON.parse(data));
  }

  getSent(type) {
    return this.sentMessages.filter(m => m.type === type);
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

// ── Test runner (matches test_chess.js format) ────────────

let passed = 0;
let failed = 0;
let total = 0;
let asyncTestsPending = 0;
let resultsPrinted = false;

function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

function describe(label, fn) {
  console.log(`\n${label}`);
  fn();
}

// Async test that waits for done() callback
function asyncTest(name, fn) {
  total++;
  console.log(`  ${name}`);
  asyncTestsPending++;
  try {
    fn(() => {
      passed++;
      console.log(`    ✓ passed`);
      asyncTestsPending--;
      checkAllDone();
    });
  } catch (e) {
    failed++;
    console.log(`    ✗ ${e.message}`);
    asyncTestsPending--;
    checkAllDone();
  }
}

function checkAllDone() {
  if (asyncTestsPending <= 0 && !resultsPrinted) {
    resultsPrinted = true;
    printResults();
  }
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
  test('reconnect fails after seat was dropped', () => {
    const { wss, handlers } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const token1 = safeGet(ws1.getSent('joined')[0], 'token');
    const ws2 = joinAs(wss, 'black');
    wss.simulateDisconnect(ws1);
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
  asyncTest('seats freed and game reset', (done) => {
    const { wss, handlers, game } = createTestEnv(5);
    const ws1 = joinAs(wss, 'white');
    const ws2 = joinAs(wss, 'black');
    wss.simulateDisconnect(ws1);
    wss.simulateDisconnect(ws2);
    assert.strictEqual(handlers.disconnectedPlayers.size, 2);
    setTimeout(() => {
      assert.strictEqual(handlers.disconnectedPlayers.size, 0);
      assert.strictEqual(game.turn, 'white');
      done();
    }, 20);
  });
});

describe('Both disconnected — with spectator, auto-free', () => {
  asyncTest('spectator receives gameAvailable after timeout', (done) => {
    const { wss, handlers, game } = createTestEnv(5);
    const ws1 = joinAs(wss, 'white');
    const ws2 = joinAs(wss, 'black');
    const ws3 = joinAs(wss, 'spectator');
    wss.simulateDisconnect(ws1);
    wss.simulateDisconnect(ws2);
    setTimeout(() => {
      assert.strictEqual(handlers.disconnectedPlayers.size, 0);
      assert.strictEqual(ws3.getSent('gameAvailable').length, 1);
      assert.strictEqual(game.turn, 'white');
      done();
    }, 20);
  });
});

describe('One reconnects during both-disconnected — timer stops', () => {
  asyncTest('timer stopped — remaining seat still held', (done) => {
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
    setTimeout(() => {
      assert.strictEqual(handlers.disconnectedPlayers.size, 1);
      done();
    }, 20);
  });
});

describe('Spectator connects while both disconnected — timer starts', () => {
  asyncTest('seats freed after spectator joined', (done) => {
    const { wss, handlers } = createTestEnv(10);
    const ws1 = joinAs(wss, 'white');
    const ws2 = joinAs(wss, 'black');
    wss.simulateDisconnect(ws1);
    wss.simulateDisconnect(ws2);
    assert.strictEqual(handlers.disconnectedPlayers.size, 2);
    const ws3 = joinAs(wss, 'spectator');
    assert.strictEqual(handlers.disconnectedPlayers.size, 2);
    setTimeout(() => {
      assert.strictEqual(handlers.disconnectedPlayers.size, 0);
      assert.strictEqual(ws3.getSent('gameAvailable').length, 1);
      done();
    }, 50);
  });
});

describe('Reconnect after both-disconnected timer expired', () => {
  asyncTest('token invalidated, must join fresh', (done) => {
    const { wss, handlers, game } = createTestEnv(10);
    const ws1 = joinAs(wss, 'white');
    const token1 = safeGet(ws1.getSent('joined')[0], 'token');
    const ws2 = joinAs(wss, 'black');
    wss.simulateDisconnect(ws1);
    wss.simulateDisconnect(ws2);
    assert.strictEqual(handlers.disconnectedPlayers.size, 2);
    setTimeout(() => {
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
      done();
    }, 50);
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
    ws3.emit('message', JSON.stringify({ type: 'validateToken', token: 'fake-token', color: 'white' }));
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
    game.castlingRights = { wK:false, wQ:false, bK:false, bQ:false };
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
    game.castlingRights = { wK:false, wQ:false, bK:false, bQ:false };
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
    game.castlingRights = { wK:false, wQ:false, bK:false, bQ:false };
    game.tryMove(ws1, 4, 6, 4, 7);
    assert.ok(game.promotingPiece !== null);
    const beforeBoard = game.board[7][4];
    ws2.emit('message', JSON.stringify({ type: 'promotion', pieceType: 'queen' }));
    assert.ok(game.promotingPiece !== null);
    assert.strictEqual(game.board[7][4], beforeBoard);
  });
});

describe('Promotion after drop + rejoin by new player', () => {
  test('new player completes promotion after seat drop', () => {
    const { game, wss, handlers } = createTestEnv();
    const ws1 = joinAs(wss, 'white');
    const ws2 = joinAs(wss, 'black');
    const token1 = safeGet(ws1.getSent('joined')[0], 'token');
    const ws3 = wss.simulateConnection();
    game.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    game.board[6][4] = 1;
    game.turn = 'white';
    game.castlingRights = { wK:false, wQ:false, bK:false, bQ:false };
    game.tryMove(ws1, 4, 6, 4, 7);
    assert.ok(game.promotingPiece !== null);
    wss.simulateDisconnect(ws1);
    assert.ok(game.promotingPiece !== null);
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
    game.castlingRights = { wK:false, wQ:false, bK:false, bQ:false };
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
    ws3.emit('message', JSON.stringify({ type: 'importFen', fen: '4k3/8/8/8/8/8/8/4K2R w K - 0 1' }));
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

// ── Results ───────────────────────────────────────────────

function printResults() {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

// Safety net: if async tests hang, print results after 3s
setTimeout(() => {
  if (!resultsPrinted) {
    resultsPrinted = true;
    console.log('\n[WARNING: async tests did not complete in time]');
    printResults();
  }
}, 3000);
