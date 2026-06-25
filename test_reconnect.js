// ═══════════════════════════════════════════════════════════
//  RECONNECTION / SESSION TESTS
// ═══════════════════════════════════════════════════════════

const { Game } = require('./shared/chess');
const { setupWebSocketHandlers } = require('./server');

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

// ── Test harness ──────────────────────────────────────────

let passed = 0;
let failed = 0;
let asyncTestsPending = 0;
let resultsPrinted = false;

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.log(`  ✗ ${message}`);
  }
}

// Safe assert that never throws — wraps in try/catch
function safeAssert(condition, message) {
  try {
    assert(condition, message);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${message} [error: ${e.message}]`);
  }
}

// Run a test block, catching any errors as failed assertions
function testBlock(name, fn) {
  console.log(`\n${name}`);
  try {
    fn();
  } catch (e) {
    failed++;
    console.log(`  ✗ [test error: ${e.message}]`);
  }
}

// Async test that waits for done() callback
function asyncTest(name, fn) {
  console.log(`\n${name}`);
  asyncTestsPending++;
  try {
    fn(() => {
      asyncTestsPending--;
      checkAllDone();
    });
  } catch (e) {
    failed++;
    console.log(`  ✗ [test error: ${e.message}]`);
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

function createTestEnv(seatTimeout) {
  const game = new Game();
  const wss = new MockWebSocketServer();
  const handlers = setupWebSocketHandlers(wss, game, {
    seatTimeout: seatTimeout != null ? seatTimeout : 100,
    joinTimeoutMs: 0, // disable auto-join timeout for tests
  });
  return { game, wss, handlers };
}

// Helper: connect and explicitly join as a color
function joinAs(wss, color) {
  const ws = wss.simulateConnection();
  ws.emit('message', JSON.stringify({ type: 'join', color }));
  return ws;
}

// Helper: safely get a property from a message, returns undefined on error
function safeGet(obj, ...keys) {
  try {
    let current = obj;
    for (const key of keys) current = current?.[key];
    return current;
  } catch {
    return undefined;
  }
}

// Assert that a value is defined (not null/undefined)
function assertDefined(value, message) {
  safeAssert(value !== undefined && value !== null, message);
}

// ── Tests ─────────────────────────────────────────────────

testBlock('Session tokens and join flow', () => {
  const { wss, handlers } = createTestEnv();

  // First player joins as white
  const ws1 = joinAs(wss, 'white');
  safeAssert(ws1.getSent('joined').length === 1, 'first player receives joined message');
  safeAssert(safeGet(ws1.getSent('joined')[0], 'color') === 'white', 'first player is white');
  assertDefined(safeGet(ws1.getSent('joined')[0], 'token'), 'first player receives token');
  safeAssert(handlers.sessions.has(ws1), 'session created for first player');
  safeAssert(safeGet(handlers.sessions.get(ws1), 'color') === 'white', 'session stores correct color');

  // Second player joins as black
  const ws2 = joinAs(wss, 'black');
  safeAssert(safeGet(ws2.getSent('joined')[0], 'color') === 'black', 'second player is black');
  assertDefined(safeGet(ws2.getSent('joined')[0], 'token'), 'second player receives token');

  // Third player joins as spectator
  const ws3 = joinAs(wss, 'spectator');
  safeAssert(safeGet(ws3.getSent('joined')[0], 'color') === 'spectator', 'spectator receives joined');
  // state[0] = initial (role=null), state[1] = after join (role=spectator)
  safeAssert(safeGet(ws3.getSent('state'), 1, 'role') === 'spectator', 'third player is spectator via state');

  // Fourth player tries to join white — falls back to spectator
  const ws4 = joinAs(wss, 'white');
  safeAssert(safeGet(ws4.getSent('joined')[0], 'color') === 'spectator', 'falls back to spectator when seat taken');
});

testBlock('Disconnect — seat held with token', () => {
  const { wss, handlers, game } = createTestEnv();

  const ws1 = joinAs(wss, 'white');
  const token1 = safeGet(ws1.getSent('joined')[0], 'token');

  const ws2 = joinAs(wss, 'black');

  // Disconnect ws1 (white)
  wss.simulateDisconnect(ws1);

  safeAssert(handlers.sessions.has(ws1) === false, 'session removed from sessions map');
  safeAssert(handlers.disconnectedPlayers.has(token1), 'player stored in disconnectedPlayers');
  safeAssert(safeGet(handlers.disconnectedPlayers.get(token1), 'color') === 'white', 'disconnected entry has correct color');
  safeAssert(game.players.has(ws1) === false, 'player removed from game.players');

  // ws2 should have received playerDisconnected
  const pdMsgs = ws2.getSent('playerDisconnected');
  safeAssert(pdMsgs.length === 1, 'opponent receives playerDisconnected');
  safeAssert(safeGet(pdMsgs[0], 'color') === 'white', 'playerDisconnected has correct color');
  safeAssert(safeGet(pdMsgs[0], 'token') === token1, 'playerDisconnected includes token');
  assertDefined(safeGet(pdMsgs[0], 'disconnectedAt'), 'playerDisconnected includes timestamp');
});

testBlock('Reconnect with valid token', () => {
  const { wss, handlers, game } = createTestEnv();

  const ws1 = joinAs(wss, 'white');
  const token1 = safeGet(ws1.getSent('joined')[0], 'token');

  const ws2 = joinAs(wss, 'black');

  // Disconnect ws1
  wss.simulateDisconnect(ws1);
  safeAssert(handlers.disconnectedPlayers.has(token1), 'seat held after disconnect');

  // New connection reconnects with token
  const ws1_new = wss.simulateConnection();
  ws1_new.emit('message', JSON.stringify({ type: 'reconnect', token: token1 }));

  safeAssert(ws1_new.getSent('reconnected').length === 1, 'reconnected message sent');
  safeAssert(safeGet(ws1_new.getSent('reconnected')[0], 'color') === 'white', 'reconnected with correct color');
  safeAssert(handlers.disconnectedPlayers.has(token1) === false, 'removed from disconnectedPlayers');
  safeAssert(handlers.sessions.has(ws1_new), 'new session created');
  safeAssert(game.players.get(ws1_new) === 'white', 'game.players has new ws as white');
  safeAssert(handlers.sessions.has(ws1) === false, 'old ws removed from sessions');
});

testBlock('Reconnect with invalid token', () => {
  const { wss, handlers } = createTestEnv();

  // Connect and try to reconnect with bad token
  const ws1 = wss.simulateConnection();
  ws1.emit('message', JSON.stringify({ type: 'reconnect', token: 'nonexistent-token' }));

  safeAssert(ws1.getSent('reconnectFailed').length === 1, 'reconnectFailed sent for bad token');
  // Client has no session (reconnect failed, no auto-assign)
  safeAssert(handlers.sessions.has(ws1) === false, 'no session after failed reconnect');
});

testBlock('Reconnect after seat was dropped', () => {
  const { wss, handlers } = createTestEnv();

  const ws1 = joinAs(wss, 'white');
  const token1 = safeGet(ws1.getSent('joined')[0], 'token');

  const ws2 = joinAs(wss, 'black');

  // Disconnect ws1
  wss.simulateDisconnect(ws1);

  // ws2 drops ws1
  ws2.emit('message', JSON.stringify({ type: 'dropPlayer', token: token1 }));

  safeAssert(handlers.disconnectedPlayers.has(token1) === false, 'seat freed after drop');
  safeAssert(ws2.getSent('playerDropped').length === 1, 'dropper receives playerDropped');

  // ws1 tries to reconnect — should fail (seat was dropped)
  const ws1_new = wss.simulateConnection();
  ws1_new.emit('message', JSON.stringify({ type: 'reconnect', token: token1 }));
  safeAssert(ws1_new.getSent('reconnectFailed').length === 1, 'reconnect fails after seat was dropped');
});

testBlock('Drop Player — spectator cannot drop', () => {
  const { wss, handlers } = createTestEnv();

  const ws1 = joinAs(wss, 'white');
  const token1 = safeGet(ws1.getSent('joined')[0], 'token');

  const ws2 = joinAs(wss, 'black');

  // Spectator
  const ws3 = joinAs(wss, 'spectator');
  safeAssert(safeGet(ws3.getSent('state'), 1, 'role') === 'spectator', 'third player is spectator');

  // Disconnect ws1
  wss.simulateDisconnect(ws1);

  // Spectator tries to drop
  ws3.emit('message', JSON.stringify({ type: 'dropPlayer', token: token1 }));
  safeAssert(handlers.disconnectedPlayers.has(token1), 'spectator cannot drop — seat still held');
});

testBlock('Player disconnect — opponent receives playerDisconnected', () => {
  const { wss, handlers } = createTestEnv();

  const ws1 = joinAs(wss, 'white');
  const token1 = safeGet(ws1.getSent('joined')[0], 'token');

  const ws2 = joinAs(wss, 'black');

  // Disconnect ws1 (white)
  wss.simulateDisconnect(ws1);

  // ws2 (black) should receive playerDisconnected
  const pdMsgs = ws2.getSent('playerDisconnected');
  safeAssert(pdMsgs.length === 1, 'opponent receives playerDisconnected');
  safeAssert(safeGet(pdMsgs[0], 'color') === 'white', 'correct color in playerDisconnected');
  safeAssert(safeGet(pdMsgs[0], 'token') === token1, 'correct token in playerDisconnected');
  assertDefined(safeGet(pdMsgs[0], 'disconnectedAt'), 'has disconnectedAt timestamp');
});

testBlock('Player disconnect — spectator receives playerDisconnected', () => {
  const { wss, handlers } = createTestEnv();

  const ws1 = joinAs(wss, 'white');
  const token1 = safeGet(ws1.getSent('joined')[0], 'token');

  const ws2 = joinAs(wss, 'black');

  // Spectator
  const ws3 = joinAs(wss, 'spectator');

  // Disconnect ws1 (white)
  wss.simulateDisconnect(ws1);

  // Spectator should also receive playerDisconnected
  const pdMsgs = ws3.getSent('playerDisconnected');
  safeAssert(pdMsgs.length === 1, 'spectator receives playerDisconnected');
  safeAssert(safeGet(pdMsgs[0], 'color') === 'white', 'correct color for spectator');
  safeAssert(safeGet(pdMsgs[0], 'token') === token1, 'correct token for spectator');
});

testBlock('Spectator disconnect — no session, no playerDisconnected spam', () => {
  const { wss, handlers } = createTestEnv();

  const ws1 = joinAs(wss, 'white');
  const ws2 = joinAs(wss, 'black');

  // Spectator
  const ws3 = joinAs(wss, 'spectator');

  // Spectator should NOT have a session
  safeAssert(handlers.sessions.has(ws3) === false, 'spectator has no session');

  // Disconnect spectator
  wss.simulateDisconnect(ws3);

  // No playerDisconnected should be sent (spectator isn't a player)
  safeAssert(ws1.getSent('playerDisconnected').length === 0, 'ws1 gets no playerDisconnected from spectator disconnect');
  safeAssert(ws2.getSent('playerDisconnected').length === 0, 'ws2 gets no playerDisconnected from spectator disconnect');
  safeAssert(handlers.disconnectedPlayers.size === 0, 'disconnectedPlayers empty after spectator disconnect');
});

testBlock('State includes disconnectedPlayers array', () => {
  const { wss, handlers } = createTestEnv();

  const ws1 = joinAs(wss, 'white');
  const token1 = safeGet(ws1.getSent('joined')[0], 'token');

  const ws2 = joinAs(wss, 'black');

  // Disconnect ws1
  wss.simulateDisconnect(ws1);

  // Check state sent to ws2 includes disconnectedPlayers
  const stateMsgs = ws2.getSent('state');
  const lastState = stateMsgs[stateMsgs.length - 1];
  safeAssert(Array.isArray(safeGet(lastState, 'disconnectedPlayers')), 'state has disconnectedPlayers array');
  safeAssert(safeGet(lastState, 'disconnectedPlayers', 'length') === 1, 'one disconnected player in state');
  safeAssert(safeGet(lastState, 'disconnectedPlayers', 0, 'color') === 'white', 'correct color in state');
  safeAssert(safeGet(lastState, 'disconnectedPlayers', 0, 'token') === token1, 'correct token in state');
});

// ── Async tests (require timers) ──────────────────────────

asyncTest('Both disconnected — no spectators, timer still fires', (done) => {
  const { wss, handlers, game } = createTestEnv(5);

  const ws1 = joinAs(wss, 'white');
  const ws2 = joinAs(wss, 'black');

  // Both disconnect
  wss.simulateDisconnect(ws1);
  wss.simulateDisconnect(ws2);

  safeAssert(handlers.disconnectedPlayers.size === 2, 'both in disconnectedPlayers');

  // Timer fires even without spectators — seats freed, game reset
  setTimeout(() => {
    safeAssert(handlers.disconnectedPlayers.size === 0, 'seats freed without spectators');
    safeAssert(game.turn === 'white', 'game reset to initial state');
    done();
  }, 20);
});

asyncTest('Both disconnected — with spectator, auto-free', (done) => {
  const { wss, handlers, game } = createTestEnv(5);

  const ws1 = joinAs(wss, 'white');
  const ws2 = joinAs(wss, 'black');

  // Spectator
  const ws3 = joinAs(wss, 'spectator');

  // Both disconnect
  wss.simulateDisconnect(ws1);
  wss.simulateDisconnect(ws2);

  // After timeout, seats should be freed and spectator gets gameAvailable
  setTimeout(() => {
    safeAssert(handlers.disconnectedPlayers.size === 0, 'seats freed after timeout with spectators');
    safeAssert(ws3.getSent('gameAvailable').length === 1, 'spectator receives gameAvailable');
    safeAssert(game.turn === 'white', 'game reset to initial state');
    done();
  }, 20);
});

asyncTest('One reconnects during both-disconnected — timer stops', (done) => {
  const { wss, handlers } = createTestEnv(500);

  const ws1 = joinAs(wss, 'white');
  const token1 = safeGet(ws1.getSent('joined')[0], 'token');

  const ws2 = joinAs(wss, 'black');
  const token2 = safeGet(ws2.getSent('joined')[0], 'token');

  // Spectator
  const ws3 = joinAs(wss, 'spectator');

  // Both disconnect
  wss.simulateDisconnect(ws1);
  wss.simulateDisconnect(ws2);
  safeAssert(handlers.disconnectedPlayers.size === 2, 'both disconnected');

  // ws1 reconnects
  const ws1_new = wss.simulateConnection();
  ws1_new.emit('message', JSON.stringify({ type: 'reconnect', token: token1 }));

  safeAssert(ws1_new.getSent('reconnected').length === 1, 'ws1 reconnected');
  safeAssert(handlers.disconnectedPlayers.size === 1, 'only ws2 remains disconnected');
  safeAssert(handlers.disconnectedPlayers.has(token2), 'ws2 seat still held');

  // Timer should have been stopped — seats shouldn't auto-free
  setTimeout(() => {
    safeAssert(handlers.disconnectedPlayers.size === 1, 'timer stopped — ws2 seat still held');
    done();
  }, 20);
});

asyncTest('Spectator connects while both disconnected — timer starts', (done) => {
  const { wss, handlers } = createTestEnv(10); // 10ms seat timeout

  const ws1 = joinAs(wss, 'white');
  const ws2 = joinAs(wss, 'black');

  // Both disconnect
  wss.simulateDisconnect(ws1);
  wss.simulateDisconnect(ws2);

  safeAssert(handlers.disconnectedPlayers.size === 2, 'both disconnected');

  // Spectator connects
  const ws3 = joinAs(wss, 'spectator');

  safeAssert(handlers.disconnectedPlayers.size === 2, 'still both disconnected after spectator joins');

  // After timeout, seats should be freed
  setTimeout(() => {
    safeAssert(handlers.disconnectedPlayers.size === 0, 'seats freed after spectator joined');
    safeAssert(ws3.getSent('gameAvailable').length === 1, 'spectator receives gameAvailable');
    done();
  }, 50);
});

asyncTest('Reconnect after both-disconnected timer expired — token invalidated, must join fresh', (done) => {
  const { wss, handlers, game } = createTestEnv(10);

  const ws1 = joinAs(wss, 'white');
  const token1 = safeGet(ws1.getSent('joined')[0], 'token');

  const ws2 = joinAs(wss, 'black');

  // Both disconnect
  wss.simulateDisconnect(ws1);
  wss.simulateDisconnect(ws2);

  safeAssert(handlers.disconnectedPlayers.size === 2, 'both disconnected');

  // Wait for timer to expire — seats freed, tokens invalidated
  setTimeout(() => {
    safeAssert(handlers.disconnectedPlayers.size === 0, 'seats freed after timer');
    safeAssert(handlers.disconnectedPlayers.has(token1) === false, 'token1 invalidated');

    // Try to reconnect with old token — must fail
    const ws1_new = wss.simulateConnection();
    ws1_new.emit('message', JSON.stringify({ type: 'reconnect', token: token1 }));

    safeAssert(ws1_new.getSent('reconnectFailed').length === 1, 'reconnect fails with expired token');
    safeAssert(handlers.sessions.has(ws1_new) === false, 'no session after failed reconnect');

    // Must join fresh to get a new token
    ws1_new.emit('message', JSON.stringify({ type: 'join', color: 'white' }));
    const joinedMsgs = ws1_new.getSent('joined');
    safeAssert(joinedMsgs.length >= 1, 'received joined message after fresh join');
    const newToken = safeGet(joinedMsgs[joinedMsgs.length - 1], 'token');
    assertDefined(newToken, 'fresh join assigns a new token');
    safeAssert(newToken !== token1, 'new token differs from expired token');
    safeAssert(safeGet(joinedMsgs[joinedMsgs.length - 1], 'color') === 'white', 'joined as white');
    safeAssert(handlers.sessions.has(ws1_new), 'session created for fresh join');

    done();
  }, 50);
});

// ── Reconnect to active session (browser refresh) ──

testBlock('Reconnect to active session — browser refresh', () => {
  const { wss, handlers, game } = createTestEnv();

  const ws1 = joinAs(wss, 'white');
  const token1 = safeGet(ws1.getSent('joined')[0], 'token');

  safeAssert(handlers.sessions.has(ws1), 'session exists');
  safeAssert(handlers.disconnectedPlayers.has(token1) === false, 'not in disconnectedPlayers');

  // Simulate browser refresh: new connection with same token
  const ws1_new = wss.simulateConnection();
  ws1_new.emit('message', JSON.stringify({ type: 'reconnect', token: token1 }));

  safeAssert(ws1_new.getSent('reconnected').length === 1, 'reconnected to active session');
  safeAssert(safeGet(ws1_new.getSent('reconnected')[0], 'color') === 'white', 'correct color');
  safeAssert(handlers.sessions.has(ws1_new), 'new session created');
  safeAssert(handlers.sessions.has(ws1) === false, 'old session removed');
  safeAssert(game.players.get(ws1_new) === 'white', 'game.players has new ws');
  safeAssert(game.players.has(ws1) === false, 'old ws removed from game.players');
});

testBlock('Reconnect to active session — old socket closed', () => {
  const { wss, handlers } = createTestEnv();

  const ws1 = joinAs(wss, 'white');
  const token1 = safeGet(ws1.getSent('joined')[0], 'token');

  // Simulate browser refresh
  const ws1_new = wss.simulateConnection();
  ws1_new.emit('message', JSON.stringify({ type: 'reconnect', token: token1 }));

  // Old socket should have been closed
  safeAssert(ws1._closed === true, 'old socket was closed');
});

testBlock('Reconnect while no role — removed from spectators set', () => {
  const { wss, handlers, game } = createTestEnv();

  const ws1 = joinAs(wss, 'white');
  const token1 = safeGet(ws1.getSent('joined')[0], 'token');

  const ws2 = joinAs(wss, 'black');

  // Disconnect ws1 (seat held)
  wss.simulateDisconnect(ws1);

  // New connection reconnects with ws1's token
  const ws1_new = wss.simulateConnection();
  ws1_new.emit('message', JSON.stringify({ type: 'reconnect', token: token1 }));

  safeAssert(ws1_new.getSent('reconnected').length === 1, 'reconnected successfully');
  safeAssert(game.players.get(ws1_new) === 'white', 'ws1_new is now white player');
  safeAssert(game.spectators.has(ws1_new) === false, 'ws1_new not in spectators');
});

testBlock('Spectator disconnect — cleaned from spectators set', () => {
  const { wss, handlers, game } = createTestEnv();

  const ws1 = joinAs(wss, 'white');
  const ws2 = joinAs(wss, 'black');

  // Spectator
  const ws3 = joinAs(wss, 'spectator');
  safeAssert(game.spectators.has(ws3), 'spectator in spectators set');
  safeAssert(handlers.sessions.has(ws3) === false, 'spectator has no session');

  // Disconnect spectator
  wss.simulateDisconnect(ws3);

  safeAssert(game.spectators.has(ws3) === false, 'spectator removed from spectators set');
  safeAssert(handlers.disconnectedPlayers.size === 0, 'no disconnected players from spectator');
});

testBlock('Reconnect to active session — old socket cleaned from spectators too', () => {
  const { wss, handlers, game } = createTestEnv();

  const ws1 = joinAs(wss, 'white');
  const token1 = safeGet(ws1.getSent('joined')[0], 'token');

  const ws2 = joinAs(wss, 'black');

  // Manually add ws1 to spectators (simulates race where ws1 was reassigned)
  game.spectators.add(ws1);

  // Simulate browser refresh
  const ws1_new = wss.simulateConnection();
  ws1_new.emit('message', JSON.stringify({ type: 'reconnect', token: token1 }));

  safeAssert(ws1_new.getSent('reconnected').length === 1, 'reconnected');
  safeAssert(game.players.get(ws1_new) === 'white', 'ws1_new is white');
  safeAssert(game.spectators.has(ws1_new) === false, 'ws1_new removed from spectators');
  safeAssert(game.spectators.has(ws1) === false, 'old ws1 also cleaned from spectators');
});

// ── Seat status tests ──

testBlock('Seat status in state message', () => {
  const { wss, handlers, game } = createTestEnv();

  // Connect without joining — check seat status
  const ws1 = wss.simulateConnection();
  const stateMsg = ws1.getSent('state')[0];
  safeAssert(stateMsg.seats, 'state has seats');
  safeAssert(stateMsg.seats.white.status === 'free', 'white seat is free');
  safeAssert(stateMsg.seats.black.status === 'free', 'black seat is free');

  // Join white
  ws1.emit('message', JSON.stringify({ type: 'join', color: 'white' }));

  // New connection should see white as occupied
  const ws2 = wss.simulateConnection();
  const stateMsg2 = ws2.getSent('state')[0];
  safeAssert(stateMsg2.seats.white.status === 'occupied', 'white seat is occupied');
  safeAssert(stateMsg2.seats.black.status === 'free', 'black seat still free');
});

// ── Results ───────────────────────────────────────────────

function printResults() {
  console.log(`\n==================================================`);
  console.log(`Results: ${passed}/${passed + failed} passed, ${failed} failed`);
  console.log(`==================================================`);
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
