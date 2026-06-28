// ═══════════════════════════════════════════════════════════
//  WEBSOCKET + GAME STATE + RECONNECTION
// ═══════════════════════════════════════════════════════════

// Per-color token keys so multiple tabs (white + black) don't collide
export function tokenKey(color) { return `mpchess_session_${color}`; }

let ws = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
let reconnecting = false;
let pendingToken = null; // token we're trying to reconnect with
let reconnectColor = null; // color we're trying to reconnect to (auto-reconnect only)
let joinPendingColor = null; // color user clicked on join overlay (for fallback)

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
export let halfmoveClock = 0;
export let threefoldCount = 0;
export let currentFen = '';

// Callbacks registered by other modules
const onStateUpdateCallbacks = [];
const onMoveCallbacks = [];
const onRestartCallbacks = [];
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

export function onStateUpdate(fn) { onStateUpdateCallbacks.push(fn); }
export function onMove(fn) { onMoveCallbacks.push(fn); }
export function onRestart(fn) { onRestartCallbacks.push(fn); }
export function onError(fn) { onErrorCallbacks.push(fn); }
export function onInfo(fn) { onInfoCallbacks.push(fn); }
export function onReconnecting(fn) { onReconnectingCallbacks.push(fn); }
export function onReconnected(fn) { onReconnectedCallbacks.push(fn); }
export function onPlayerDisconnected(fn) { onPlayerDisconnectedCallbacks.push(fn); }
export function onPlayerDropped(fn) { onPlayerDroppedCallbacks.push(fn); }
export function onGameAvailable(fn) { onGameAvailableCallbacks.push(fn); }
export function onReconnectFailed(fn) { onReconnectFailedCallbacks.push(fn); }
export function onConnected(fn) { onConnectedCallbacks.push(fn); }
export function onConnectionError(fn) { onConnectionErrorCallbacks.push(fn); }

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
  return `${protocol}//${location.host}`;
}

function connect() {
  clearReconnectTimer();
  try { ws = new WebSocket(getConnectionUrl()); } catch (e) { return; }

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

  ws.onerror = (event) => {
    // Connection failed before it was established (e.g., origin rejected, server down)
    // Only fire this for initial connections, not during reconnection (reconnect has its own flow)
    if (!reconnecting && myRole === null) {
      fireCallbacks(onConnectionErrorCallbacks, { event });
    }
  };

  ws.onclose = (event) => {
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
    try { msg = JSON.parse(event.data); } catch { return; }
    switch (msg.type) {
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
        halfmoveClock = msg.halfmoveClock ?? 0;
        threefoldCount = msg.threefoldCount ?? 0;
        currentFen = msg.fen || '';
        fireCallbacks(onStateUpdateCallbacks, msg);
        break;
      }
      case 'move': {
        // For promotion moves, update the local board immediately so
        // rebuildPieces doesn't recreate the pawn at the source square
        // (the server doesn't mutate the board until completePromotion).
        if (msg.promotion && serverBoard) {
          serverBoard[msg.fromRank][msg.fromFile] = 0;
          if (msg.enPassant) {
            const promoColor = serverTurn; // it's the moving side's turn
            const capturedRank = promoColor === 'white' ? msg.toRank - 1 : msg.toRank + 1;
            serverBoard[capturedRank][msg.toFile] = 0;
          }
        }
        fireCallbacks(onMoveCallbacks, msg);
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
        joinPendingColor = null;
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
        joinPendingColor = null;
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
        pendingToken = null;
        reconnectAttempts = 0;
        reconnecting = false;
        joinPendingColor = null;
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
          navigator.clipboard.writeText(msg.fen).then(() => {
            fireCallbacks(onInfoCallbacks, { reason: 'FEN copied to clipboard' });
          }).catch(() => {
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
          navigator.clipboard.writeText(msg.pgn).then(() => {
            fireCallbacks(onInfoCallbacks, { reason: 'PGN copied to clipboard' });
          }).catch(() => {
            downloadText(msg.pgn, 'game.pgn', 'text/plain');
            fireCallbacks(onInfoCallbacks, { reason: 'PGN downloaded' });
          });
        } else {
          downloadText(msg.pgn, 'game.pgn', 'text/plain');
          fireCallbacks(onInfoCallbacks, { reason: 'PGN downloaded' });
        }
        break;
      }
    }
  };
}

function downloadText(text, filename, mimeType) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
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
  joinPendingColor = color;
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
    joinPendingColor = null;
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
