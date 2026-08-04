// ═══════════════════════════════════════════════════════════
//  Shared test helpers for server-side WebSocket tests
//  Use this instead of copy-pasting MockWebSocket /
//  MockWebSocketServer into every test file.
// ═══════════════════════════════════════════════════════════

let _ipCounter = 0;

/**
 * Create a mock WebSocket client.
 *
 * Options:
 *   ip            – set `_socket.remoteAddress` to this value
 *   autoIp        – auto-assign a unique `10.0.0.N` IP
 *   trackClose    – record close code/reason on `_closeCode` / `_closeReason`
 *   trackRaw      – expose `getRawSent()` method
 */
function createMockWebSocket(opts = {}) {
  const ws = {
    readyState: 1, // OPEN
    sentMessages: [],
    _listeners: {},
    _closed: false,
    bufferedAmount: 0,
  };

  if (opts.ip) {
    ws._socket = { remoteAddress: opts.ip };
  } else if (opts.autoIp) {
    _ipCounter++;
    ws._socket = { remoteAddress: `10.0.0.${_ipCounter}` };
  }

  if (opts.trackClose) {
    ws._closeCode = null;
    ws._closeReason = null;
  }

  if (opts.trackRaw) {
    ws.getRawSent = () => ws.sentMessages;
  }

  ws.send = function (data) {
    this.sentMessages.push(data);
  };

  ws.getSent = function (type) {
    return this.sentMessages
      .filter((m) => {
        try {
          return JSON.parse(m).type === type;
        } catch {
          return false;
        }
      })
      .map((m) => JSON.parse(m));
  };

  ws.on = function (event, fn) {
    this._listeners[event] = fn;
  };

  ws.emit = function (event, data) {
    if (this._listeners[event]) this._listeners[event](data);
  };

  ws.close = function (code, reason) {
    this.readyState = 3; // CLOSED
    this._closed = true;
    if (opts.trackClose) {
      this._closeCode = code;
      this._closeReason = reason;
    }
    if (this._listeners.close) this._listeners.close();
  };

  return ws;
}

/**
 * Create a mock WebSocket server.
 *
 * Options are forwarded to `createMockWebSocket` for every
 * connection created via `simulateConnection()`.
 *
 * Additional `simulateConnection` args:
 *   ip   – override the per-connection IP
 *   req  – extra request properties merged into the req object
 */
function createMockWebSocketServer(wsOpts = {}) {
  const server = {
    clients: new Set(),
    _listeners: {},
    _wsOpts: wsOpts,
  };

  server.on = function (event, fn) {
    this._listeners[event] = fn;
  };

  server.simulateConnection = function (ip, reqProps = {}) {
    const connOpts = { ...this._wsOpts };
    if (ip) connOpts.ip = ip;
    const ws = createMockWebSocket(connOpts);
    this.clients.add(ws);
    const req = { socket: { remoteAddress: ip || '127.0.0.1' }, ...reqProps };
    if (this._listeners.connection) this._listeners.connection(ws, req);
    return ws;
  };

  server.simulateDisconnect = function (ws) {
    this.clients.delete(ws);
    ws.close();
  };

  server.reset = function () {
    this.clients.clear();
  };

  return server;
}

module.exports = { createMockWebSocket, createMockWebSocketServer, _ipCounter };
