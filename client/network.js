// ═══════════════════════════════════════════════════════════
//  WEBSOCKET + GAME STATE
// ═══════════════════════════════════════════════════════════

const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(`${protocol}//${location.host}`);

export let myRole = 'spectator';
export let serverBoard = null;
export let serverTurn = 'white';
export let serverPromotingPiece = null;
export let serverGameOver = false;
export let serverGameResult = null;
export let moveHistory = [];
export let castlingRights = { wK: true, wQ: true, bK: true, bQ: true };
export let enPassantTarget = null;

// Callbacks registered by other modules
const onStateUpdateCallbacks = [];
const onMoveCallbacks = [];
const onRestartCallbacks = [];
const onErrorCallbacks = [];

export function onStateUpdate(fn) { onStateUpdateCallbacks.push(fn); }
export function onMove(fn) { onMoveCallbacks.push(fn); }
export function onRestart(fn) { onRestartCallbacks.push(fn); }
export function onError(fn) { onErrorCallbacks.push(fn); }

function fireCallbacks(arr, data) {
  for (const fn of arr) fn(data);
}

ws.onopen = () => { console.log('Connected to server'); };
ws.onclose = () => {
  console.log('Disconnected from server');
  const roleBadge = document.getElementById('role-badge');
  roleBadge.textContent = 'Disconnected';
  roleBadge.className = '';
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
  }
};

export function sendMove(fromFile, fromRank, toFile, toRank) {
  ws.send(JSON.stringify({ type: 'move', fromFile, fromRank, toFile, toRank }));
}

export function sendPromotion(pieceType) {
  ws.send(JSON.stringify({ type: 'promotion', pieceType }));
}

export function sendRestart() {
  ws.send(JSON.stringify({ type: 'restart' }));
}

export function sendConcede() {
  ws.send(JSON.stringify({ type: 'concede' }));
}
