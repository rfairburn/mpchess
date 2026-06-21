const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

// ═══════════════════════════════════════════════════════════
//  CHESS ENGINE — server-side authority
// ═══════════════════════════════════════════════════════════

const EMPTY = 0;
const W_PAWN=1, W_KNIGHT=2, W_BISHOP=3, W_ROOK=4, W_QUEEN=5, W_KING=6;
const B_PAWN=7, B_KNIGHT=8, B_BISHOP=9, B_ROOK=10, B_QUEEN=11, B_KING=12;

function pieceColor(p) { if (p === 0) return null; return p >= 7 ? 'black' : 'white'; }
function pieceType(p) {
  if (p === 0) return null;
  const t = p >= 7 ? p - 7 : p - 1;
  return ['pawn','knight','bishop','rook','queen','king'][t] || null;
}
function isOwn(p, color) { return pieceColor(p) === color; }
function isEnemy(p, color) { return p !== 0 && pieceColor(p) !== color; }

function startingBoard() {
  const b = Array.from({length:8}, () => Array(8).fill(0));
  const back = [W_ROOK,W_KNIGHT,W_BISHOP,W_QUEEN,W_KING,W_BISHOP,W_KNIGHT,W_ROOK];
  for (let f=0;f<8;f++) { b[0][f]=back[f]; b[7][f]=back[f]+6; }
  for (let f=0;f<8;f++) { b[1][f]=W_PAWN; b[6][f]=B_PAWN; }
  return b;
}

function cloneBoard(b) { return b.map(r => [...r]); }

function findKing(board, color) {
  const k = color === 'white' ? W_KING : B_KING;
  for (let r=0;r<8;r++) for (let f=0;f<8;f++) if (board[r][f]===k) return {file:f, rank:r};
  return null;
}

function isAttacked(board, file, rank, byColor) {
  // White pawns sit at lower ranks and attack upward (toward higher ranks)
  // so a white pawn attacks (file,rank) from (file±1, rank-1)
  if (byColor === 'white') {
    if (rank-1>=0 && file-1>=0 && board[rank-1][file-1]===W_PAWN) return true;
    if (rank-1>=0 && file+1<8 && board[rank-1][file+1]===W_PAWN) return true;
  } else {
    // Black pawns sit at higher ranks and attack downward (toward lower ranks)
    // so a black pawn attacks (file,rank) from (file±1, rank+1)
    if (rank+1<8 && file-1>=0 && board[rank+1][file-1]===B_PAWN) return true;
    if (rank+1<8 && file+1<8 && board[rank+1][file+1]===B_PAWN) return true;
  }
  const knight = byColor==='white' ? W_KNIGHT : B_KNIGHT;
  for (const [df,dr] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
    const nf=file+df, nr=rank+dr;
    if (nf>=0&&nf<8&&nr>=0&&nr<8&&board[nr][nf]===knight) return true;
  }
  const king = byColor==='white' ? W_KING : B_KING;
  for (let dr=-1;dr<=1;dr++) for (let df=-1;df<=1;df++) {
    if (dr===0&&df===0) continue;
    const nf=file+df, nr=rank+dr;
    if (nf>=0&&nf<8&&nr>=0&&nr<8&&board[nr][nf]===king) return true;
  }
  const bishop = byColor==='white' ? W_BISHOP : B_BISHOP;
  const queen = byColor==='white' ? W_QUEEN : B_QUEEN;
  for (const [df,dr] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
    for (let i=1;i<8;i++) {
      const nf=file+df*i, nr=rank+dr*i;
      if (nf<0||nf>=8||nr<0||nr>=8) break;
      const p=board[nr][nf];
      if (p!==0) { if (p===bishop||p===queen) return true; break; }
    }
  }
  const rook = byColor==='white' ? W_ROOK : B_ROOK;
  for (const [df,dr] of [[-1,0],[1,0],[0,-1],[0,1]]) {
    for (let i=1;i<8;i++) {
      const nf=file+df*i, nr=rank+dr*i;
      if (nf<0||nf>=8||nr<0||nr>=8) break;
      const p=board[nr][nf];
      if (p!==0) { if (p===rook||p===queen) return true; break; }
    }
  }
  return false;
}

function isInCheck(board, color) {
  const k = findKing(board, color);
  if (!k) return false;
  return isAttacked(board, k.file, k.rank, color==='white'?'black':'white');
}

function getValidMoves(board, file, rank, castlingRights, enPassantTarget) {
  const piece = board[rank][file];
  if (piece === 0) return [];
  const color = pieceColor(piece);
  const moves = [];
  const type = pieceType(piece);

  function addMove(tf, tr, isEnPassant) {
    if (tf<0||tf>=8||tr<0||tr>=8) return false;
    const target = board[tr][tf];
    if (target !== 0 && isOwn(target, color)) return true;
    const saved = board[tr][tf];
    board[tr][tf] = piece;
    board[rank][file] = 0;
    let epCaptured = null;
    if (type==='pawn' && enPassantTarget && tf===enPassantTarget.file && tr===enPassantTarget.rank) {
      const capturedRank = color==='white' ? tr-1 : tr+1;
      epCaptured = board[capturedRank][tf];
      board[capturedRank][tf] = 0;
    }
    const inCheck = isInCheck(board, color);
    board[rank][file] = piece;
    board[tr][tf] = saved;
    if (epCaptured !== null) {
      const capturedRank = color==='white' ? tr-1 : tr+1;
      board[capturedRank][tf] = epCaptured;
    }
    if (!inCheck) moves.push({file:tf, rank:tr, enPassant: isEnPassant});
    return target !== 0;
  }

  if (type === 'pawn') {
    const dir = color === 'white' ? 1 : -1;
    const startRank = color === 'white' ? 1 : 6;
    const nr = rank + dir;
    if (nr>=0 && nr<8 && board[nr][file]===0) {
      addMove(file, nr);
      const nr2 = rank + 2*dir;
      if (rank===startRank && nr2>=0 && nr2<8 && board[nr2][file]===0) {
        addMove(file, nr2);
      }
    }
    for (const df of [-1,1]) {
      const nf = file+df;
      if (nf>=0 && nf<8 && nr>=0 && nr<8) {
        if (isEnemy(board[nr][nf], color)) addMove(nf, nr);
        if (enPassantTarget && nf===enPassantTarget.file && nr===enPassantTarget.rank) {
          addMove(nf, nr, true);
        }
      }
    }
  } else if (type === 'knight') {
    for (const [df,dr] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
      addMove(file+df, rank+dr);
    }
  } else if (type === 'bishop') {
    for (const [df,dr] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
      for (let i=1;i<8;i++) { if (addMove(file+df*i, rank+dr*i)) break; }
    }
  } else if (type === 'rook') {
    for (const [df,dr] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      for (let i=1;i<8;i++) { if (addMove(file+df*i, rank+dr*i)) break; }
    }
  } else if (type === 'queen') {
    for (const [df,dr] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
      for (let i=1;i<8;i++) { if (addMove(file+df*i, rank+dr*i)) break; }
    }
  } else if (type === 'king') {
    for (let dr=-1;dr<=1;dr++) for (let df=-1;df<=1;df++) {
      if (dr===0&&df===0) continue;
      addMove(file+df, rank+dr);
    }
    if (color==='white' && rank===0 && file===4) {
      if (castlingRights.wK && board[0][5]===0 && board[0][6]===0 && board[0][7]===W_ROOK) {
        if (!isInCheck(board,'white') && !isAttacked(board,5,0,'black') && !isAttacked(board,6,0,'black')) {
          moves.push({file:6, rank:0, castle:'K'});
        }
      }
      if (castlingRights.wQ && board[0][3]===0 && board[0][2]===0 && board[0][1]===0 && board[0][0]===W_ROOK) {
        if (!isInCheck(board,'white') && !isAttacked(board,3,0,'black') && !isAttacked(board,2,0,'black')) {
          moves.push({file:2, rank:0, castle:'Q'});
        }
      }
    }
    if (color==='black' && rank===7 && file===4) {
      if (castlingRights.bK && board[7][5]===0 && board[7][6]===0 && board[7][7]===B_ROOK) {
        if (!isInCheck(board,'black') && !isAttacked(board,5,7,'white') && !isAttacked(board,6,7,'white')) {
          moves.push({file:6, rank:7, castle:'K'});
        }
      }
      if (castlingRights.bQ && board[7][3]===0 && board[7][2]===0 && board[7][1]===0 && board[7][0]===B_ROOK) {
        if (!isInCheck(board,'black') && !isAttacked(board,3,7,'white') && !isAttacked(board,2,7,'white')) {
          moves.push({file:2, rank:7, castle:'Q'});
        }
      }
    }
  }
  return moves;
}

function hasAnyMoves(board, color, castlingRights, enPassantTarget) {
  for (let r=0;r<8;r++) for (let f=0;f<8;f++) {
    if (pieceColor(board[r][f]) === color && getValidMoves(board, f, r, castlingRights, enPassantTarget).length > 0) {
      return true;
    }
  }
  return false;
}

// ═══════════════════════════════════════════════════════════
//  ALGEBRAIC NOTATION
// ═══════════════════════════════════════════════════════════

const FILES = 'abcdefgh';
const RANKS = '12345678';
const PIECE_LETTERS = { king:'K', queen:'Q', rook:'R', bishop:'B', knight:'N', pawn:'' };

function buildNotation(board, type, fromFile, fromRank, toFile, toRank, captured, enPassant, castled, isPromotion) {
  const sq = () => FILES[toFile] + RANKS[toRank];

  // Castling
  if (castled) {
    return castled.to === 5 ? 'O-O' : 'O-O-O';
  }

  let n = '';

  if (type === 'pawn') {
    // Pawn capture: departure file + x + destination (e.g. exd5)
    if (captured || enPassant) {
      n = FILES[fromFile] + 'x' + sq();
    } else {
      // Simple pawn move: just destination (e.g. e4)
      n = sq();
    }
  } else {
    // Piece move: letter + optional capture x + destination
    n = PIECE_LETTERS[type];
    if (captured) n += 'x';
    n += sq();
  }

  return n;
}

// ═══════════════════════════════════════════════════════════
//  GAME STATE
// ═══════════════════════════════════════════════════════════

class Game {
  constructor() {
    this.board = startingBoard();
    this.turn = 'white';
    this.castlingRights = { wK:true, wQ:true, bK:true, bQ:true };
    this.enPassantTarget = null;
    this.promotingPiece = null; // {file, rank, color, ws} awaiting promotion
    this.players = new Map(); // ws -> 'white' | 'black'
    this.spectators = new Set();
    this.moveHistory = [];
    this.gameOver = false;
    this.gameResult = null;
  }

  addPlayer(ws) {
    const colors = ['white', 'black'];
    const occupied = new Set([...this.players.values()]);
    for (const color of colors) {
      if (!occupied.has(color)) {
        this.players.set(ws, color);
        return color;
      }
    }
    this.spectators.add(ws);
    return 'spectator';
  }

  removePlayer(ws) {
    if (this.players.has(ws)) {
      const color = this.players.get(ws);
      this.players.delete(ws);
      // If a player leaves during their promotion, auto-promote to queen
      if (this.promotingPiece && this.promotingPiece.ws === ws) {
        this.completePromotion(ws, 'queen');
      }
      return color;
    }
    this.spectators.delete(ws);
    return null;
  }

  tryMove(ws, fromFile, fromRank, toFile, toRank) {
    const piece = this.board[fromRank][fromFile];
    if (piece === 0) return { ok: false, reason: 'No piece there' };
    const color = pieceColor(piece);
    const type = pieceType(piece);

    // Check if this player is authorized and it's their turn
    if (this.players.get(ws) !== color || this.turn !== color) {
      return { ok: false, reason: `Not your turn` };
    }
    if (this.gameOver) return { ok: false, reason: 'Game over' };
    if (this.promotingPiece) return { ok: false, reason: 'Promotion in progress' };

    const moves = getValidMoves(this.board, fromFile, fromRank, this.castlingRights, this.enPassantTarget);
    const move = moves.find(m => m.file === toFile && m.rank === toRank);
    if (!move) return { ok: false, reason: 'Invalid move' };

    const captured = this.board[toRank][toFile];
    const isEnPassant = move.enPassant === true;

    // En passant capture
    if (isEnPassant) {
      const capturedRank = color === 'white' ? toRank - 1 : toRank + 1;
      this.board[capturedRank][toFile] = 0;
    }

    this.board[toRank][toFile] = piece;
    this.board[fromRank][fromFile] = 0;

    // Update en passant target
    this.enPassantTarget = null;
    if (type === 'pawn' && Math.abs(toRank - fromRank) === 2) {
      this.enPassantTarget = { file: fromFile, rank: (fromRank + toRank) / 2 };
    }

    // Castling
    let castled = null;
    if (type === 'king' && Math.abs(toFile - fromFile) === 2) {
      if (toFile > fromFile) {
        this.board[toRank][5] = this.board[toRank][7];
        this.board[toRank][7] = 0;
        castled = { from: 7, to: 5, rank: toRank };
      } else {
        this.board[toRank][3] = this.board[toRank][0];
        this.board[toRank][0] = 0;
        castled = { from: 0, to: 3, rank: toRank };
      }
      if (color === 'white') { this.castlingRights.wK = false; this.castlingRights.wQ = false; }
      else { this.castlingRights.bK = false; this.castlingRights.bQ = false; }
    }

    // Rook moved
    if (type === 'rook') {
      if (color === 'white') {
        if (fromRank === 0 && fromFile === 0) this.castlingRights.wQ = false;
        if (fromRank === 0 && fromFile === 7) this.castlingRights.wK = false;
      } else {
        if (fromRank === 7 && fromFile === 0) this.castlingRights.bQ = false;
        if (fromRank === 7 && fromFile === 7) this.castlingRights.bK = false;
      }
    }

    // Captured rook
    if (captured && pieceType(captured) === 'rook') {
      if (captured === W_ROOK && toRank === 0 && toFile === 0) this.castlingRights.wQ = false;
      if (captured === W_ROOK && toRank === 0 && toFile === 7) this.castlingRights.wK = false;
      if (captured === B_ROOK && toRank === 7 && toFile === 0) this.castlingRights.bQ = false;
      if (captured === B_ROOK && toRank === 7 && toFile === 7) this.castlingRights.bK = false;
    }

    // Check for promotion
    const isPromotion = type === 'pawn' && (toRank === 0 || toRank === 7);
    if (isPromotion) {
      this.promotingPiece = { file: toFile, rank: toRank, color, ws };
      // Record the pawn move; promotion suffix added later
      const promoNotation = buildNotation(this.board, type, fromFile, fromRank, toFile, toRank, !!captured, isEnPassant, castled, true);
      this.moveHistory.push(promoNotation);
      return { ok: true, promotion: true, fromFile, fromRank, toFile, toRank, captured: !!captured, enPassant: isEnPassant, castled };
    }

    // Switch turn
    this.turn = this.turn === 'white' ? 'black' : 'white';

    // Record move with proper algebraic notation
    const notation = buildNotation(this.board, type, fromFile, fromRank, toFile, toRank, !!captured, isEnPassant, castled, false);
    this.moveHistory.push(notation);

    // Check game end and append check/mate symbol
    this.checkGameEnd();
    if (this.gameOver) {
      this.moveHistory[this.moveHistory.length - 1] += '#';
    } else if (isInCheck(this.board, this.turn)) {
      this.moveHistory[this.moveHistory.length - 1] += '+';
    }

    return { ok: true, fromFile, fromRank, toFile, toRank, captured: !!captured, enPassant: isEnPassant, castled, notation };
  }

  completePromotion(ws, pieceType) {
    if (!this.promotingPiece || this.promotingPiece.ws !== ws) return false;
    const { file, rank, color } = this.promotingPiece;
    const pieceMap = { queen: 5, rook: 4, bishop: 3, knight: 2 };
    const val = color === 'white' ? pieceMap[pieceType] : pieceMap[pieceType] + 6;
    this.board[rank][file] = val;
    this.promotingPiece = null;

    // Switch turn
    this.turn = this.turn === 'white' ? 'black' : 'white';

    // Record promotion move — find the pawn's departure file from move history context
    // The promotion notation is appended to the last move entry (the pawn move)
    const promoNotation = `=${pieceType[0].toUpperCase()}`;
    if (this.moveHistory.length > 0) {
      this.moveHistory[this.moveHistory.length - 1] += promoNotation;
    }

    this.checkGameEnd();
    if (this.gameOver) {
      this.moveHistory[this.moveHistory.length - 1] += '#';
    } else if (isInCheck(this.board, this.turn)) {
      this.moveHistory[this.moveHistory.length - 1] += '+';
    }
    return true;
  }

  checkGameEnd() {
    if (this.gameOver) return;
    const inCheck = isInCheck(this.board, this.turn);
    const hasMoves = hasAnyMoves(this.board, this.turn, this.castlingRights, this.enPassantTarget);

    if (!hasMoves) {
      this.gameOver = true;
      if (inCheck) {
        const winner = this.turn === 'white' ? 'black' : 'white';
        this.gameResult = `Checkmate! ${winner.charAt(0).toUpperCase() + winner.slice(1)} wins!`;
      } else {
        this.gameResult = 'Stalemate! Draw.';
      }
    }
  }

  getState() {
    return {
      board: this.board,
      turn: this.turn,
      castlingRights: this.castlingRights,
      enPassantTarget: this.enPassantTarget,
      promotingPiece: this.promotingPiece ? { file: this.promotingPiece.file, rank: this.promotingPiece.rank, color: this.promotingPiece.color } : null,
      gameOver: this.gameOver,
      gameResult: this.gameResult,
      moveHistory: [...this.moveHistory],
      playerCount: this.players.size,
      spectatorCount: this.spectators.size,
    };
  }

  reset() {
    this.board = startingBoard();
    this.turn = 'white';
    this.castlingRights = { wK:true, wQ:true, bK:true, bQ:true };
    this.enPassantTarget = null;
    this.promotingPiece = null;
    this.moveHistory = [];
    this.gameOver = false;
    this.gameResult = null;
  }
}

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

  const filePath = path.join(__dirname, urlPath);
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
        if (msg.fromFile === undefined || msg.fromRank === undefined || msg.toFile === undefined || msg.toRank === undefined) return;
        const result = game.tryMove(ws, msg.fromFile, msg.fromRank, msg.toFile, msg.toRank);
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
