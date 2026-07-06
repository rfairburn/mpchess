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
export let currentFen = '';
export let debugEnabled = false; // set by server in state message

// Callbacks registered by other modules
const onStateUpdateCallbacks = [];
const onMoveCallbacks = [];
const onRestartCallbacks = [];
const onPromotionCallbacks = [];
const onErrorCallbacks = [];
const onInfoCallbacks = []; // info/success notifications (green toast)
const onReconnectingCallbacks = [];
const onReconnectedCallbacks = [];
const onPlayerDisconnectedCallbacks = [];
const onPlayerDroppedCallbacks = [];
const onGameAvailableCallbacks = [];
const onReconnectFailedCallbacks = [];
const onConnectedCallbacks = []; // fires on raw WebSocket open (before any messages)
const onConnectionErrorCallbacks = []; // fires when WebSocket connection fails entirely
const onComputerActivatedCallbacks = [];
const onComputerThinkingCallbacks = [];
const onComputerSkillChangedCallbacks = [];
const onComputerUnavailableCallbacks = [];
const onDrawOfferCallbacks = [];
const onDrawResultCallbacks = [];
const onDrawOfferCancelledCallbacks = [];
const onLeftCallbacks = [];
const onPlayerLeftCallbacks = [];
const onFenImportWarningCallbacks = [];

export function onStateUpdate(fn) {
  onStateUpdateCallbacks.push(fn);
}
export function onMove(fn) {
  onMoveCallbacks.push(fn);
}
export function onRestart(fn) {
  onRestartCallbacks.push(fn);
}
export function onPromotion(fn) {
  onPromotionCallbacks.push(fn);
}
export function onError(fn) {
  onErrorCallbacks.push(fn);
}
export function onInfo(fn) {
  onInfoCallbacks.push(fn);
}
export function onReconnecting(fn) {
  onReconnectingCallbacks.push(fn);
}
export function onReconnected(fn) {
  onReconnectedCallbacks.push(fn);
}
export function onPlayerDisconnected(fn) {
  onPlayerDisconnectedCallbacks.push(fn);
}
export function onPlayerDropped(fn) {
  onPlayerDroppedCallbacks.push(fn);
}
export function onGameAvailable(fn) {
  onGameAvailableCallbacks.push(fn);
}
export function onReconnectFailed(fn) {
  onReconnectFailedCallbacks.push(fn);
}
export function onConnected(fn) {
  onConnectedCallbacks.push(fn);
}
export function onConnectionError(fn) {
  onConnectionErrorCallbacks.push(fn);
}
export function onComputerActivated(fn) {
  onComputerActivatedCallbacks.push(fn);
}
export function onComputerThinking(fn) {
  onComputerThinkingCallbacks.push(fn);
}
export function onComputerSkillChanged(fn) {
  onComputerSkillChangedCallbacks.push(fn);
}
export function onComputerUnavailable(fn) {
  onComputerUnavailableCallbacks.push(fn);
}
export function onDrawOffer(fn) {
  onDrawOfferCallbacks.push(fn);
}
export function onDrawResult(fn) {
  onDrawResultCallbacks.push(fn);
}
export function onDrawOfferCancelled(fn) {
  onDrawOfferCancelledCallbacks.push(fn);
}

export function onLeft(fn) {
  onLeftCallbacks.push(fn);
}

export function onPlayerLeft(fn) {
  onPlayerLeftCallbacks.push(fn);
}

export function onFenImportWarning(fn) {
  onFenImportWarningCallbacks.push(fn);
}

function fireCallbacks(arr, data) {
  for (const fn of arr) fn(data);
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
    fireCallbacks(onConnectedCallbacks, {});
    // Otherwise: wait for user to click a button on the join overlay
  };

  ws.onerror = (_event) => {
    // Connection failed before it was established (e.g., origin rejected, server down)
    // Only fire this for initial connections, not during reconnection (reconnect has its own flow)
    if (!reconnecting && myRole === null) {
      fireCallbacks(onConnectionErrorCallbacks, { event: _event });
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

  ws.onmessage = (event) => {
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
        currentFen = msg.fen || '';
        if (typeof msg.debug === 'boolean') debugEnabled = msg.debug;
        fireCallbacks(onStateUpdateCallbacks, msg);
        break;
      }
      case 'move': {
        fireCallbacks(onMoveCallbacks, msg);
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
        fireCallbacks(onPromotionCallbacks, msg);
        break;
      }
      case 'error': {
        fireCallbacks(onErrorCallbacks, msg);
        break;
      }
      case 'restart': {
        moveHistory = [];
        fireCallbacks(onRestartCallbacks, msg);
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
        fireCallbacks(onReconnectedCallbacks, msg);
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
        fireCallbacks(onReconnectedCallbacks, msg);
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
        fireCallbacks(onReconnectFailedCallbacks, msg);
        break;
      }
      case 'playerDisconnected': {
        fireCallbacks(onPlayerDisconnectedCallbacks, msg);
        break;
      }
      case 'playerDropped': {
        fireCallbacks(onPlayerDroppedCallbacks, msg);
        break;
      }
      case 'gameAvailable': {
        fireCallbacks(onGameAvailableCallbacks, msg);
        break;
      }
      case 'tokenValid': {
        validatedTokens[msg.color] = msg.valid;
        fireCallbacks(onStateUpdateCallbacks, { seats: seatStatus });
        break;
      }
      case 'fenExport': {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard
            .writeText(msg.fen)
            .then(() => {
              fireCallbacks(onInfoCallbacks, { reason: 'FEN copied to clipboard' });
            })
            .catch(() => {
              downloadText(msg.fen, 'position.fen', 'text/plain');
              fireCallbacks(onInfoCallbacks, { reason: 'FEN downloaded' });
            });
        } else {
          downloadText(msg.fen, 'position.fen', 'text/plain');
          fireCallbacks(onInfoCallbacks, { reason: 'FEN downloaded' });
        }
        break;
      }
      case 'pgnExport': {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard
            .writeText(msg.pgn)
            .then(() => {
              fireCallbacks(onInfoCallbacks, { reason: 'PGN copied to clipboard' });
            })
            .catch(() => {
              downloadText(msg.pgn, 'game.pgn', 'text/plain');
              fireCallbacks(onInfoCallbacks, { reason: 'PGN downloaded' });
            });
        } else {
          downloadText(msg.pgn, 'game.pgn', 'text/plain');
          fireCallbacks(onInfoCallbacks, { reason: 'PGN downloaded' });
        }
        break;
      }
      case 'computerActivated': {
        fireCallbacks(onComputerActivatedCallbacks, msg);
        break;
      }
      case 'computerThinking': {
        fireCallbacks(onComputerThinkingCallbacks, msg);
        break;
      }
      case 'computerSkillChanged': {
        fireCallbacks(onComputerSkillChangedCallbacks, msg);
        break;
      }
      case 'computerUnavailable': {
        fireCallbacks(onComputerUnavailableCallbacks, msg);
        break;
      }
      case 'drawOffer': {
        fireCallbacks(onDrawOfferCallbacks, msg);
        break;
      }
      case 'drawResult': {
        fireCallbacks(onDrawResultCallbacks, msg);
        break;
      }
      case 'drawOfferCancelled': {
        fireCallbacks(onDrawOfferCancelledCallbacks, msg);
        break;
      }
      case 'left': {
        myRole = null;
        fireCallbacks(onLeftCallbacks, msg);
        break;
      }
      case 'playerLeft': {
        fireCallbacks(onPlayerLeftCallbacks, msg);
        break;
      }
      case 'fenImportWarning': {
        fireCallbacks(onFenImportWarningCallbacks, msg);
        break;
      }
    }
  };
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
  fireCallbacks(onReconnectingCallbacks, {});
}

function scheduleReconnect() {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    reconnecting = false;
    fireCallbacks(onReconnectingCallbacks, { maxAttemptsReached: true });
    return;
  }
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 15000);
  reconnectAttempts++;
  reconnectTimer = setTimeout(() => {
    connect();
  }, delay);
}

export function sendMove(fromFile, fromRank, toFile, toRank) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'move', fromFile, fromRank, toFile, toRank }));
  }
}

export function sendPromotion(pieceType) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'promotion', pieceType }));
  }
}

export function sendRestart() {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'restart' }));
  }
}

export function sendConcede() {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'concede' }));
  }
}

export function sendDropPlayer(token) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'dropPlayer', token }));
  }
}

export function sendJoin(color) {
  if (color !== 'white' && color !== 'black' && color !== 'spectator') return;
  if (!ws || ws.readyState !== 1) return;
  // Only attempt reconnect if we have a token AND the server confirmed it's valid
  const token = localStorage.getItem(tokenKey(color));
  if (token && color !== 'spectator' && validatedTokens[color] === true) {
    pendingToken = token;
    ws.send(JSON.stringify({ type: 'reconnect', token }));
  } else {
    // Fresh join (no token, unvalidated token, or spectator)
    if (token && color !== 'spectator' && validatedTokens[color] === false) {
      // Token was validated as invalid — remove the stale token
      localStorage.removeItem(tokenKey(color));
    }
    ws.send(JSON.stringify({ type: 'join', color }));
  }
}

export function sendExportFen() {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'exportFen' }));
  }
}

export function sendExportPgn() {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'exportPgn' }));
  }
}

export function sendImportFen(fen) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'importFen', fen }));
  }
}

export function sendActivateComputer(color, skill) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'activateComputer', color, skill }));
  }
}

export function sendChangeSkill(skill) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'changeSkill', skill }));
  }
}

export function sendOfferDraw() {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'offerDraw' }));
  }
}

export function sendDrawResponse(accepted) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'drawResponse', accepted }));
  }
}

export function sendLeave() {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'leave' }));
  }
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
