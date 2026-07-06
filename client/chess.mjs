// ═══════════════════════════════════════════════════════════
//  CHESS ENGINE — source of truth (CommonJS for Node.js)
//  Browser ES module (chess.mjs) is generated from this file
//  via `node build_chess_mjs.js`
// ═══════════════════════════════════════════════════════════

// crypto is Node-only; browser build (chess.mjs) never uses Zobrist
let crypto;
try {
  crypto = require('crypto');
} catch {
  /* browser — no crypto */
}

const EMPTY = 0;
const W_PAWN = 1,
  W_KNIGHT = 2,
  W_BISHOP = 3,
  W_ROOK = 4,
  W_QUEEN = 5,
  W_KING = 6;
const B_PAWN = 7,
  B_KNIGHT = 8,
  B_BISHOP = 9,
  B_ROOK = 10,
  B_QUEEN = 11,
  B_KING = 12;

function pieceColor(p) {
  if (p === 0) return null;
  return p >= 7 ? 'black' : 'white';
}
function pieceType(p) {
  if (p === 0) return null;
  const t = p >= 7 ? p - 7 : p - 1;
  return ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'][t] || null;
}
function isOwn(p, color) {
  return pieceColor(p) === color;
}
function isEnemy(p, color) {
  return p !== 0 && pieceColor(p) !== color;
}

function startingBoard() {
  const b = Array.from({ length: 8 }, () => Array(8).fill(0));
  const back = [W_ROOK, W_KNIGHT, W_BISHOP, W_QUEEN, W_KING, W_BISHOP, W_KNIGHT, W_ROOK];
  for (let f = 0; f < 8; f++) {
    b[0][f] = back[f];
    b[7][f] = back[f] + 6;
  }
  for (let f = 0; f < 8; f++) {
    b[1][f] = W_PAWN;
    b[6][f] = B_PAWN;
  }
  return b;
}

function cloneBoard(b) {
  return b.map((r) => [...r]);
}

function findKing(board, color) {
  const k = color === 'white' ? W_KING : B_KING;
  for (let r = 0; r < 8; r++)
    for (let f = 0; f < 8; f++) if (board[r][f] === k) return { file: f, rank: r };
  return null;
}

function isAttacked(board, file, rank, byColor) {
  // White pawns sit at lower ranks and attack upward (toward higher ranks)
  // so a white pawn attacks (file,rank) from (file±1, rank-1)
  if (byColor === 'white') {
    if (rank - 1 >= 0 && file - 1 >= 0 && board[rank - 1][file - 1] === W_PAWN) return true;
    if (rank - 1 >= 0 && file + 1 < 8 && board[rank - 1][file + 1] === W_PAWN) return true;
  } else {
    // Black pawns sit at higher ranks and attack downward (toward lower ranks)
    // so a black pawn attacks (file,rank) from (file±1, rank+1)
    if (rank + 1 < 8 && file - 1 >= 0 && board[rank + 1][file - 1] === B_PAWN) return true;
    if (rank + 1 < 8 && file + 1 < 8 && board[rank + 1][file + 1] === B_PAWN) return true;
  }
  const knight = byColor === 'white' ? W_KNIGHT : B_KNIGHT;
  for (const [df, dr] of [
    [-2, -1],
    [-2, 1],
    [-1, -2],
    [-1, 2],
    [1, -2],
    [1, 2],
    [2, -1],
    [2, 1],
  ]) {
    const nf = file + df,
      nr = rank + dr;
    if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8 && board[nr][nf] === knight) return true;
  }
  const king = byColor === 'white' ? W_KING : B_KING;
  for (let dr = -1; dr <= 1; dr++)
    for (let df = -1; df <= 1; df++) {
      if (dr === 0 && df === 0) continue;
      const nf = file + df,
        nr = rank + dr;
      if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8 && board[nr][nf] === king) return true;
    }
  const bishop = byColor === 'white' ? W_BISHOP : B_BISHOP;
  const queen = byColor === 'white' ? W_QUEEN : B_QUEEN;
  for (const [df, dr] of [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ]) {
    for (let i = 1; i < 8; i++) {
      const nf = file + df * i,
        nr = rank + dr * i;
      if (nf < 0 || nf >= 8 || nr < 0 || nr >= 8) break;
      const p = board[nr][nf];
      if (p !== 0) {
        if (p === bishop || p === queen) return true;
        break;
      }
    }
  }
  const rook = byColor === 'white' ? W_ROOK : B_ROOK;
  for (const [df, dr] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ]) {
    for (let i = 1; i < 8; i++) {
      const nf = file + df * i,
        nr = rank + dr * i;
      if (nf < 0 || nf >= 8 || nr < 0 || nr >= 8) break;
      const p = board[nr][nf];
      if (p !== 0) {
        if (p === rook || p === queen) return true;
        break;
      }
    }
  }
  return false;
}

function isInCheck(board, color) {
  const k = findKing(board, color);
  if (!k) return false;
  return isAttacked(board, k.file, k.rank, color === 'white' ? 'black' : 'white');
}

function getValidMoves(board, file, rank, castlingRights, enPassantTarget) {
  const piece = board[rank][file];
  if (piece === 0) return [];
  const color = pieceColor(piece);
  const moves = [];
  const type = pieceType(piece);

  function addMove(tf, tr, isEnPassant) {
    if (tf < 0 || tf >= 8 || tr < 0 || tr >= 8) return false;
    const target = board[tr][tf];
    if (target !== 0 && isOwn(target, color)) return true;
    const saved = board[tr][tf];
    let epCaptured = null;
    try {
      board[tr][tf] = piece;
      board[rank][file] = 0;
      if (
        type === 'pawn' &&
        enPassantTarget &&
        tf === enPassantTarget.file &&
        tr === enPassantTarget.rank
      ) {
        const capturedRank = color === 'white' ? tr - 1 : tr + 1;
        epCaptured = board[capturedRank][tf];
        board[capturedRank][tf] = 0;
      }
      const inCheck = isInCheck(board, color);
      if (!inCheck) moves.push({ file: tf, rank: tr, enPassant: isEnPassant });
    } finally {
      board[rank][file] = piece;
      board[tr][tf] = saved;
      if (epCaptured !== null) {
        const capturedRank = color === 'white' ? tr - 1 : tr + 1;
        board[capturedRank][tf] = epCaptured;
      }
    }
    return target !== 0;
  }

  if (type === 'pawn') {
    const dir = color === 'white' ? 1 : -1;
    const startRank = color === 'white' ? 1 : 6;
    const nr = rank + dir;
    if (nr >= 0 && nr < 8 && board[nr][file] === 0) {
      addMove(file, nr);
      const nr2 = rank + 2 * dir;
      if (rank === startRank && nr2 >= 0 && nr2 < 8 && board[nr2][file] === 0) {
        addMove(file, nr2);
      }
    }
    for (const df of [-1, 1]) {
      const nf = file + df;
      if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
        if (isEnemy(board[nr][nf], color)) addMove(nf, nr);
        if (enPassantTarget && nf === enPassantTarget.file && nr === enPassantTarget.rank) {
          addMove(nf, nr, true);
        }
      }
    }
  } else if (type === 'knight') {
    for (const [df, dr] of [
      [-2, -1],
      [-2, 1],
      [-1, -2],
      [-1, 2],
      [1, -2],
      [1, 2],
      [2, -1],
      [2, 1],
    ]) {
      addMove(file + df, rank + dr);
    }
  } else if (type === 'bishop') {
    for (const [df, dr] of [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ]) {
      for (let i = 1; i < 8; i++) {
        if (addMove(file + df * i, rank + dr * i)) break;
      }
    }
  } else if (type === 'rook') {
    for (const [df, dr] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      for (let i = 1; i < 8; i++) {
        if (addMove(file + df * i, rank + dr * i)) break;
      }
    }
  } else if (type === 'queen') {
    for (const [df, dr] of [
      [-1, -1],
      [-1, 0],
      [-1, 1],
      [0, -1],
      [0, 1],
      [1, -1],
      [1, 0],
      [1, 1],
    ]) {
      for (let i = 1; i < 8; i++) {
        if (addMove(file + df * i, rank + dr * i)) break;
      }
    }
  } else if (type === 'king') {
    for (let dr = -1; dr <= 1; dr++)
      for (let df = -1; df <= 1; df++) {
        if (dr === 0 && df === 0) continue;
        addMove(file + df, rank + dr);
      }
    // Castling — parameterized for white/black
    if (file === 4) {
      const kRight = color === 'white' ? 'wK' : 'bK';
      const qRight = color === 'white' ? 'wQ' : 'bQ';
      const rookVal = color === 'white' ? W_ROOK : B_ROOK;
      const enemy = color === 'white' ? 'black' : 'white';
      if (
        castlingRights[kRight] &&
        board[rank][5] === 0 &&
        board[rank][6] === 0 &&
        board[rank][7] === rookVal
      ) {
        if (
          !isInCheck(board, color) &&
          !isAttacked(board, 5, rank, enemy) &&
          !isAttacked(board, 6, rank, enemy)
        ) {
          moves.push({ file: 6, rank, castle: 'K' });
        }
      }
      if (
        castlingRights[qRight] &&
        board[rank][3] === 0 &&
        board[rank][2] === 0 &&
        board[rank][1] === 0 &&
        board[rank][0] === rookVal
      ) {
        if (
          !isInCheck(board, color) &&
          !isAttacked(board, 3, rank, enemy) &&
          !isAttacked(board, 2, rank, enemy)
        ) {
          moves.push({ file: 2, rank, castle: 'Q' });
        }
      }
    }
  }
  return moves;
}

function hasAnyMoves(board, color, castlingRights, enPassantTarget) {
  for (let r = 0; r < 8; r++)
    for (let f = 0; f < 8; f++) {
      if (
        pieceColor(board[r][f]) === color &&
        getValidMoves(board, f, r, castlingRights, enPassantTarget).length > 0
      ) {
        return true;
      }
    }
  return false;
}

// Maximum position history entries — chess games rarely exceed 200 moves,
// and the 50-move rule triggers a draw well before unbounded growth matters.
// This cap prevents memory growth in pathological cases (e.g., FEN imports).
const MAX_POSITION_HISTORY = 500;

// Collect all pieces on the board as {type, color, file, rank}
function collectPieces(board) {
  const pieces = { white: [], black: [] };
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (p !== 0) {
        pieces[pieceColor(p)].push({ type: pieceType(p), file: f, rank: r });
      }
    }
  }
  return pieces;
}

// Check if the board has insufficient material to deliver checkmate
function isInsufficientMaterial(board) {
  const pieces = collectPieces(board);
  const wp = pieces.white;
  const bp = pieces.black;

  // K vs K
  if (wp.length === 1 && bp.length === 1) return true;

  // K+B vs K or K vs K+B
  if (wp.length === 2 && bp.length === 1 && wp.some((p) => p.type === 'bishop')) return true;
  if (wp.length === 1 && bp.length === 2 && bp.some((p) => p.type === 'bishop')) return true;

  // K+N vs K or K vs K+N
  if (wp.length === 2 && bp.length === 1 && wp.some((p) => p.type === 'knight')) return true;
  if (wp.length === 1 && bp.length === 2 && bp.some((p) => p.type === 'knight')) return true;

  // K+B vs K+B — same-colored bishops
  if (wp.length === 2 && bp.length === 2) {
    const wb = wp.find((p) => p.type === 'bishop');
    const bb = bp.find((p) => p.type === 'bishop');
    if (wb && bb) {
      // Bishop color = (file + rank) % 2; same parity = same-colored squares
      if ((wb.file + wb.rank) % 2 === (bb.file + bb.rank) % 2) return true;
    }
  }

  return false;
}

// ═══════════════════════════════════════════════════════════
//  ALGEBRAIC NOTATION
// ═══════════════════════════════════════════════════════════

const FILES = 'abcdefgh';
const RANKS = '12345678';
const PIECE_LETTERS = { king: 'K', queen: 'Q', rook: 'R', bishop: 'B', knight: 'N', pawn: '' };

// Find all pieces of the given type and color (excluding source) that can move to the target square
function findAmbiguousPieces(
  board,
  type,
  color,
  fromFile,
  fromRank,
  toFile,
  toRank,
  castlingRights,
  enPassantTarget
) {
  const ambiguous = [];
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const piece = board[r][f];
      // Skip: empty square, wrong color, wrong type, or the source piece
      if (piece === 0 || pieceColor(piece) !== color || pieceType(piece) !== type) continue;
      if (f === fromFile && r === fromRank) continue;
      const moves = getValidMoves(board, f, r, castlingRights, enPassantTarget);
      if (moves.some((m) => m.file === toFile && m.rank === toRank)) {
        ambiguous.push({ file: f, rank: r });
      }
    }
  }
  return ambiguous;
}

function buildNotation(
  board,
  type,
  fromFile,
  fromRank,
  toFile,
  toRank,
  captured,
  enPassant,
  castled,
  castlingRights,
  enPassantTarget
) {
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
    const ambiguous = findAmbiguousPieces(
      board,
      type,
      color,
      fromFile,
      fromRank,
      toFile,
      toRank,
      castlingRights || { wK: true, wQ: true, bK: true, bQ: true },
      enPassantTarget
    );

    if (ambiguous.length > 0) {
      // Check if file disambiguation is sufficient
      const sameFile = ambiguous.some((p) => p.file === fromFile);
      const sameRank = ambiguous.some((p) => p.rank === fromRank);

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
    this.castlingRights = { wK: true, wQ: true, bK: true, bQ: true };
    this.enPassantTarget = null;
    this.promotingPiece = null; // {file, rank, color} awaiting promotion
    this.players = new Map(); // ws -> 'white' | 'black'
    this.spectators = new Set();
    this.moveHistory = [];
    this.capturedPieces = { white: [], black: [] }; // pieces each side has captured
    this.gameOver = false;
    this.gameResult = null;

    // Position history for threefold repetition, 50-move rule, FEN/PGN export
    this.halfmoveClock = 0;
    this.fullmoveNumber = 1;
    this.positionHistory = []; // [{ zobrist, halfmoveClock, fullmoveNumber, move }]
    this.positionCounts = new Map(); // zobrist (string) → occurrence count

    // Record the starting position
    this._recordPosition(null);
  }

  addPlayer(ws, extraOccupied) {
    const colors = ['white', 'black'];
    const occupied = new Set([...this.players.values()]);
    if (extraOccupied) {
      for (const color of extraOccupied) occupied.add(color);
    }
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
      return color;
    }
    this.spectators.delete(ws);
    return null;
  }

  // ── Position history ──────────────────────────────────

  _computeZobrist() {
    if (!ZOBRIST) return 0n; // browser — never called client-side
    return ZOBRIST.compute(this.board, this.turn, this.castlingRights, this.enPassantTarget);
  }

  _recordPosition(moveData) {
    const zobrist = this._computeZobrist();
    const key = zobrist.toString(); // BigInt → string for Map keys
    this.positionHistory.push({
      zobrist: key,
      halfmoveClock: this.halfmoveClock,
      fullmoveNumber: this.fullmoveNumber,
      move: moveData,
    });
    this.positionCounts.set(key, (this.positionCounts.get(key) || 0) + 1);

    // Prune oldest entries when history exceeds the cap
    while (this.positionHistory.length > MAX_POSITION_HISTORY) {
      const removed = this.positionHistory.shift();
      const count = this.positionCounts.get(removed.zobrist);
      if (count <= 1) {
        this.positionCounts.delete(removed.zobrist);
      } else {
        this.positionCounts.set(removed.zobrist, count - 1);
      }
    }
  }

  isThreefoldRepetition() {
    return [...this.positionCounts.values()].some((c) => c >= 3);
  }

  isFiftyMoveRule() {
    return this.halfmoveClock >= 100;
  }

  // Get the max repetition count for the current position (for UI display)
  getCurrentRepetitionCount() {
    if (this.positionHistory.length === 0) return 0;
    const last = this.positionHistory[this.positionHistory.length - 1];
    return this.positionCounts.get(last.zobrist) || 0;
  }

  // ── FEN / PGN export ──────────────────────────────────

  currentFen() {
    return toFen(
      this.board,
      this.turn,
      this.castlingRights,
      this.enPassantTarget,
      this.halfmoveClock,
      this.fullmoveNumber
    );
  }

  loadFromFen(fen) {
    const state = fromFen(fen);
    this.board = state.board;
    this.turn = state.turn;
    this.castlingRights = state.castlingRights;
    this.enPassantTarget = state.enPassantTarget;
    this.halfmoveClock = state.halfmoveClock;
    this.fullmoveNumber = state.fullmoveNumber;
    this.promotingPiece = null;
    this.moveHistory = [];
    this.capturedPieces = { white: [], black: [] };
    this.gameOver = false;
    this.gameResult = null;
    this.positionHistory = [];
    this.positionCounts = new Map();
    // Record the loaded position as the first entry
    this._recordPosition(null);
  }

  exportPgn() {
    const result = this.gameResult ? this._pgnResult() : '*';
    let tags = '';
    tags += `[Event "3D Chess Game"]\n`;
    tags += `[Site "mpchess"]\n`;
    tags += `[Date "${new Date().toISOString().slice(0, 10)}"]\n`;
    tags += `[Result "${result}"]\n\n`;

    // Build move list
    let moves = '';
    for (let i = 0; i < this.moveHistory.length; i++) {
      if (i % 2 === 0) moves += `${Math.floor(i / 2) + 1}. `;
      let notation = this.moveHistory[i];
      // Strip the =P placeholder from the last move if promotion is pending
      if (this.promotingPiece && i === this.moveHistory.length - 1 && notation.endsWith('=P')) {
        notation = notation.slice(0, -2);
      }
      moves += notation + ' ';
    }
    moves += result;

    return tags + moves;
  }

  _pgnResult() {
    if (!this.gameResult) return '*';
    if (
      this.gameResult.includes('Draw') ||
      this.gameResult.includes('stalemate') ||
      this.gameResult.includes('insufficient')
    )
      return '1/2-1/2';
    if (
      this.gameResult.includes('White wins') ||
      this.gameResult.includes('white wins') ||
      this.gameResult.includes('Black conceded')
    )
      return '1-0';
    if (
      this.gameResult.includes('Black wins') ||
      this.gameResult.includes('black wins') ||
      this.gameResult.includes('White conceded')
    )
      return '0-1';
    return '*';
  }

  // Append check (+) or checkmate (#) suffix to the last move in history
  _appendMoveSuffix() {
    if (this.gameOver && this.gameResult.includes('Checkmate')) {
      this.moveHistory[this.moveHistory.length - 1] += '#';
    } else if (!this.gameOver && isInCheck(this.board, this.turn)) {
      this.moveHistory[this.moveHistory.length - 1] += '+';
    }
  }

  // Revoke both king-side and queen-side castling rights for a color
  _revokeKingCastlingRights(color) {
    if (color === 'white') {
      this.castlingRights.wK = false;
      this.castlingRights.wQ = false;
    } else {
      this.castlingRights.bK = false;
      this.castlingRights.bQ = false;
    }
  }

  // Revoke castling right for a specific rook at (file, rank)
  _revokeRookCastlingRights(color, file, rank) {
    if (color === 'white') {
      if (rank === 0 && file === 0) this.castlingRights.wQ = false;
      if (rank === 0 && file === 7) this.castlingRights.wK = false;
    } else {
      if (rank === 7 && file === 0) this.castlingRights.bQ = false;
      if (rank === 7 && file === 7) this.castlingRights.bK = false;
    }
  }

  tryMove(ws, fromFile, fromRank, toFile, toRank) {
    // Validate coordinates are integers in [0, 7]
    for (const v of [fromFile, fromRank, toFile, toRank]) {
      if (!Number.isInteger(v) || v < 0 || v > 7) {
        return { ok: false, reason: 'Invalid move' };
      }
    }

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

    const moves = getValidMoves(
      this.board,
      fromFile,
      fromRank,
      this.castlingRights,
      this.enPassantTarget
    );
    const move = moves.find((m) => m.file === toFile && m.rank === toRank);
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
    const notation = buildNotation(
      this.board,
      type,
      fromFile,
      fromRank,
      toFile,
      toRank,
      !!captured,
      isEnPassant,
      castled,
      this.castlingRights,
      this.enPassantTarget
    );

    // En passant capture
    if (isEnPassant) {
      const capturedRank = color === 'white' ? toRank - 1 : toRank + 1;
      this.board[capturedRank][toFile] = 0;
    }

    this.board[toRank][toFile] = piece;
    this.board[fromRank][fromFile] = 0;

    // Handle promotion: place pawn at destination, defer piece swap to completePromotion
    if (isPromotion) {
      this.promotingPiece = {
        file: toFile,
        rank: toRank,
        color,
        fromFile,
        fromRank,
      };
      // Record the pawn move; promotion suffix added later
      const promoNotation = notation + '=P'; // P for pawn (will be replaced with actual piece in completePromotion)
      this.moveHistory.push(promoNotation);
      // Pawn move resets half-move clock (position recorded in completePromotion)
      this.halfmoveClock = 0;
      // Update en passant target (promotion can't set it, but keep the logic consistent)
      this.enPassantTarget = null;
      // Captured rook on home square — revoke castling rights
      if (captured && pieceType(captured) === 'rook') {
        const capColor = pieceColor(captured);
        this._revokeRookCastlingRights(capColor, toFile, toRank);
      }
      return {
        ok: true,
        promotion: true,
        fromFile,
        fromRank,
        toFile,
        toRank,
        captured: !!captured,
        enPassant: isEnPassant,
        castled,
      };
    }

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
      this._revokeKingCastlingRights(color);
    }

    // Any king move revokes castling rights (not just castling itself)
    if (type === 'king') {
      this._revokeKingCastlingRights(color);
    }

    // Rook moved — revoke its castling right
    if (type === 'rook') {
      this._revokeRookCastlingRights(color, fromFile, fromRank);
    }

    // Captured rook on home square — revoke opponent's castling right
    if (captured && pieceType(captured) === 'rook') {
      const capColor = pieceColor(captured);
      this._revokeRookCastlingRights(capColor, toFile, toRank);
    }

    // Update half-move clock: reset on pawn move or capture, increment otherwise
    const isCapture = captured !== 0 || isEnPassant;
    if (type === 'pawn' || isCapture) {
      this.halfmoveClock = 0;
    } else {
      this.halfmoveClock++;
    }

    // Switch turn
    this.turn = this.turn === 'white' ? 'black' : 'white';

    // Increment full-move number after Black's move
    if (this.turn === 'white') {
      this.fullmoveNumber++;
    }

    // Record move with proper algebraic notation
    this.moveHistory.push(notation);

    // Record position in history (for threefold, 50-move, FEN export)
    this._recordPosition({ fromFile, fromRank, toFile, toRank, notation });

    // Check game end and append check/mate symbol
    this.checkGameEnd();
    this._appendMoveSuffix();

    return {
      ok: true,
      fromFile,
      fromRank,
      toFile,
      toRank,
      captured: !!captured,
      enPassant: isEnPassant,
      castled,
      notation,
    };
  }

  completePromotion(ws, pieceType) {
    if (!this.promotingPiece || this.players.get(ws) !== this.promotingPiece.color) return false;
    if (this.gameOver) return false;
    const { file, rank, color, fromFile, fromRank } = this.promotingPiece;
    const pieceMap = { queen: 5, rook: 4, bishop: 3, knight: 2 };
    if (!(pieceType in pieceMap)) return false;
    const val = color === 'white' ? pieceMap[pieceType] : pieceMap[pieceType] + 6;
    // Swap the pawn (already at destination from tryMove) for the promoted piece
    this.board[rank][file] = val;

    this.promotingPiece = null;

    // Switch turn
    this.turn = this.turn === 'white' ? 'black' : 'white';

    // Increment full-move number after Black's move
    if (this.turn === 'white') {
      this.fullmoveNumber++;
    }

    // Replace the =P placeholder with the actual promotion piece
    const promoNotation = `=${pieceType[0].toUpperCase()}`;
    if (this.moveHistory.length > 0) {
      const last = this.moveHistory.length - 1;
      this.moveHistory[last] = this.moveHistory[last].slice(0, -2) + promoNotation;
    }

    // Record position in history (halfmoveClock was reset in tryMove for pawn move)
    this._recordPosition({
      fromFile,
      fromRank,
      toFile: file,
      toRank: rank,
      notation: this.moveHistory[this.moveHistory.length - 1],
    });

    this.checkGameEnd();
    this._appendMoveSuffix();
    return true;
  }

  checkGameEnd() {
    if (this.gameOver) return;

    // Threefold repetition — draw
    if (this.isThreefoldRepetition()) {
      this.gameOver = true;
      this.gameResult = 'Draw — threefold repetition.';
      return;
    }

    // Fifty-move rule — draw
    if (this.isFiftyMoveRule()) {
      this.gameOver = true;
      this.gameResult = 'Draw — 50-move rule.';
      return;
    }

    // Insufficient material — draw
    if (isInsufficientMaterial(this.board)) {
      this.gameOver = true;
      this.gameResult = 'Draw — insufficient material.';
      return;
    }

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
      board: cloneBoard(this.board),
      turn: this.turn,
      castlingRights: { ...this.castlingRights },
      enPassantTarget: this.enPassantTarget,
      promotingPiece: this.promotingPiece
        ? {
            file: this.promotingPiece.file,
            rank: this.promotingPiece.rank,
            color: this.promotingPiece.color,
            fromFile: this.promotingPiece.fromFile,
            fromRank: this.promotingPiece.fromRank,
          }
        : null,
      gameOver: this.gameOver,
      gameResult: this.gameResult,
      moveHistory: [...this.moveHistory],
      capturedPieces: {
        white: [...this.capturedPieces.white],
        black: [...this.capturedPieces.black],
      },
      playerCount: this.players.size,
      spectatorCount: this.spectators.size,
      halfmoveClock: this.halfmoveClock,
      threefoldCount: this.getCurrentRepetitionCount(),
      fen: this.currentFen(),
    };
  }

  reset() {
    this.board = startingBoard();
    this.turn = 'white';
    this.castlingRights = { wK: true, wQ: true, bK: true, bQ: true };
    this.enPassantTarget = null;
    this.promotingPiece = null;
    this.moveHistory = [];
    this.capturedPieces = { white: [], black: [] };
    this.gameOver = false;
    this.gameResult = null;
    this.halfmoveClock = 0;
    this.fullmoveNumber = 1;
    this.positionHistory = [];
    this.positionCounts = new Map();
    // Record the starting position
    this._recordPosition(null);
  }
}

// ═══════════════════════════════════════════════════════════
//  ZOBRIST HASHING — position identity for threefold repetition
// ═══════════════════════════════════════════════════════════

class Zobrist {
  constructor() {
    // pieceTable[pieceValue][square] — 12 piece values × 64 squares
    this.pieceTable = Array.from({ length: 13 }, () =>
      Array.from({ length: 64 }, () => this._rand())
    );
    // turnTable[color] — side to move
    this.turnTable = { white: this._rand(), black: this._rand() };
    // castlingTable[right] — one entry per castling right
    this.castlingTable = {
      wK: this._rand(),
      wQ: this._rand(),
      bK: this._rand(),
      bQ: this._rand(),
    };
    // epTable[square] — en passant target (64 squares)
    this.epTable = Array.from({ length: 64 }, () => this._rand());
  }

  _rand() {
    // Cryptographic-quality 64-bit random BigInt
    const buf = crypto.randomBytes(8);
    return buf.readBigUInt64LE(0);
  }

  // Compute Zobrist hash for a given board state
  compute(board, turn, castlingRights, enPassantTarget) {
    let hash = 0n;

    // XOR in every piece on the board
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const p = board[r][f];
        if (p !== 0) {
          const sq = r * 8 + f;
          hash ^= this.pieceTable[p][sq];
        }
      }
    }

    // XOR in side to move
    hash ^= this.turnTable[turn];

    // XOR in castling rights (only the ones that are true)
    for (const right of ['wK', 'wQ', 'bK', 'bQ']) {
      if (castlingRights[right]) {
        hash ^= this.castlingTable[right];
      }
    }

    // XOR in en passant target square
    if (enPassantTarget) {
      const sq = enPassantTarget.rank * 8 + enPassantTarget.file;
      hash ^= this.epTable[sq];
    }

    return hash;
  }
}

// Single static Zobrist table — shared across all Game instances
// In browser (chess.mjs), crypto is undefined → ZOBRIST is null (never used by client)
const ZOBRIST = crypto ? new Zobrist() : null;

// ═══════════════════════════════════════════════════════════
//  FEN — Forsyth-Edwards Notation
// ═══════════════════════════════════════════════════════════

const FEN_PIECE_CHARS = {
  1: 'P',
  2: 'N',
  3: 'B',
  4: 'R',
  5: 'Q',
  6: 'K',
  7: 'p',
  8: 'n',
  9: 'b',
  10: 'r',
  11: 'q',
  12: 'k',
};

const FEN_CHAR_TO_PIECE = {
  P: W_PAWN,
  N: W_KNIGHT,
  B: W_BISHOP,
  R: W_ROOK,
  Q: W_QUEEN,
  K: W_KING,
  p: B_PAWN,
  n: B_KNIGHT,
  b: B_BISHOP,
  r: B_ROOK,
  q: B_QUEEN,
  k: B_KING,
};

function toFen(board, turn, castlingRights, enPassantTarget, halfmoveClock, fullmoveNumber) {
  // Piece placement: rank 8 first, empty squares counted
  let placement = '';
  for (let r = 7; r >= 0; r--) {
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      if (board[r][f] === 0) {
        empty++;
      } else {
        if (empty > 0) {
          placement += empty;
          empty = 0;
        }
        placement += FEN_PIECE_CHARS[board[r][f]];
      }
    }
    if (empty > 0) placement += empty;
    if (r > 0) placement += '/';
  }

  // Castling availability
  let castling = '';
  if (castlingRights.wK) castling += 'K';
  if (castlingRights.wQ) castling += 'Q';
  if (castlingRights.bK) castling += 'k';
  if (castlingRights.bQ) castling += 'q';
  if (castling === '') castling = '-';

  // En passant target square
  let ep = '-';
  if (enPassantTarget) {
    ep = FILES[enPassantTarget.file] + RANKS[enPassantTarget.rank];
  }

  // Turn: FEN uses 'w'/'b', not 'white'/'black'
  const turnChar = turn === 'white' ? 'w' : 'b';

  return `${placement} ${turnChar} ${castling} ${ep} ${halfmoveClock} ${fullmoveNumber}`;
}

function fromFen(fen) {
  const parts = fen.trim().split(/\s+/);
  if (parts.length !== 6) throw new Error('Invalid FEN: must have exactly 6 parts');

  const [placementStr, turn, castlingStr, epStr, hmStr, fmStr] = parts;

  // Parse piece placement (rank 8 first)
  const board = Array.from({ length: 8 }, () => Array(8).fill(0));
  const ranks = placementStr.split('/');
  if (ranks.length !== 8) throw new Error('Invalid FEN: must have 8 ranks');

  for (let ri = 0; ri < 8; ri++) {
    let file = 0;
    for (const ch of ranks[ri]) {
      if (ch >= '1' && ch <= '8') {
        file += parseInt(ch, 10);
      } else if (ch in FEN_CHAR_TO_PIECE) {
        if (file >= 8) throw new Error('Invalid FEN: rank too long');
        board[7 - ri][file] = FEN_CHAR_TO_PIECE[ch];
        file++;
      } else {
        throw new Error(`Invalid FEN character: ${ch}`);
      }
    }
    if (file !== 8) throw new Error('Invalid FEN: rank must have 8 squares');
  }

  // Validate turn
  if (turn !== 'w' && turn !== 'b') throw new Error('Invalid FEN: turn must be w or b');

  // Parse castling rights — must be exactly '-' or a non-empty unique subset of KQkq
  const castlingRights = { wK: false, wQ: false, bK: false, bQ: false };
  if (castlingStr === '-') {
    // No castling — valid
  } else {
    const castlingSeen = new Set();
    for (const ch of castlingStr) {
      if (ch === '-') throw new Error('Invalid FEN: castling field cannot mix "-" with flags');
      if (castlingSeen.has(ch)) throw new Error(`Invalid FEN: duplicate castling flag '${ch}'`);
      castlingSeen.add(ch);
      if (ch === 'K') castlingRights.wK = true;
      else if (ch === 'Q') castlingRights.wQ = true;
      else if (ch === 'k') castlingRights.bK = true;
      else if (ch === 'q') castlingRights.bQ = true;
      else throw new Error(`Invalid castling character: ${ch}`);
    }
    if (castlingSeen.size === 0)
      throw new Error('Invalid FEN: castling field must be "-" or non-empty');
  }

  // Parse en passant target — must be '-' or a valid square on rank 3 or 6
  let enPassantTarget = null;
  if (epStr !== '-') {
    if (epStr.length !== 2) throw new Error('Invalid FEN: en passant must be 2 chars');
    const ef = epStr.charCodeAt(0) - 'a'.charCodeAt(0);
    const er = epStr.charCodeAt(1) - '1'.charCodeAt(0);
    if (ef < 0 || ef > 7 || er < 0 || er > 7)
      throw new Error('Invalid FEN: en passant out of range');
    if (er !== 2 && er !== 5) throw new Error('Invalid FEN: en passant rank must be 3 or 6');
    enPassantTarget = { file: ef, rank: er };
  }

  // Validate halfmove clock — must be a non-negative integer
  if (!/^\d+$/.test(hmStr))
    throw new Error('Invalid FEN: halfmove clock must be a non-negative integer');
  const halfmoveClock = parseInt(hmStr, 10);

  // Validate fullmove number — must be a positive integer
  if (!/^\d+$/.test(fmStr))
    throw new Error('Invalid FEN: fullmove number must be a positive integer');
  const fullmoveNumber = parseInt(fmStr, 10);
  if (fullmoveNumber < 1) throw new Error('Invalid FEN: fullmove number must be >= 1');

  // Validate exactly one white king and one black king
  let whiteKingCount = 0;
  let blackKingCount = 0;
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      if (board[r][f] === W_KING) whiteKingCount++;
      if (board[r][f] === B_KING) blackKingCount++;
    }
  }
  if (whiteKingCount !== 1) throw new Error('Invalid FEN: must have exactly one white king');
  if (blackKingCount !== 1) throw new Error('Invalid FEN: must have exactly one black king');

  return {
    board,
    turn: turn === 'w' ? 'white' : 'black',
    castlingRights,
    enPassantTarget,
    halfmoveClock,
    fullmoveNumber,
  };
}

// ═══════════════════════════════════════════════════════════
//  FEN VALIDATION — engine compatibility warnings
//  These checks identify positions that are syntactically valid FEN
//  but could never arise from legal chess play. They are warnings,
//  not errors — the position is still importable for puzzles/challenges.
//  The warnings are surfaced to the user so they know the position
//  may confuse a chess engine (Stockfish).
// ═══════════════════════════════════════════════════════════

function validateFenForEngine(board, turn, castlingRights, enPassantTarget) {
  const warnings = [];
  const enemy = turn === 'white' ? 'black' : 'white';

  // 1. Kings adjacent — impossible in legal chess
  const wk = findKing(board, 'white');
  const bk = findKing(board, 'black');
  if (wk && bk) {
    if (Math.abs(wk.file - bk.file) <= 1 && Math.abs(wk.rank - bk.rank) <= 1) {
      warnings.push('Kings are adjacent');
    }
  }

  // 2. Side not to move is in check — impossible in legal chess
  if (isInCheck(board, enemy)) {
    warnings.push(`${enemy} is in check but it is ${turn}'s turn`);
  }

  // 3. Both kings in check — impossible in legal chess
  if (isInCheck(board, 'white') && isInCheck(board, 'black')) {
    warnings.push('Both kings are in check');
  }

  // 4. Pawns on rank 1 or 8 — impossible in legal chess
  for (let f = 0; f < 8; f++) {
    if (board[0][f] === W_PAWN || board[0][f] === B_PAWN) {
      warnings.push('Pawn on rank 1');
      break;
    }
  }
  for (let f = 0; f < 8; f++) {
    if (board[7][f] === W_PAWN || board[7][f] === B_PAWN) {
      warnings.push('Pawn on rank 8');
      break;
    }
  }

  // 5. Impossible castling rights
  // White king-side: king must be on e1, rook on h1
  if (castlingRights.wK) {
    if (board[0][4] !== W_KING || board[0][7] !== W_ROOK) {
      warnings.push('White king-side castling right but king or rook not on home square');
    }
  }
  // White queen-side: king must be on e1, rook on a1
  if (castlingRights.wQ) {
    if (board[0][4] !== W_KING || board[0][0] !== W_ROOK) {
      warnings.push('White queen-side castling right but king or rook not on home square');
    }
  }
  // Black king-side: king must be on e8, rook on h8
  if (castlingRights.bK) {
    if (board[7][4] !== B_KING || board[7][7] !== B_ROOK) {
      warnings.push('Black king-side castling right but king or rook not on home square');
    }
  }
  // Black queen-side: king must be on e8, rook on a8
  if (castlingRights.bQ) {
    if (board[7][4] !== B_KING || board[7][0] !== B_ROOK) {
      warnings.push('Black queen-side castling right but king or rook not on home square');
    }
  }

  // 6. Impossible en passant — verify all conditions
  if (enPassantTarget) {
    const epFile = enPassantTarget.file;
    const epRank = enPassantTarget.rank;
    if (epRank === 2) {
      // EP target on rank 3 (index 2): white just pushed two squares (rank 2→4).
      //   Side to move must be black (the capturing side).
      //   White pawn must be on the target file at rank 4 (index 3) — the pawn that pushed.
      //   Black pawn must be on an adjacent file at rank 4 (index 3) — the capturing pawn.
      if (turn !== 'black') {
        warnings.push("En passant target on rank 3 but it is not black's turn to capture");
      }
      if (board[3][epFile] !== W_PAWN) {
        warnings.push('En passant target on rank 3 but no white pawn on the pushed square');
      }
      let hasCapturer = false;
      for (const df of [-1, 1]) {
        const nf = epFile + df;
        if (nf >= 0 && nf < 8 && board[3][nf] === B_PAWN) {
          hasCapturer = true;
          break;
        }
      }
      if (!hasCapturer) {
        warnings.push('En passant target on rank 3 but no black pawn in position to capture');
      }
    } else if (epRank === 5) {
      // EP target on rank 6 (index 5): black just pushed two squares (rank 7→5).
      //   Side to move must be white (the capturing side).
      //   Black pawn must be on the target file at rank 5 (index 4) — the pawn that pushed.
      //   White pawn must be on an adjacent file at rank 5 (index 4) — the capturing pawn.
      if (turn !== 'white') {
        warnings.push("En passant target on rank 6 but it is not white's turn to capture");
      }
      if (board[4][epFile] !== B_PAWN) {
        warnings.push('En passant target on rank 6 but no black pawn on the pushed square');
      }
      let hasCapturer = false;
      for (const df of [-1, 1]) {
        const nf = epFile + df;
        if (nf >= 0 && nf < 8 && board[4][nf] === W_PAWN) {
          hasCapturer = true;
          break;
        }
      }
      if (!hasCapturer) {
        warnings.push('En passant target on rank 6 but no white pawn in position to capture');
      }
    }
  }

  // 7. No legal moves for side to move — dead position
  if (!hasAnyMoves(board, turn, castlingRights, enPassantTarget)) {
    warnings.push('No legal moves for side to move');
  }

  return warnings;
}

// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
//  EXPORTS (ES Module — generated by build_chess_mjs.js)
//  The export list below is derived from `import { … } from
//  './chess.mjs'` statements in client/*.js.  It is NOT a copy
//  of module.exports — only symbols the browser actually needs
//  are exposed.  See build_chess_mjs.js header for rationale.
// ═══════════════════════════════════════════════════════════

export { findKing, getValidMoves, isInCheck, pieceColor, pieceType };
