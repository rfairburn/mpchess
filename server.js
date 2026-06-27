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

  const sessions = new Map();
  const disconnectedPlayers = new Map();
  let bothDisconnectedTimer = null;

  function broadcast(data, excludeWs) {
    const msg = JSON.stringify(data);
    for (const c of wss.clients) {
      if (c !== excludeWs && c.readyState === 1) {
        c.send(msg);
      }
    }
  }

  function send(ws, data) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(data));
    }
  }

  function getRole(ws) {
    if (game.players.has(ws)) return game.players.get(ws);
    if (game.spectators.has(ws)) return 'spectator';
    return null;
  }

  function buildDisconnectedPlayersArray() {
    const arr = [];
    for (const [token, entry] of disconnectedPlayers) {
      arr.push({ color: entry.color, token, disconnectedAt: entry.disconnectedAt });
    }
    return arr;
  }

  function buildSeatStatus(clientWs) {
    const seats = {};
    for (const color of ['white', 'black']) {
      // Check if actively occupied
      let occupiedWs = null;
      for (const [ws, c] of game.players) {
        if (c === color) { occupiedWs = ws; break; }
      }
      if (occupiedWs) {
        // Check if this client holds the active session (browser refresh)
        const clientSession = sessions.get(clientWs);
        const occupiedSession = sessions.get(occupiedWs);
        const clientToken = clientSession?.token;
        const canReconnect = !!(clientToken && occupiedSession?.token === clientToken);
        seats[color] = { status: 'occupied', canReconnect };
      } else {
        // Check if held by disconnected player
        let heldEntry = null;
        let heldToken = null;
        for (const [token, entry] of disconnectedPlayers) {
          if (entry.color === color) { heldEntry = entry; heldToken = token; break; }
        }
        if (heldEntry) {
          const freesAt = heldEntry.disconnectedAt + seatTimeout;
          // Check if this client's stored token matches the held seat
          const clientSession = sessions.get(clientWs);
          const clientToken = clientSession?.token;
          const canReconnect = clientToken === heldToken;
          seats[color] = { status: 'held', freesAt, remaining: Math.max(0, freesAt - Date.now()), canReconnect };
        } else {
          seats[color] = { status: 'free', canReconnect: false };
        }
      }
    }
    return seats;
  }

  function sendState(ws) {
    const role = getRole(ws);
    const state = game.getState();
    send(ws, { type: 'state', role, seats: buildSeatStatus(ws), disconnectedPlayers: buildDisconnectedPlayersArray(), ...state });
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
      for (const c of wss.clients) {
        if (c.readyState === 1) sendState(c);
      }
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
    for (const c of wss.clients) {
      if (c.readyState === 1) sendState(c);
    }
  }

  function finishReconnect(ws, color, token) {
    game.players.set(ws, color);
    sessions.set(ws, { token, color });
    send(ws, { type: 'reconnected', color });
    for (const c of wss.clients) {
      if (c.readyState === 1) sendState(c);
    }
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
    // Check if actively occupied
    for (const [, c] of game.players) {
      if (c === color) return false;
    }
    // Check if held
    for (const [, entry] of disconnectedPlayers) {
      if (entry.color === color) return false;
    }
    return true;
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
    for (const c of wss.clients) {
      if (c !== ws && c.readyState === 1) sendState(c);
    }
    maybeStartBothDisconnectedTimer();
  }

  function assignAndNotify(ws) {
    // Don't auto-assign players — just send state with seat info
    // Client will explicitly choose via 'join' message
    sendState(ws);
  }

  wss.on('connection', (ws) => {
    // Assign immediately — no timeout needed
    assignAndNotify(ws);

    // Fallback timeout: if for some reason the client has no role, re-assign
    const joinTimeout = setTimeout(() => {
      if (!getRole(ws)) {
        assignAndNotify(ws);
      }
    }, joinTimeoutMs);

    ws._joinTimeout = joinTimeout; // expose for tests to clear

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

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
          if (![fromFile, fromRank, toFile, toRank].every(v => Number.isInteger(v) && v >= 0 && v <= 7)) return;
          const result = game.tryMove(ws, fromFile, fromRank, toFile, toRank);
          if (result.ok) {
            broadcast({ type: 'move', ...result });
            for (const c of wss.clients) {
              if (c.readyState === 1) sendState(c);
            }
          } else {
            send(ws, { type: 'error', reason: result.reason });
          }
          break;
        }
        case 'promotion': {
          if (!game.promotingPiece || game.players.get(ws) !== game.promotingPiece.color) return;
          if (!['queen','rook','bishop','knight'].includes(msg.pieceType)) return;
          const ok = game.completePromotion(ws, msg.pieceType);
          if (ok) {
            broadcast({ type: 'promotion', pieceType: msg.pieceType });
            for (const c of wss.clients) {
              if (c.readyState === 1) sendState(c);
            }
          }
          break;
        }
        case 'restart': {
          if (game.players.has(ws)) {
            game.reset();
            for (const c of wss.clients) {
              if (c.readyState === 1) sendState(c);
            }
            broadcast({ type: 'restart' });
          }
          break;
        }
        case 'concede': {
          const color = game.players.get(ws);
          if (!color) return;
          const ok = game.concede(ws);
          if (ok) {
            for (const c of wss.clients) {
              if (c.readyState === 1) sendState(c);
            }
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
            game.loadFromFen(fen.trim());
            for (const c of wss.clients) {
              if (c.readyState === 1) sendState(c);
            }
            broadcast({ type: 'restart' });
          } catch (e) {
            send(ws, { type: 'error', reason: `Invalid FEN: ${e.message}` });
          }
          break;
        }
      }
    });

    ws.on('close', () => {
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

      for (const c of wss.clients) {
        if (c.readyState === 1) sendState(c);
      }
    });
  });

  return {
    sessions,
    disconnectedPlayers,
    stopBothDisconnectedTimer,
    getRole,
    sendState,
  };
}

module.exports = { setupWebSocketHandlers };

// ═══════════════════════════════════════════════════════════
//  HTTP SERVER + WEBSOCKET (production entry point)
// ═══════════════════════════════════════════════════════════

const HOST = '0.0.0.0';
const PORT = process.env.PORT || 3000;

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

const requestHandler = (req, res) => {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/client/index.html';

  const relativePath = urlPath.startsWith('/') ? urlPath.slice(1) : urlPath;
  const safePath = path.normalize(relativePath);
  if (safePath.startsWith('..')) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  const filePath = path.resolve(__dirname, safePath);
  if (!filePath.startsWith(path.resolve(__dirname) + path.sep) && filePath !== path.resolve(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  } catch (e) {
    res.writeHead(404);
    res.end('Not found');
  }
}

if (require.main === module) {
  // CLI help
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`
Usage: node server.js [options]

Options:
  --help, -h          Show this help message
  --fen=<fen_string>  Load a custom starting position (first game only;
                      restarts reset to standard setup)
  --port=<number>     Override PORT env var for the HTTP/WebSocket server
  --cert=<path>       TLS certificate file (enables HTTPS)
  --key=<path>        TLS private key file (required with --cert)
  --chain=<path>      TLS certificate chain file (optional, PEM format)

Examples:
  node server.js
  node server.js --cert=server.crt --key=server.key
  node server.js --cert=server.crt --key=server.key --chain=chain.pem
  node server.js --fen="4k3/8/8/8/8/8/8/4K2R w K - 0 1"
  PORT=8080 node server.js --fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
`);
    process.exit(0);
  }

  // Optional: override PORT from CLI
  const portArg = process.argv.find(a => a.startsWith('--port='));
  if (portArg) {
    process.env.PORT = portArg.slice(7);
  }

  // TLS support
  const certArg = process.argv.find(a => a.startsWith('--cert='));
  const keyArg = process.argv.find(a => a.startsWith('--key='));
  const chainArg = process.argv.find(a => a.startsWith('--chain='));
  let server;
  let protocol = 'http';

  if (certArg && keyArg) {
    try {
      const certPath = certArg.slice(certArg.indexOf('=') + 1);
      const keyPath = keyArg.slice(keyArg.indexOf('=') + 1);
      const tlsOptions = {
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath),
      };
      if (chainArg) {
        tlsOptions.ca = fs.readFileSync(chainArg.slice(chainArg.indexOf('=') + 1));
      }
      server = https.createServer(tlsOptions, requestHandler);
      protocol = 'https';
    } catch (e) {
      console.error(`TLS error: ${e.message}`);
      console.error('Falling back to HTTP.');
      server = http.createServer(requestHandler);
    }
  } else if (certArg || keyArg) {
    console.error('Warning: both --cert and --key are required for TLS. Running in HTTP mode.');
    server = http.createServer(requestHandler);
  } else {
    server = http.createServer(requestHandler);
  }

  const wss = new WebSocketServer({ server });
  const game = new Game();

  // Optional: load a custom starting position from FEN
  const fenArg = process.argv.find(a => a.startsWith('--fen='));
  if (fenArg) {
    try {
      game.loadFromFen(fenArg.slice(6));
      console.log(`Loaded starting position from FEN: ${game.currentFen()}`);
    } catch (e) {
      console.error(`Invalid FEN: ${e.message}`);
      process.exit(1);
    }
  }

  setupWebSocketHandlers(wss, game);

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
