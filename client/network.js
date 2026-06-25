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

// Callbacks registered by other modules
const onStateUpdateCallbacks = [];
const onMoveCallbacks = [];
const onRestartCallbacks = [];
const onErrorCallbacks = [];
const onReconnectingCallbacks = [];
const onReconnectedCallbacks = [];
const onPlayerDisconnectedCallbacks = [];
const onPlayerDroppedCallbacks = [];
const onGameAvailableCallbacks = [];
const onReconnectFailedCallbacks = [];
const onConnectedCallbacks = []; // fires on raw WebSocket open (before any messages)

export function onStateUpdate(fn) { onStateUpdateCallbacks.push(fn); }
export function onMove(fn) { onMoveCallbacks.push(fn); }
export function onRestart(fn) { onRestartCallbacks.push(fn); }
export function onError(fn) { onErrorCallbacks.push(fn); }
export function onReconnecting(fn) { onReconnectingCallbacks.push(fn); }
export function onReconnected(fn) { onReconnectedCallbacks.push(fn); }
export function onPlayerDisconnected(fn) { onPlayerDisconnectedCallbacks.push(fn); }
export function onPlayerDropped(fn) { onPlayerDroppedCallbacks.push(fn); }
export function onGameAvailable(fn) { onGameAvailableCallbacks.push(fn); }
export function onReconnectFailed(fn) { onReconnectFailedCallbacks.push(fn); }
export function onConnected(fn) { onConnectedCallbacks.push(fn); }

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
    console.log('Connected to server');
    // Only auto-reconnect if we were actively playing and got disconnected
    // Fresh page loads / new windows NEVER auto-pick — join overlay always shows
    if (reconnecting && reconnectColor) {
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
    // Fire onConnected so UI can show join overlay immediately
    fireCallbacks(onConnectedCallbacks, {});
    // Otherwise: wait for user to click a button on the join overlay
  };

  ws.onclose = () => {
    console.log('Disconnected from server');
    ws = null;

    // Don't auto-reconnect if we're intentionally closing (e.g., page unload)
    if (window._mpchessClosing) return;

    // Start reconnection if we were a player
    if (myRole === 'white' || myRole === 'black') {
      startReconnection();
    } else {
      // Spectator — just show disconnected state, no auto-reconnect
      const roleBadge = document.getElementById('role-badge');
      if (roleBadge) {
        roleBadge.textContent = 'Disconnected';
        roleBadge.className = '';
      }
    }
  };

  ws.onerror = () => {
    console.log('WebSocket error');
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
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
        fireCallbacks(onStateUpdateCallbacks, msg);
        break;
      }
      case 'move': {
        fireCallbacks(onMoveCallbacks, msg);
        break;
      }
      case 'promotion': {
        break;
      }
      case 'players': {
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
        // Server assigned us a role and token
        if (msg.color === 'white' || msg.color === 'black') {
          localStorage.setItem(tokenKey(msg.color), msg.token);
        } else {
          // Spectator — only clear stale tokens if NOT in the middle of a reconnect attempt
          if (!pendingToken) {
            localStorage.removeItem(tokenKey('white'));
            localStorage.removeItem(tokenKey('black'));
          }
        }
        reconnectAttempts = 0;
        reconnecting = false;
        // Don't clear pendingToken here — reconnect message may still be pending
        if (!pendingToken) pendingToken = null;
        joinPendingColor = null;
        fireCallbacks(onReconnectedCallbacks, msg);
        break;
      }
      case 'reconnected': {
        // Successfully reconnected to our session
        // Ensure token is saved under the correct color key
        if (msg.color === 'white' || msg.color === 'black') {
          const existingToken = localStorage.getItem(tokenKey(msg.color));
          if (existingToken !== pendingToken) {
            localStorage.setItem(tokenKey(msg.color), pendingToken);
          }
        }
        reconnectAttempts = 0;
        reconnecting = false;
        pendingToken = null;
        joinPendingColor = null;
        fireCallbacks(onReconnectedCallbacks, msg);
        break;
      }
      case 'reconnectFailed': {
        // Seat was dropped or expired — only clear the token we tried to reconnect with
        console.log('Reconnect failed:', msg.reason);
        if (pendingToken) {
          if (localStorage.getItem(tokenKey('white')) === pendingToken) {
            localStorage.removeItem(tokenKey('white'));
          }
          if (localStorage.getItem(tokenKey('black')) === pendingToken) {
            localStorage.removeItem(tokenKey('black'));
          }
        }
        pendingToken = null;
        reconnectAttempts = 0;
        reconnecting = false;

        // If user clicked a button on the join overlay, auto-fall back to join
        if (joinPendingColor) {
          const color = joinPendingColor;
          joinPendingColor = null;
          ws.send(JSON.stringify({ type: 'join', color }));
        } else {
          fireCallbacks(onReconnectFailedCallbacks, msg);
        }
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
    }
  };
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
    console.log('Max reconnection attempts reached');
    fireCallbacks(onReconnectingCallbacks, { maxAttemptsReached: true });
    return;
  }
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 15000);
  reconnectAttempts++;
  console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
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
  if (!ws || ws.readyState !== 1) return;
  joinPendingColor = color;
  // If we have a saved token for this color, try to reconnect first
  const token = localStorage.getItem(tokenKey(color));
  if (token && color !== 'spectator') {
    pendingToken = token;
    ws.send(JSON.stringify({ type: 'reconnect', token }));
  } else {
    ws.send(JSON.stringify({ type: 'join', color }));
    joinPendingColor = null;
  }
}

export function isReconnecting() {
  return reconnecting;
}

// Start initial connection
connect();
