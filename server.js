const http = require('http');
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

  function buildSeatStatus() {
    const seats = {};
    for (const color of ['white', 'black']) {
      // Check if actively occupied
      let occupiedWs = null;
      for (const [ws, c] of game.players) {
        if (c === color) { occupiedWs = ws; break; }
      }
      if (occupiedWs) {
        seats[color] = { status: 'occupied' };
      } else {
        // Check if held by disconnected player
        let heldEntry = null;
        for (const [, entry] of disconnectedPlayers) {
          if (entry.color === color) { heldEntry = entry; break; }
        }
        if (heldEntry) {
          const freesAt = heldEntry.disconnectedAt + seatTimeout;
          seats[color] = { status: 'held', freesAt, remaining: Math.max(0, freesAt - Date.now()) };
        } else {
          seats[color] = { status: 'free' };
        }
      }
    }
    return seats;
  }

  function sendState(ws) {
    const role = getRole(ws);
    const state = game.getState();
    send(ws, { type: 'state', role, seats: buildSeatStatus(), disconnectedPlayers: buildDisconnectedPlayersArray(), ...state });
  }

  function bothDisconnected() {
    return disconnectedPlayers.size >= 2 && game.players.size === 0;
  }

  function hasSpectators() {
    for (const c of wss.clients) {
      if (c.readyState === 1 && game.spectators.has(c)) return true;
    }
    return false;
  }

  function maybeStartBothDisconnectedTimer() {
    if (bothDisconnectedTimer) return;
    if (!bothDisconnected()) return;
    // Always start the timer — don't require spectators
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

  function handleReconnect(ws, data) {
    // Always remove ws from spectators first (may have been auto-assigned as spectator)
    game.spectators.delete(ws);

    // Try reconnecting to a disconnected (held) seat first
    let entry = disconnectedPlayers.get(data.token);
    if (entry) {
      stopBothDisconnectedTimer();
      disconnectedPlayers.delete(data.token);
      game.players.set(ws, entry.color);
      sessions.set(ws, { token: data.token, color: entry.color });
      send(ws, { type: 'reconnected', color: entry.color });
      for (const c of wss.clients) {
        if (c.readyState === 1) sendState(c);
      }
      return true;
    }

    // Also try reconnecting to an active session (browser refresh while still connected)
    for (const [oldWs, session] of sessions) {
      if (session.token === data.token) {
        // Transfer session from old socket to new one
        const color = session.color;
        game.players.delete(oldWs);
        game.spectators.delete(oldWs); // clean up old socket too
        sessions.delete(oldWs);
        // Close the old socket gracefully
        if (oldWs.readyState === 1) oldWs.close();
        game.players.set(ws, color);
        sessions.set(ws, { token: data.token, color });
        send(ws, { type: 'reconnected', color });
        for (const c of wss.clients) {
          if (c.readyState === 1) sendState(c);
        }
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

  function getDisconnectedColors() {
    const colors = [];
    for (const [, entry] of disconnectedPlayers) colors.push(entry.color);
    return colors;
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
      // Seat not available — fall back to spectator
      game.spectators.add(ws);
      send(ws, { type: 'joined', color: 'spectator' });
    }

    sendState(ws);
    for (const c of wss.clients) {
      if (c !== ws && c.readyState === 1) sendState(c);
    }
    maybeStartBothDisconnectedTimer();
  }

  function handleFirstMessage(ws, msg, joinTimeout) {
    clearTimeout(joinTimeout);
    // If it's a join request, handle it
    if (msg.type === 'join') {
      handleJoin(ws, msg);
      return true;
    }
    // Legacy fallback: auto-assign
    const role = game.addPlayer(ws, getDisconnectedColors());
    if (role === 'white' || role === 'black') {
      const token = crypto.randomUUID();
      sessions.set(ws, { token, color: role });
      send(ws, { type: 'joined', color: role, token });
    }
    sendState(ws);
    for (const c of wss.clients) {
      if (c !== ws && c.readyState === 1) sendState(c);
    }
    maybeStartBothDisconnectedTimer();
    return true;
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

      // Handle explicit join request (works for any client)
      if (msg.type === 'join') {
        clearTimeout(joinTimeout);
        handleJoin(ws, msg);
        return;
      }

      // Legacy: auto-assign if no role yet
      if (!getRole(ws)) {
        const shouldFallThrough = handleFirstMessage(ws, msg, joinTimeout);
        if (!shouldFallThrough) return;
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
          if (!game.promotingPiece || game.promotingPiece.ws !== ws) return;
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
        case 'join': {
          handleJoin(ws, msg);
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

const server = http.createServer((req, res) => {
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
});

if (require.main === module) {
  const wss = new WebSocketServer({ server });
  const game = new Game();
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
    console.log(`Chess server running on ${HOST}:${PORT}`);
    console.log(`Local:   http://localhost:${PORT}`);
    for (const ip of ips) console.log(`LAN:     http://${ip}:${PORT}`);
  });
}
