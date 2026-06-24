// ═══════════════════════════════════════════════════════════
//  CHESS ENGINE — source of truth (CommonJS for Node.js)
//  Browser ES module (chess.mjs) is generated from this file
//  via `node build_chess_mjs.js`
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

// Find all pieces of the given type and color (excluding source) that can move to the target square
function findAmbiguousPieces(board, type, color, fromFile, fromRank, toFile, toRank, castlingRights, enPassantTarget) {
  const ambiguous = [];
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const piece = board[r][f];
      // Skip: empty square, wrong color, wrong type, or the source piece
      if (piece === 0 || pieceColor(piece) !== color || pieceType(piece) !== type) continue;
      if (f === fromFile && r === fromRank) continue;
      const moves = getValidMoves(board, f, r, castlingRights, enPassantTarget);
      if (moves.some(m => m.file === toFile && m.rank === toRank)) {
        ambiguous.push({ file: f, rank: r });
      }
    }
  }
  return ambiguous;
}

function buildNotation(board, type, fromFile, fromRank, toFile, toRank, captured, enPassant, castled, isPromotion, castlingRights, enPassantTarget) {
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
    // Piece move: letter + optional disambiguation + optional capture x + destination
    n = PIECE_LETTERS[type];

    // Check for disambiguation needed
    const color = pieceColor(board[fromRank][fromFile]);
    const ambiguous = findAmbiguousPieces(board, type, color, fromFile, fromRank, toFile, toRank,
      castlingRights || { wK:true, wQ:true, bK:true, bQ:true }, enPassantTarget);

    if (ambiguous.length > 0) {
      // Check if file disambiguation is sufficient
      const sameFile = ambiguous.some(p => p.file === fromFile);
      const sameRank = ambiguous.some(p => p.rank === fromRank);

      if (!sameFile) {
        // File alone disambiguates (e.g., Nce4)
        n += FILES[fromFile];
      } else if (!sameRank) {
        // Rank alone disambiguates (e.g., R1d4)
        n += RANKS[fromRank];
      } else {
        // Both needed — e.g. three knights on b2, b6, d2 all reaching c4:
        // file alone can't distinguish from b6, rank alone can't from d2 → Nb2c4
        n += FILES[fromFile] + RANKS[fromRank];
      }
    }

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
    this.capturedPieces = { white: [], black: [] }; // pieces each side has captured
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

    // Track captured piece
    if (captured !== 0) {
      this.capturedPieces[color].push(pieceType(captured));
    }
    if (isEnPassant) {
      this.capturedPieces[color].push('pawn');
    }

    // Check for promotion BEFORE making the move (for disambiguation)
    const isPromotion = type === 'pawn' && (toRank === 0 || toRank === 7);

    // Calculate notation BEFORE making the move (board state needed for disambiguation)
    let castled = null;
    if (type === 'king' && Math.abs(toFile - fromFile) === 2) {
      if (toFile > fromFile) {
        castled = { from: 7, to: 5, rank: toRank };
      } else {
        castled = { from: 0, to: 3, rank: toRank };
      }
    }

    // Calculate notation with current board state (before move)
    const notation = buildNotation(this.board, type, fromFile, fromRank, toFile, toRank, !!captured, isEnPassant, castled, false, this.castlingRights, this.enPassantTarget);

    if (isPromotion) {
      this.promotingPiece = { file: toFile, rank: toRank, color, ws };
      // Record the pawn move; promotion suffix added later
      const promoNotation = notation + '=P';  // P for pawn (will be replaced with actual piece in completePromotion)
      this.moveHistory.push(promoNotation);
      return { ok: true, promotion: true, fromFile, fromRank, toFile, toRank, captured: !!captured, enPassant: isEnPassant, castled };
    }

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

    // Castling - move the rook
    if (castled) {
      if (castled.to === 5) {
        this.board[toRank][5] = this.board[toRank][7];
        this.board[toRank][7] = 0;
      } else {
        this.board[toRank][3] = this.board[toRank][0];
        this.board[toRank][0] = 0;
      }
      if (color === 'white') { this.castlingRights.wK = false; this.castlingRights.wQ = false; }
      else { this.castlingRights.bK = false; this.castlingRights.bQ = false; }
    }

    // Any king move revokes castling rights (not just castling itself)
    if (type === 'king') {
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

    // Switch turn
    this.turn = this.turn === 'white' ? 'black' : 'white';

    // Record move with proper algebraic notation
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
    if (!(pieceType in pieceMap)) return false;
    const val = color === 'white' ? pieceMap[pieceType] : pieceMap[pieceType] + 6;
    this.board[rank][file] = val;
    this.promotingPiece = null;

    // Switch turn
    this.turn = this.turn === 'white' ? 'black' : 'white';

    // Replace the =P placeholder with the actual promotion piece
    const promoNotation = `=${pieceType[0].toUpperCase()}`;
    if (this.moveHistory.length > 0) {
      const last = this.moveHistory.length - 1;
      this.moveHistory[last] = this.moveHistory[last].slice(0, -2) + promoNotation;
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

  concede(ws) {
    if (this.gameOver) return false;
    const color = this.players.get(ws);
    if (!color) return false;
    this.gameOver = true;
    const winner = color === 'white' ? 'black' : 'white';
    this.gameResult = `${color.charAt(0).toUpperCase() + color.slice(1)} conceded. ${winner.charAt(0).toUpperCase() + winner.slice(1)} wins!`;
    return true;
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
      capturedPieces: { white: [...this.capturedPieces.white], black: [...this.capturedPieces.black] },
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
    this.capturedPieces = { white: [], black: [] };
    this.gameOver = false;
    this.gameResult = null;
  }
}

// ═══════════════════════════════════════════════════════════
//  EXPORTS (CommonJS)
// ═══════════════════════════════════════════════════════════

module.exports = {
  EMPTY, W_PAWN, W_KNIGHT, W_BISHOP, W_ROOK, W_QUEEN, W_KING,
  B_PAWN, B_KNIGHT, B_BISHOP, B_ROOK, B_QUEEN, B_KING,
  pieceColor, pieceType, isOwn, isEnemy,
  startingBoard, cloneBoard, findKing,
  isAttacked, isInCheck, getValidMoves, hasAnyMoves,
  buildNotation, Game,
};
