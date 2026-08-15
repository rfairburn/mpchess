// ═══════════════════════════════════════════════════════════
//  WEBSOCKET + GAME STATE + RECONNECTION
// ═══════════════════════════════════════════════════════════

// Per-color token keys so multiple tabs (white + black) don't collide
export function tokenKey(color) {
  return `mpchess_session_${color}`;
}

let ws = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
let reconnecting = false;
let pendingToken = null; // token we're trying to reconnect with
let reconnectColor = null; // color we're trying to reconnect to (auto-reconnect only)

const MAX_RECONNECT_ATTEMPTS = 8; // 1+2+4+8+16+32+64+128 = 255s max

export let myRole = null; // null = not yet joined
export let serverBoard = null;
export let serverTurn = 'white';
export let serverPromotingPiece = null;
export let serverGameOver = false;
export let serverGameResult = null;
export let moveHistory = [];
export let castlingRights = { wK: true, wQ: true, bK: true, bQ: true };
export let enPassantTarget = null;
export let disconnectedPlayersInfo = [];
export let seatStatus = { white: { status: 'unknown' }, black: { status: 'unknown' } };
export let validatedTokens = {}; // { white: true/false, black: true/false } — server-confirmed
export let computerPlayer = null; // { color: 'white'|'black', skill: string } | null
export let halfmoveClock = 0;
export let threefoldCount = 0;
export let canClaimDraw = false;
export let currentFen = '';
export let serverEvaluation = null; // centipawns (positive = white) | null
export let debugEnabled = false; // set by server in state message
export let previousMove = null; // { fromFile, fromRank, toFile, toRank } | null

// Event emitter — replaces 25 callback arrays
import { EventEmitter } from './event_emitter.js';
const emitter = new EventEmitter();

/** @typedef {(msg: object) => void} NetworkCallback */

// Backward-compatible on* registration functions
/**
 * Register a callback for state update messages.
 * @param {NetworkCallback} fn
 */
export function onStateUpdate(fn) {
  emitter.on('stateUpdate', fn);
}
export function onMove(fn) {
  emitter.on('move', fn);
}
export function onRestart(fn) {
  emitter.on('restart', fn);
}
export function onPromotion(fn) {
  emitter.on('promotion', fn);
}
export function onError(fn) {
  emitter.on('error', fn);
}
export function onInfo(fn) {
  emitter.on('info', fn);
}
export function onReconnecting(fn) {
  emitter.on('reconnecting', fn);
}
export function onReconnected(fn) {
  emitter.on('reconnected', fn);
}
export function onPlayerDisconnected(fn) {
  emitter.on('playerDisconnected', fn);
}
export function onPlayerDropped(fn) {
  emitter.on('playerDropped', fn);
}
export function onGameAvailable(fn) {
  emitter.on('gameAvailable', fn);
}
export function onReconnectFailed(fn) {
  emitter.on('reconnectFailed', fn);
}
export function onConnected(fn) {
  emitter.on('connected', fn);
}
export function onConnectionError(fn) {
  emitter.on('connectionError', fn);
}
export function onComputerActivated(fn) {
  emitter.on('computerActivated', fn);
}
export function onComputerThinking(fn) {
  emitter.on('computerThinking', fn);
}
export function onComputerSkillChanged(fn) {
  emitter.on('computerSkillChanged', fn);
}
export function onComputerUnavailable(fn) {
  emitter.on('computerUnavailable', fn);
}
export function onDrawOffer(fn) {
  emitter.on('drawOffer', fn);
}
export function onDrawResult(fn) {
  emitter.on('drawResult', fn);
}
export function onDrawOfferCancelled(fn) {
  emitter.on('drawOfferCancelled', fn);
}
export function onLeft(fn) {
  emitter.on('left', fn);
}
export function onPlayerLeft(fn) {
  emitter.on('playerLeft', fn);
}
export function onFenImportWarning(fn) {
  emitter.on('fenImportWarning', fn);
}
export function onEvaluation(fn) {
  emitter.on('evaluation', fn);
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function getConnectionUrl() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const prefix = typeof window !== 'undefined' ? window.__mpchess_prefix : '';
  return `${protocol}//${location.host}${prefix || ''}`;
}

function connect() {
  clearReconnectTimer();
  try {
    ws = new WebSocket(getConnectionUrl());
  } catch {
    return;
  }
  // Expose WebSocket for test control
  if (typeof window !== 'undefined') window.__mpchess_ws = ws;

  ws.onopen = () => {
    // Only auto-reconnect if we were actively playing and got disconnected
    // Fresh page loads / new windows NEVER auto-pick — join overlay always shows
    if (reconnecting && reconnectColor) {
      if (reconnectColor === 'spectator') {
        // Spectator rejoin — no token needed, just join as spectator
        ws.send(JSON.stringify({ type: 'join', color: 'spectator' }));
      } else {
        const token = localStorage.getItem(tokenKey(reconnectColor));
        if (token) {
          pendingToken = token;
          ws.send(JSON.stringify({ type: 'reconnect', token }));
        } else {
          // No token for our color — fall through to join overlay
          reconnecting = false;
          reconnectColor = null;
        }
      }
    }
    // Validate any stored tokens so the UI knows whether to show "Reconnect"
    for (const color of ['white', 'black']) {
      const token = localStorage.getItem(tokenKey(color));
      if (token) {
        ws.send(JSON.stringify({ type: 'validateToken', token, color }));
      }
    }
    // Fire onConnected so UI can show join overlay immediately
    emitter.emit('connected', {});
    // Otherwise: wait for user to click a button on the join overlay
  };

  ws.onerror = (_event) => {
    // Connection failed before it was established (e.g., origin rejected, server down)
    // Only fire this for initial connections, not during reconnection (reconnect has its own flow)
    if (!reconnecting && myRole === null) {
      emitter.emit('connectionError', { event: _event });
    }
  };

  ws.onclose = (_event) => {
    ws = null;

    // Don't auto-reconnect if we're intentionally closing (e.g., page unload)
    if (window._mpchessClosing) return;

    // Reconnect if we had any role (player or spectator)
    if (myRole) {
      startReconnection();
    }
  };

  ws.onmessage = handleServerMessage;
}

export function handleServerMessage(event) {
  let msg;
  try {
    msg = JSON.parse(event.data);
  } catch {
    return;
  }
  switch (msg.type) {
    case 'debug': {
      if (debugEnabled) {
        if (typeof console !== 'undefined' && console.debug) {
          console.debug('[DEBUG]', msg);
        } else {
          console.log('[DEBUG]', msg);
        }
      }
      break;
    }
    case 'state': {
      myRole = msg.role;
      serverBoard = msg.board;
      serverTurn = msg.turn;
      serverPromotingPiece = msg.promotingPiece;
      serverGameOver = msg.gameOver;
      serverGameResult = msg.gameResult;
      moveHistory = msg.moveHistory || [];
      castlingRights = msg.castlingRights;
      enPassantTarget = msg.enPassantTarget;
      disconnectedPlayersInfo = msg.disconnectedPlayers || [];
      if (msg.seats) seatStatus = msg.seats;
      computerPlayer = msg.computerPlayer || null;
      halfmoveClock = msg.halfmoveClock ?? 0;
      threefoldCount = msg.threefoldCount ?? 0;
      canClaimDraw = msg.canClaimDraw ?? false;
      currentFen = msg.fen || '';
      serverEvaluation = msg.evaluation ?? null;
      previousMove = msg.lastMove || null;
      if (typeof msg.debug === 'boolean') debugEnabled = msg.debug;
      emitter.emit('stateUpdate', msg);
      break;
    }
    case 'move': {
      emitter.emit('move', msg);
      break;
    }
    case 'promotion': {
      // Server confirmed the promoted piece type. Update serverBoard
      // so the pawn at the destination is replaced with the promoted piece.
      const pieceMap = { queen: 5, rook: 4, bishop: 3, knight: 2 };
      const base = pieceMap[msg.pieceType];
      if (base !== undefined && serverBoard) {
        // Prefer explicit position from the message (computer promotions),
        // fall back to serverPromotingPiece (human promotions where the
        // client initiated the move).
        const file = msg.file != null ? msg.file : serverPromotingPiece?.file;
        const rank = msg.rank != null ? msg.rank : serverPromotingPiece?.rank;
        // Use explicit color from server if provided; fall back to
        // serverPromotingPiece (human) or infer from board (legacy).
        const color = msg.color || serverPromotingPiece?.color;
        if (file != null && rank != null) {
          if (color) {
            const val = color === 'white' ? base : base + 6;
            serverBoard[rank][file] = val;
          } else {
            // Infer color from the existing piece on the board (the pawn)
            const existing = serverBoard[rank][file];
            const existingColor = existing >= 7 ? 'black' : 'white';
            const val = existingColor === 'white' ? base : base + 6;
            serverBoard[rank][file] = val;
          }
        }
      }
      emitter.emit('promotion', msg);
      break;
    }
    case 'error': {
      emitter.emit('error', msg);
      break;
    }
    case 'restart': {
      moveHistory = [];
      previousMove = null;
      emitter.emit('restart', msg);
      break;
    }
    case 'joined': {
      if (msg.color === 'white' || msg.color === 'black') {
        localStorage.setItem(tokenKey(msg.color), msg.token);
      }
      // Spectator: leave session tokens untouched
      if (!pendingToken) pendingToken = null;
      reconnectAttempts = 0;
      reconnecting = false;
      emitter.emit('reconnected', msg);
      break;
    }
    case 'reconnected': {
      if (msg.color === 'white' || msg.color === 'black') {
        const existing = localStorage.getItem(tokenKey(msg.color));
        if (existing !== pendingToken) {
          localStorage.setItem(tokenKey(msg.color), pendingToken);
        }
      }
      pendingToken = null;
      reconnectAttempts = 0;
      reconnecting = false;
      emitter.emit('reconnected', msg);
      break;
    }
    case 'reconnectFailed': {
      // Remove the stale token we tried to reconnect with
      if (pendingToken) {
        for (const color of ['white', 'black']) {
          if (localStorage.getItem(tokenKey(color)) === pendingToken) {
            localStorage.removeItem(tokenKey(color));
            validatedTokens[color] = false;
          }
        }
      }
      // Clear stale role state so the UI and reconnect loop don't reason from an old role
      myRole = null;
      reconnectColor = null;
      pendingToken = null;
      reconnectAttempts = 0;
      reconnecting = false;
      emitter.emit('reconnectFailed', msg);
      break;
    }
    case 'playerDisconnected': {
      emitter.emit('playerDisconnected', msg);
      break;
    }
    case 'playerDropped': {
      emitter.emit('playerDropped', msg);
      break;
    }
    case 'gameAvailable': {
      emitter.emit('gameAvailable', msg);
      break;
    }
    case 'tokenValid': {
      validatedTokens[msg.color] = msg.valid;
      emitter.emit('stateUpdate', { seats: seatStatus });
      break;
    }
    case 'fenExport': {
      copyOrDownload(msg.fen, 'position.fen', 'text/plain', 'ui.fen_copied', 'ui.fen_downloaded');
      break;
    }
    case 'pgnExport': {
      copyOrDownload(msg.pgn, 'game.pgn', 'text/plain', 'ui.pgn_copied', 'ui.pgn_downloaded');
      break;
    }
    case 'computerActivated': {
      emitter.emit('computerActivated', msg);
      break;
    }
    case 'computerThinking': {
      emitter.emit('computerThinking', msg);
      break;
    }
    case 'computerSkillChanged': {
      emitter.emit('computerSkillChanged', msg);
      break;
    }
    case 'computerUnavailable': {
      emitter.emit('computerUnavailable', msg);
      break;
    }
    case 'drawOffer': {
      emitter.emit('drawOffer', msg);
      break;
    }
    case 'drawResult': {
      emitter.emit('drawResult', msg);
      break;
    }
    case 'drawOfferCancelled': {
      emitter.emit('drawOfferCancelled', msg);
      break;
    }
    case 'left': {
      myRole = null;
      emitter.emit('left', msg);
      break;
    }
    case 'playerLeft': {
      emitter.emit('playerLeft', msg);
      break;
    }
    case 'fenImportWarning': {
      emitter.emit('fenImportWarning', msg);
      break;
    }
    case 'evaluation': {
      serverEvaluation = msg.score ?? null;
      emitter.emit('evaluation', msg);
      break;
    }
  }
}

function copyOrDownload(text, filename, mimeType, successKey, fallbackKey) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard
      .writeText(text)
      .then(() => emitter.emit('info', { reason: successKey }))
      .catch(() => {
        downloadText(text, filename, mimeType);
        emitter.emit('info', { reason: fallbackKey });
      });
  } else {
    downloadText(text, filename, mimeType);
    emitter.emit('info', { reason: fallbackKey });
  }
}

export function downloadText(text, filename, mimeType) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // Use queueMicrotask (not setTimeout) so the blob URL is revoked
  // immediately after the current task, avoiding the 100ms delay and
  // preventing memory leaks from rapid FEN/PGN exports.
  queueMicrotask(() => URL.revokeObjectURL(url));
}

function startReconnection() {
  if (reconnecting) return; // already in progress
  reconnecting = true;
  reconnectColor = myRole; // remember our color for auto-reconnect
  reconnectAttempts = 0;
  scheduleReconnect();
  emitter.emit('reconnecting', {});
}

function scheduleReconnect() {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    reconnecting = false;
    emitter.emit('reconnecting', { maxAttemptsReached: true });
    return;
  }
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 15000);
  reconnectAttempts++;
  reconnectTimer = setTimeout(() => {
    connect();
  }, delay);
}

/**
 * Send a JSON message to the server if the WebSocket is open.
 * @param {object} msg
 */
function sendToServer(msg) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(msg));
  }
}

/**
 * Send a move request to the server.
 * @param {number} fromFile
 * @param {number} fromRank
 * @param {number} toFile
 * @param {number} toRank
 */
export function sendMove(fromFile, fromRank, toFile, toRank) {
  sendToServer({ type: 'move', fromFile, fromRank, toFile, toRank });
}

/**
 * Send a promotion piece selection.
 * @param {'queen'|'rook'|'bishop'|'knight'} pieceType
 */
export function sendPromotion(pieceType) {
  sendToServer({ type: 'promotion', pieceType });
}

export function sendRestart() {
  sendToServer({ type: 'restart' });
}

export function sendConcede() {
  sendToServer({ type: 'concede' });
}

export function sendDropPlayer(token) {
  sendToServer({ type: 'dropPlayer', token });
}

/**
 * Join a game as the given color (or reconnect with a stored token).
 * @param {'white'|'black'|'spectator'} color
 */
export function sendJoin(color) {
  if (color !== 'white' && color !== 'black' && color !== 'spectator') return;
  if (!ws || ws.readyState !== 1) return;
  // Only attempt reconnect if we have a token AND the server confirmed it's valid
  const token = localStorage.getItem(tokenKey(color));
  if (token && color !== 'spectator' && validatedTokens[color] === true) {
    pendingToken = token;
    sendToServer({ type: 'reconnect', token });
  } else {
    // Fresh join (no token, unvalidated token, or spectator)
    if (token && color !== 'spectator' && validatedTokens[color] === false) {
      // Token was validated as invalid — remove the stale token
      localStorage.removeItem(tokenKey(color));
    }
    sendToServer({ type: 'join', color });
  }
}

export function sendExportFen() {
  sendToServer({ type: 'exportFen' });
}

export function sendExportPgn() {
  sendToServer({ type: 'exportPgn' });
}

/**
 * Import a position from FEN.
 * @param {string} fen
 */
export function sendImportFen(fen) {
  sendToServer({ type: 'importFen', fen });
}

/**
 * Activate the computer player.
 * @param {'white'|'black'} color
 * @param {number} skill — Skill level (0–20)
 */
export function sendActivateComputer(color, skill) {
  sendToServer({ type: 'activateComputer', color, skill });
}

export function sendChangeSkill(skill) {
  sendToServer({ type: 'changeSkill', skill });
}

export function sendOfferDraw() {
  sendToServer({ type: 'offerDraw' });
}

export function sendDrawResponse(accepted) {
  sendToServer({ type: 'drawResponse', accepted });
}

export function sendClaimDraw() {
  sendToServer({ type: 'claimDraw' });
}

export function sendLeave() {
  sendToServer({ type: 'leave' });
}

export function isReconnecting() {
  return reconnecting;
}

export function retryConnection() {
  clearReconnectTimer();
  reconnectAttempts = 0;
  reconnecting = false;
  connect();
}

// Start initial connection
connect();
