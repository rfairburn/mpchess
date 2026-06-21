const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Game, W_ROOK, B_ROOK, pieceColor, pieceType, isInCheck } = require('./shared/chess');

// ═══════════════════════════════════════════════════════════
//  HTTP SERVER + WEBSOCKET
// ═══════════════════════════════════════════════════════════

const HOST = '0.0.0.0';
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
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

  // Prevent path traversal: strip leading '/', normalize, reject '..', and ensure resolved path stays within __dirname
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

const wss = new WebSocketServer({ server });

// Single game instance
const game = new Game();

function broadcast(data, excludeWs) {
  const msg = JSON.stringify(data);
  for (const ws of wss.clients) {
    if (ws !== excludeWs && ws.readyState === 1) {
      ws.send(msg);
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

function sendState(ws) {
  const role = getRole(ws);
  const state = game.getState();
  send(ws, { type: 'state', role, ...state });
}

wss.on('connection', (ws) => {
  console.log(`Client connected. Total: ${wss.clients.size}`);

  const role = game.addPlayer(ws);
  console.log(`  → Role: ${role}`);

  // Send full state to the new client
  sendState(ws);

  // Send full state to ALL existing clients so they keep their role + updated counts
  for (const c of wss.clients) {
    if (c !== ws && c.readyState === 1) sendState(c);
  }

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'move': {
        // Validate bounds: indices must be integers in [0, 7]
        const { fromFile, fromRank, toFile, toRank } = msg;
        if (![fromFile, fromRank, toFile, toRank].every(v => Number.isInteger(v) && v >= 0 && v <= 7)) return;
        const result = game.tryMove(ws, fromFile, fromRank, toFile, toRank);
        console.log(`  Move ${msg.fromFile},${msg.fromRank}→${msg.toFile},${msg.toRank}: ${result.ok ? 'OK' : result.reason}`);
        if (result.ok) {
          broadcast({ type: 'move', ...result });
          // Send state to everyone
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
          // Send state to everyone
          for (const c of wss.clients) {
            if (c.readyState === 1) sendState(c);
          }
        }
        break;
      }
      case 'restart': {
        // Only players can restart
        if (game.players.has(ws)) {
          game.reset();
          console.log('  Game restarted by', game.players.get(ws) || 'unknown');
          // Send state to ALL clients first, then restart signal
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
          console.log(`  ${color} conceded`);
          for (const c of wss.clients) {
            if (c.readyState === 1) sendState(c);
          }
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    const color = game.removePlayer(ws);
    console.log(`Client disconnected. Was: ${color || 'spectator'}. Total: ${wss.clients.size}`);
    // Send full state to remaining clients so they have updated counts
    for (const c of wss.clients) {
      if (c.readyState === 1) sendState(c);
    }
  });
});

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
