const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Game } = require('./shared/chess');

// ═══════════════════════════════════════════════════════════
//  WEBSOCKET HANDLER SETUP (extracted for testability)
// ═══════════════════════════════════════════════════════════

function setupWebSocketHandlers(wss, game, options = {}) {
  const seatTimeout = options.seatTimeout != null ? options.seatTimeout : 60_000;
  const joinTimeoutMs = options.joinTimeoutMs != null ? options.joinTimeoutMs : 5000;

  // Rate limiter config: max messages per window (ms)
  const rateLimitMax = options.rateLimitMax != null ? options.rateLimitMax : 60;
  const rateLimitWindow = options.rateLimitWindow != null ? options.rateLimitWindow : 10_000;

  const sessions = new Map();
  const disconnectedPlayers = new Map();
  // Per-connection sliding window: ws -> number[] of timestamps
  const rateLimitBuckets = new Map();
  let bothDisconnectedTimer = null;

  const SLOW_CLIENT_THRESHOLD = 1 * 1024 * 1024; // 1 MB

  // Debug mode
  const DEBUG = options.debug || false;

  function debugLog(...args) {
    if (DEBUG) {
      console.log('[DEBUG]', ...args);
    }
  }

  function isClientSlow(ws) {
    return ws.bufferedAmount > SLOW_CLIENT_THRESHOLD;
  }

  function broadcast(data, excludeWs) {
    const msg = JSON.stringify(data);
    for (const c of wss.clients) {
      if (c !== excludeWs && c.readyState === 1 && !isClientSlow(c)) {
        c.send(msg);
      }
    }
  }

  function broadcastDebug(data, excludeWs) {
    if (!DEBUG) return;
    const msg = JSON.stringify({ type: 'debug', ...data });
    for (const c of wss.clients) {
      if (c !== excludeWs && c.readyState === 1 && !isClientSlow(c)) {
        c.send(msg);
      }
    }
  }

  function send(ws, data) {
    if (ws.readyState === 1 && !isClientSlow(ws)) {
      ws.send(JSON.stringify(data));
    }
  }

  function getRole(ws) {
    if (game.players.has(ws)) return game.players.get(ws);
    if (game.spectators.has(ws)) return 'spectator';
    return null;
  }

  // ── Rate limiter (sliding window per connection) ──

  function checkRateLimit(ws) {
    const now = Date.now();
    let bucket = rateLimitBuckets.get(ws);
    if (!bucket) {
      bucket = [];
      rateLimitBuckets.set(ws, bucket);
    }
    // Prune timestamps outside the window
    while (bucket.length > 0 && bucket[0] <= now - rateLimitWindow) {
      bucket.shift();
    }
    if (bucket.length >= rateLimitMax) {
      const retryAfter = Math.ceil((bucket[0] - (now - rateLimitWindow)) / 1000);
      rateLimitBuckets.delete(ws);
      return { allowed: false, retryAfter: Math.max(1, retryAfter) };
    }
    bucket.push(now);
    return { allowed: true };
  }

  function buildDisconnectedPlayersArray() {
    const arr = [];
    for (const [token, entry] of disconnectedPlayers) {
      arr.push({ color: entry.color, token, disconnectedAt: entry.disconnectedAt });
    }
    return arr;
  }

  function seatStatusForColor(color, clientWs) {
    // Check if actively occupied
    let occupiedWs = null;
    for (const [ws, c] of game.players) {
      if (c === color) {
        occupiedWs = ws;
        break;
      }
    }
    if (occupiedWs) {
      const clientSession = sessions.get(clientWs);
      const occupiedSession = sessions.get(occupiedWs);
      const clientToken = clientSession?.token;
      const canReconnect = !!(clientToken && occupiedSession?.token === clientToken);
      return { status: 'occupied', canReconnect };
    }
    // Check if held by disconnected player
    let heldEntry = null;
    let heldToken = null;
    for (const [token, entry] of disconnectedPlayers) {
      if (entry.color === color) {
        heldEntry = entry;
        heldToken = token;
        break;
      }
    }
    if (heldEntry) {
      const freesAt = heldEntry.disconnectedAt + seatTimeout;
      const clientSession = sessions.get(clientWs);
      const clientToken = clientSession?.token;
      const canReconnect = clientToken === heldToken;
      return {
        status: 'held',
        freesAt,
        remaining: Math.max(0, freesAt - Date.now()),
        canReconnect,
      };
    }
    return { status: 'free', canReconnect: false };
  }

  function buildSeatStatus(clientWs) {
    const seats = {};
    for (const color of ['white', 'black']) {
      seats[color] = seatStatusForColor(color, clientWs);
    }
    return seats;
  }

  function sendState(ws) {
    const role = getRole(ws);
    const state = game.getState();
    send(ws, {
      type: 'state',
      role,
      seats: buildSeatStatus(ws),
      disconnectedPlayers: buildDisconnectedPlayersArray(),
      debug: DEBUG,
      ...state,
    });
  }

  function broadcastState(excludeWs) {
    for (const c of wss.clients) {
      if (c !== excludeWs && c.readyState === 1) sendState(c);
    }
  }

  function bothDisconnected() {
    return disconnectedPlayers.size >= 2 && game.players.size === 0;
  }

  function maybeStartBothDisconnectedTimer() {
    if (bothDisconnectedTimer) return;
    if (!bothDisconnected()) return;
    bothDisconnectedTimer = setTimeout(() => {
      bothDisconnectedTimer = null;
      // Clear all disconnected player sessions
      for (const [token] of disconnectedPlayers) {
        disconnectedPlayers.delete(token);
      }
      game.reset();
      broadcastState();
      for (const c of wss.clients) {
        if (c.readyState === 1 && game.spectators.has(c)) {
          send(c, { type: 'gameAvailable' });
        }
      }
    }, seatTimeout);
  }

  function stopBothDisconnectedTimer() {
    if (bothDisconnectedTimer) {
      clearTimeout(bothDisconnectedTimer);
      bothDisconnectedTimer = null;
    }
  }

  function freeDisconnectedSeat(token) {
    const entry = disconnectedPlayers.get(token);
    if (!entry) return;
    disconnectedPlayers.delete(token);
    stopBothDisconnectedTimer();
    broadcastState();
  }

  function finishReconnect(ws, color, token) {
    game.players.set(ws, color);
    sessions.set(ws, { token, color });
    send(ws, { type: 'reconnected', color });
    broadcastState();
  }

  function handleReconnect(ws, data) {
    game.spectators.delete(ws);

    // 1) Reconnect to a held seat (player was disconnected)
    const held = disconnectedPlayers.get(data.token);
    if (held) {
      stopBothDisconnectedTimer();
      disconnectedPlayers.delete(data.token);
      finishReconnect(ws, held.color, data.token);
      return true;
    }

    // 2) Transfer active session (browser refresh while still connected)
    for (const [oldWs, session] of sessions) {
      if (session.token === data.token) {
        game.players.delete(oldWs);
        game.spectators.delete(oldWs);
        sessions.delete(oldWs);
        if (oldWs.readyState === 1) oldWs.close();
        finishReconnect(ws, session.color, data.token);
        return true;
      }
    }

    send(ws, { type: 'reconnectFailed', reason: 'Seat no longer available' });
    return false;
  }

  function handleDropPlayer(ws, data) {
    // Only active players can drop
    if (!game.players.has(ws)) return;
    const entry = disconnectedPlayers.get(data.token);
    if (!entry) return;
    freeDisconnectedSeat(data.token);
    send(ws, { type: 'playerDropped', color: entry.color });
  }

  function isColorFree(color) {
    return seatStatusForColor(color).status === 'free';
  }

  function handleJoin(ws, data) {
    const { color } = data;
    if (color !== 'white' && color !== 'black' && color !== 'spectator') return;

    // Remove from any previous assignment
    game.players.delete(ws);
    game.spectators.delete(ws);
    sessions.delete(ws);

    if (color === 'spectator') {
      game.spectators.add(ws);
      send(ws, { type: 'joined', color: 'spectator' });
    } else if (isColorFree(color)) {
      // Claim the free seat
      game.players.set(ws, color);
      const token = crypto.randomUUID();
      sessions.set(ws, { token, color });
      send(ws, { type: 'joined', color, token });
    } else {
      // Seat not available — reject, do NOT fall back to spectator
      send(ws, { type: 'error', reason: `${color} seat is not available` });
      return;
    }

    sendState(ws);
    broadcastState(ws);
    maybeStartBothDisconnectedTimer();
  }

  wss.on('connection', (ws) => {
    // Don't auto-assign players — just send state with seat info
    // Client will explicitly choose via 'join' message
    sendState(ws);

    // Fallback timeout: if for some reason the client has no role, re-assign
    const joinTimeout = setTimeout(() => {
      if (!getRole(ws)) {
        sendState(ws);
      }
    }, joinTimeoutMs);

    ws._joinTimeout = joinTimeout; // expose for tests to clear

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        console.warn(`Malformed JSON from client: ${raw.slice(0, 120)}`);
        try {
          ws.send(JSON.stringify({ type: 'error', reason: 'Malformed message' }));
        } catch {
          /* client already disconnected — nothing to send */
        }
        return;
      }

      // Rate limit check (per connection, sliding window)
      const rl = checkRateLimit(ws);
      if (!rl.allowed) {
        send(ws, { type: 'rateLimited', retryAfter: rl.retryAfter });
        return;
      }

      // Handle reconnect for any client (even pre-assigned ones)
      if (msg.type === 'reconnect') {
        clearTimeout(joinTimeout);
        if (handleReconnect(ws, msg)) return; // successfully reconnected
        // Reconnect failed — client keeps its current role
        return;
      }

      // Validate whether a client-stored token is still valid for reconnect
      if (msg.type === 'validateToken') {
        const { token: vToken, color: vColor } = msg;
        let isValid = false;
        // Check disconnected players (held seat)
        const heldEntry = disconnectedPlayers.get(vToken);
        if (heldEntry && heldEntry.color === vColor) {
          isValid = true;
        }
        // Check active sessions (browser refresh — same token still active)
        if (!isValid) {
          for (const [, session] of sessions) {
            if (session.token === vToken && session.color === vColor) {
              isValid = true;
              break;
            }
          }
        }
        send(ws, { type: 'tokenValid', color: vColor, valid: isValid });
        return;
      }

      // Handle explicit join request (works for any client)
      if (msg.type === 'join') {
        clearTimeout(joinTimeout);
        handleJoin(ws, msg);
        return;
      }

      switch (msg.type) {
        case 'move': {
          const { fromFile, fromRank, toFile, toRank } = msg;
          if (
            ![fromFile, fromRank, toFile, toRank].every(
              (v) => Number.isInteger(v) && v >= 0 && v <= 7
            )
          )
            return;
          const result = game.tryMove(ws, fromFile, fromRank, toFile, toRank);
          if (result.ok) {
            debugLog('Move:', {
              from: { file: fromFile, rank: fromRank },
              to: { file: toFile, rank: toRank },
              result,
            });
            debugLog('Board after move:', game.board);
            broadcast({ type: 'move', ...result });
            broadcastState();
            broadcastDebug({
              category: 'move',
              from: { file: fromFile, rank: fromRank },
              to: { file: toFile, rank: toRank },
              message: `Move: ${result.notation}`,
            });
          } else {
            send(ws, { type: 'error', reason: result.reason });
          }
          break;
        }
        case 'promotion': {
          if (!game.promotingPiece || game.players.get(ws) !== game.promotingPiece.color) return;
          if (!['queen', 'rook', 'bishop', 'knight'].includes(msg.pieceType)) return;
          const ok = game.completePromotion(ws, msg.pieceType);
          if (ok) {
            broadcast({ type: 'promotion', pieceType: msg.pieceType });
            broadcastState();
          }
          break;
        }
        case 'restart': {
          if (game.players.has(ws)) {
            const oldFen = game.currentFen();
            debugLog('Game restart: OLD FEN:', oldFen);
            game.reset();
            const newFen = game.currentFen();
            debugLog('Game restart: NEW FEN:', newFen);
            debugLog('Game restart: NEW board state:', game.board);
            broadcastState();
            broadcast({ type: 'restart' });
            broadcastDebug({
              category: 'gameRestart',
              oldFen,
              newFen,
              message: 'Game restarted',
            });
          }
          break;
        }
        case 'concede': {
          const color = game.players.get(ws);
          if (!color) return;
          const ok = game.concede(ws);
          if (ok) {
            broadcastState();
          }
          break;
        }
        case 'dropPlayer': {
          handleDropPlayer(ws, msg);
          break;
        }
        case 'exportFen': {
          send(ws, { type: 'fenExport', fen: game.currentFen() });
          break;
        }
        case 'exportPgn': {
          send(ws, { type: 'pgnExport', pgn: game.exportPgn() });
          break;
        }
        case 'importFen': {
          if (!game.players.has(ws)) {
            send(ws, { type: 'error', reason: 'Only players can import FEN' });
            break;
          }
          const fen = msg.fen;
          if (typeof fen !== 'string' || !fen.trim()) {
            send(ws, { type: 'error', reason: 'Invalid FEN string' });
            break;
          }
          try {
            const oldFen = game.currentFen();
            debugLog('FEN import: OLD FEN:', oldFen);
            debugLog('FEN import: NEW FEN:', fen.trim());
            game.loadFromFen(fen.trim());
            const newFen = game.currentFen();
            debugLog('FEN import: NEW board state:', game.board);
            broadcastState();
            broadcast({ type: 'restart' });
            broadcastDebug({
              category: 'fenImport',
              oldFen,
              newFen,
              message: `FEN imported: ${fen.trim()}`,
            });
          } catch (e) {
            send(ws, { type: 'error', reason: `Invalid FEN: ${e.message}` });
          }
          break;
        }
      }
    });

    ws.on('close', () => {
      rateLimitBuckets.delete(ws);
      const session = sessions.get(ws);
      if (session) {
        const { token, color } = session;
        sessions.delete(ws);
        game.players.delete(ws);

        const now = Date.now();
        disconnectedPlayers.set(token, { color, disconnectedAt: now });

        // Notify opponent player AND all spectators
        const opponentColor = color === 'white' ? 'black' : 'white';
        for (const c of wss.clients) {
          if (c.readyState === 1) {
            const cRole = game.players.get(c);
            if (cRole === opponentColor || game.spectators.has(c)) {
              send(c, { type: 'playerDisconnected', color, token, disconnectedAt: now });
            }
          }
        }

        stopBothDisconnectedTimer();
        maybeStartBothDisconnectedTimer();
      } else {
        // No session — could be a spectator or unassigned client
        game.removePlayer(ws);
        game.spectators.delete(ws);
      }

      broadcastState();
    });
  });

  return {
    sessions,
    disconnectedPlayers,
    rateLimitBuckets,
    stopBothDisconnectedTimer,
    getRole,
    sendState,
  };
}

// ═══════════════════════════════════════════════════════════
//  HTTP SERVER + WEBSOCKET (production entry point)
// ═══════════════════════════════════════════════════════════

const HOST = '0.0.0.0';

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.stl': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

const CLIENT_ROOT = path.resolve(__dirname, 'client');

let _prefix = '';

function setPrefix(p) {
  if (!p) {
    _prefix = '';
    return;
  }
  const stripped = p.replace(/^\/+/, '').replace(/\/+$/, '');
  _prefix = stripped ? '/' + stripped : '';
}

const requestHandler = (req, res) => {
  let urlPath = req.url.split('?')[0];

  // Strip the configured prefix so the rest of the handler works unchanged.
  // e.g. "/chess/client/style.css" → "/client/style.css"
  if (_prefix && urlPath.startsWith(_prefix)) {
    urlPath = urlPath.slice(_prefix.length) || '/';
  }

  if (urlPath === '/') urlPath = '/client/index.html';

  // Only serve files from the client/ directory
  if (!urlPath.startsWith('/client/')) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const relativePath = urlPath.slice('/client/'.length);
  const safePath = path.normalize(relativePath);
  if (safePath.startsWith('..') || safePath.startsWith('/')) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  const filePath = path.resolve(CLIENT_ROOT, safePath);
  if (!filePath.startsWith(CLIENT_ROOT + path.sep) && filePath !== CLIENT_ROOT) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  if (!MIME[ext]) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    let content = fs.readFileSync(filePath);
    // Inject the correct base href for subpath deployments.
    // The HTML ships with <base href="/client/" /> — replace it when a prefix is set.
    if (ext === '.html' && _prefix) {
      content = content
        .toString('utf8')
        .replace('<base href="/client/" />', `<base href="${_prefix}/client/" />`)
        .replace('</head>', `<script>window.__mpchess_prefix="${_prefix}";</script></head>`);
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
};

if (require.main === module) {
  // CLI help (check before loading config)
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    require('./loadConfig'); // loaded for side effects
    console.log(`
Usage: node server.js [options]

Options:
  --help, -h              Show this help message
  --config=<path>         Config file path (default: config.json in cwd)
  --fen=<fen_string>      Load a custom starting position (first game only;
                          restarts reset to standard setup)
  --port=<number>         Port for the HTTP/WebSocket server
  --cert=<path>           TLS certificate file (enables HTTPS)
  --key=<path>            TLS private key file (required with --cert)
  --chain=<path>          TLS certificate chain file (optional, PEM format)
  --allowed-origins=<o1,o2>  Comma-separated list of allowed WebSocket origins
  --debug=<true|false>      Enable debug logging for piece rebuilding
  --prefix=<path>           URL prefix for subpath deployments (e.g. /chess)

Config sources (highest priority first):
  1. CLI arguments
  2. Environment variables (MPCHESS_PORT, MPCHESS_FEN, MPCHESS_CERT,
     MPCHESS_KEY, MPCHESS_CHAIN, MPCHESS_ALLOWED_ORIGINS, MPCHESS_DEBUG,
     MPCHESS_PREFIX)
  3. Config file (config.json or --config=<path>)
  4. Built-in defaults

Examples:
  node server.js
  node server.js --config=prod.json --port=8443
  node server.js --cert=server.crt --key=server.key
  node server.js --allowed-origins=games.devop.ninja,localhost
  node server.js --debug=true
  MPCHESS_PORT=8080 node server.js
  MPCHESS_DEBUG=true node server.js
`);
    process.exit(0);
  }

  // Load merged config (CLI > config file > env vars > defaults)
  const { loadConfig } = require('./loadConfig');
  const config = loadConfig();
  const PORT = config.port;
  if (config.prefix) setPrefix(config.prefix);

  // TLS support
  let server;
  let protocol = 'http';

  if (config.cert && config.key) {
    try {
      const tlsOptions = {
        cert: fs.readFileSync(config.cert),
        key: fs.readFileSync(config.key),
      };
      if (config.chain) {
        tlsOptions.ca = fs.readFileSync(config.chain);
      }
      server = https.createServer(tlsOptions, requestHandler);
      protocol = 'https';
    } catch (e) {
      console.error(`TLS error: ${e.message}`);
      console.error('Falling back to HTTP.');
      server = http.createServer(requestHandler);
    }
  } else if (config.cert || config.key) {
    console.error('Warning: both --cert and --key are required for TLS. Running in HTTP mode.');
    server = http.createServer(requestHandler);
  } else {
    server = http.createServer(requestHandler);
  }

  // Origin checking for WebSocket connections
  const allowedOrigins = config.allowedOrigins;
  const wssOptions = { server };
  if (allowedOrigins.length > 0) {
    wssOptions.verifyClient = (info, cb) => {
      const origin = info.req.headers.origin;
      if (!origin) {
        cb(true);
        return;
      }
      try {
        const url = new URL(origin);
        const ok = allowedOrigins.some((allowed) => {
          // Exact origin match (e.g. "https://chess.example.com")
          if (url.origin === allowed) return true;
          // Exact hostname match (e.g. "chess.example.com")
          if (url.hostname === allowed) return true;
          return false;
        });
        cb(ok, ok ? 200 : 403);
      } catch {
        // Malformed origin header — reject
        cb(false, 403);
      }
    };
  }

  const wss = new WebSocketServer(wssOptions);
  const game = new Game();

  // Optional: load a custom starting position from FEN
  if (config.fen) {
    try {
      game.loadFromFen(config.fen);
      console.log(`Loaded starting position from FEN: ${game.currentFen()}`);
    } catch (e) {
      console.error(`Invalid FEN: ${e.message}`);
      process.exit(1);
    }
  }

  setupWebSocketHandlers(wss, game, { debug: config.debug });

  server.listen(PORT, HOST, () => {
    const os = require('os');
    const ifaces = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(ifaces)) {
      for (const iface of ifaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
      }
    }
    console.log(`Chess server running on ${HOST}:${PORT} (${protocol})`);
    console.log(`Local:   ${protocol}://localhost:${PORT}`);
    for (const ip of ips) console.log(`LAN:     ${protocol}://${ip}:${PORT}`);
  });
}

// Exported for testing
module.exports = { setupWebSocketHandlers, requestHandler, MIME, CLIENT_ROOT };
