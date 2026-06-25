// ═══════════════════════════════════════════════════════════
//  UI — HUD overlays, menus, promotion picker, move log, etc.
// ═══════════════════════════════════════════════════════════

import {
  myRole, serverTurn, serverPromotingPiece, serverGameOver, serverGameResult,
  moveHistory, disconnectedPlayersInfo, seatStatus, tokenKey,
  sendPromotion, sendRestart, sendConcede, sendDropPlayer, sendJoin,
  onStateUpdate, onRestart, onError, onReconnecting, onReconnected,
  onPlayerDisconnected, onPlayerDropped, onGameAvailable, onReconnectFailed,
  onConnected
} from './network.js';

// ── DOM refs ──────────────────────────────────────────────

const roleBadge = document.getElementById('role-badge');
const playerCountEl = document.getElementById('player-count');
const turnIndicator = document.getElementById('turn-indicator');
const errorToast = document.getElementById('error-toast');
const mouseModeEl = document.getElementById('mouse-mode');
const menuOverlay = document.getElementById('menu-overlay');
const btnResume = document.getElementById('btn-resume');
const btnRestart = document.getElementById('btn-restart');
const btnConcede = document.getElementById('btn-concede');
const promoOverlay = document.getElementById('promo-overlay');
const promoButtons = document.querySelectorAll('#promo-choices button');
const concedeOverlay = document.getElementById('concede-overlay');
const btnConcedeConfirm = document.getElementById('btn-concede-confirm');
const btnConcedeCancel = document.getElementById('btn-concede-cancel');
const capturedWhitePieces = document.querySelector('#captured-white .cap-pieces');
const capturedBlackPieces = document.querySelector('#captured-black .cap-pieces');

// Reconnection UI
const reconnectingOverlay = document.getElementById('reconnecting-overlay');
const reconnectingStatus = document.getElementById('reconnecting-status');
const btnGiveUp = document.getElementById('btn-give-up');

// Opponent disconnected banner
const opponentDisconnectedBanner = document.getElementById('opponent-disconnected-banner');
const opponentDisconnectedText = document.getElementById('opponent-disconnected-text');
const btnDropPlayer = document.getElementById('btn-drop-player');

// Game available banner (spectators)
const gameAvailableBanner = document.getElementById('game-available-banner');
const btnJoinGame = document.getElementById('btn-join-game');

// Second disconnected banner (spectators — both players gone)
const secondDisconnectedBanner = document.getElementById('second-disconnected-banner');
const secondDisconnectedText = document.getElementById('second-disconnected-text');

// Join selection overlay
const joinOverlay = document.getElementById('join-overlay');
const btnJoinWhite = document.getElementById('btn-join-white');
const btnJoinBlack = document.getElementById('btn-join-black');
const btnJoinSpectator = document.getElementById('btn-join-spectator');

let errorTimeout = null;
export let menuOpen = false;

// Track disconnected opponent for drop button
let disconnectedOpponentToken = null;
let disconnectedOpponentColor = null;
let dropButtonTimer = null;

// Track second disconnected player (spectators only)
let secondDisconnectedToken = null;

// ── Mouse sensitivity ────────────────────────────────────

const sensitivitySlider = document.getElementById('sensitivity-slider');
const sensitivityValue = document.getElementById('sensitivity-value');
export let mouseSensitivity = parseFloat(localStorage.getItem('mouseSensitivity') || '0.002');

function sliderToSens(v) { return v * 0.0001; }
function sensToSlider(s) { return Math.round(s / 0.0001); }
sensitivitySlider.value = sensToSlider(mouseSensitivity);
sensitivityValue.textContent = sensitivitySlider.value;

sensitivitySlider.addEventListener('input', () => {
  const v = parseInt(sensitivitySlider.value, 10);
  mouseSensitivity = sliderToSens(v);
  sensitivityValue.textContent = v;
  localStorage.setItem('mouseSensitivity', String(mouseSensitivity));
});

// ── Display helpers ──────────────────────────────────────

export function updateMouseModeDisplay(mouseLookOn) {
  if (mouseLookOn) {
    mouseModeEl.textContent = '🖱 Camera Mode';
    mouseModeEl.style.borderColor = 'rgba(181, 136, 99, 0.3)';
  } else {
    mouseModeEl.textContent = '♟ Piece Mode';
    mouseModeEl.style.borderColor = 'rgba(68, 187, 68, 0.6)';
  }
}

function updateRoleBadge() {
  roleBadge.textContent = myRole === 'white' ? '♔ White' :
                           myRole === 'black' ? '♚ Black' : '👁 Spectator';
  roleBadge.className = myRole;
}

function updatePlayerCount(players, spectators) {
  playerCountEl.textContent = `Players: ${players} · Spectators: ${spectators}`;
}

function updateTurnIndicator() {
  if (serverTurn === 'white') {
    turnIndicator.textContent = '⬤ White\'s Turn';
    turnIndicator.className = 'white-turn';
  } else {
    turnIndicator.textContent = '⬤ Black\'s Turn';
    turnIndicator.className = 'black-turn';
  }
}

function updateMoveLog() {
  const el = document.getElementById('move-log');
  const pairs = [];
  for (let i = 0; i < moveHistory.length; i += 2) {
    const num = Math.floor(i / 2) + 1;
    const w = moveHistory[i];
    const b = moveHistory[i + 1] || '';
    pairs.push(`<div><b>${num}.</b> ${w} ${b}</div>`);
  }
  el.innerHTML = pairs.slice(-6).join('');
}

const CAPTURE_SYMBOLS = {
  queen: { white: '♕', black: '♛' },
  rook: { white: '♖', black: '♜' },
  bishop: { white: '♗', black: '♝' },
  knight: { white: '♘', black: '♞' },
  pawn: { white: '♙', black: '♟' }
};
const CAPTURE_ORDER = { queen: 0, rook: 1, bishop: 2, knight: 3, pawn: 4 };

function updateCapturedPieces(captured) {
  if (!captured) { capturedWhitePieces.textContent = ''; capturedBlackPieces.textContent = ''; return; }
  const sortFn = (a, b) => (CAPTURE_ORDER[a] ?? 99) - (CAPTURE_ORDER[b] ?? 99);
  capturedWhitePieces.textContent = captured.white.slice().sort(sortFn).map(t => CAPTURE_SYMBOLS[t]?.black || '').join(' ');
  capturedBlackPieces.textContent = captured.black.slice().sort(sortFn).map(t => CAPTURE_SYMBOLS[t]?.white || '').join(' ');
}

export function showError(msg) {
  errorToast.textContent = msg;
  errorToast.classList.add('visible');
  clearTimeout(errorTimeout);
  errorTimeout = setTimeout(() => errorToast.classList.remove('visible'), 2500);
}

// ── Menu ─────────────────────────────────────────────────

export function showMenu() {
  menuOpen = true;
  menuOverlay.classList.add('visible');
  if (document.pointerLockElement) document.exitPointerLock();
  const isSpectator = myRole === 'spectator';
  btnRestart.disabled = isSpectator;
  btnConcede.disabled = isSpectator || serverGameOver;
}

export function hideMenu() {
  menuOverlay.classList.remove('visible');
  menuOpen = false;
}

btnResume.addEventListener('click', () => { hideMenu(); });

btnGiveUp.addEventListener('click', () => {
  // Clear token and reload to start fresh
  localStorage.removeItem('mpchess_session_token');
  window.location.reload();
});

btnDropPlayer.addEventListener('click', () => {
  if (disconnectedOpponentToken) {
    sendDropPlayer(disconnectedOpponentToken);
  }
});

btnJoinGame.addEventListener('click', () => {
  // Clear any stale token and reload — server will assign a player seat
  localStorage.removeItem('mpchess_session_token');
  window.location.reload();
});

btnRestart.addEventListener('click', () => { sendRestart(); hideMenu(); });
const btnNewGame = document.getElementById('btn-new-game');
btnNewGame.addEventListener('click', () => {
  if (myRole === 'spectator') return;
  sendRestart();
  document.getElementById('game-over-overlay').classList.remove('visible');
});

// ── Promotion picker ────────────────────────────────────

export function showPromotionPicker(file, rank, color) {
  const symbols = color === 'white'
    ? { queen: '♕', rook: '♖', bishop: '♗', knight: '♘' }
    : { queen: '♛', rook: '♜', bishop: '♝', knight: '♞' };
  promoButtons.forEach(btn => {
    const t = btn.dataset.type;
    btn.textContent = symbols[t];
  });
  promoOverlay.classList.add('visible');
}

export function hidePromotionPicker() {
  promoOverlay.classList.remove('visible');
}

promoButtons.forEach(btn => {
  btn.addEventListener('click', () => sendPromotion(btn.dataset.type));
});

// ── Concede ──────────────────────────────────────────────

export function showConcedeConfirm() {
  hideMenu();
  concedeOverlay.classList.add('visible');
}

export function hideConcedeConfirm() {
  concedeOverlay.classList.remove('visible');
}

btnConcede.addEventListener('click', () => showConcedeConfirm());
btnConcedeConfirm.addEventListener('click', () => { sendConcede(); hideConcedeConfirm(); });
btnConcedeCancel.addEventListener('click', () => hideConcedeConfirm());

// ── State update handler ────────────────────────────────

onStateUpdate((msg) => {
  updateRoleBadge();
  updatePlayerCount(msg.playerCount, msg.spectatorCount);
  updateTurnIndicator();
  updateMoveLog();
  updateCapturedPieces(msg.capturedPieces);

  // Hide concede confirmation on state update
  hideConcedeConfirm();

  // Show game over overlay
  if (serverGameOver && serverGameResult) {
    document.getElementById('game-over-text').textContent = serverGameResult;
    btnNewGame.disabled = myRole === 'spectator';
    document.getElementById('game-over-overlay').classList.add('visible');
  } else {
    btnNewGame.disabled = false;
    document.getElementById('game-over-overlay').classList.remove('visible');
  }

  // Show promotion picker if it's our turn
  if (serverPromotingPiece && serverPromotingPiece.color === myRole) {
    showPromotionPicker(serverPromotingPiece.file, serverPromotingPiece.rank, serverPromotingPiece.color);
  } else {
    hidePromotionPicker();
  }
});

onRestart(() => {
  updateMoveLog();
  updateCapturedPieces(null);
  hidePromotionPicker();
  hideConcedeConfirm();
  document.getElementById('game-over-overlay').classList.remove('visible');
});

onError((msg) => {
  showError(msg.reason);
});

// ── Reconnection callbacks ──────────────────────────────

function showReconnectingOverlay(status) {
  reconnectingStatus.textContent = status || 'Attempting to reconnect…';
  reconnectingOverlay.classList.add('visible');
}

function hideReconnectingOverlay() {
  reconnectingOverlay.classList.remove('visible');
}

onReconnecting((data) => {
  if (data.maxAttemptsReached) {
    showReconnectingOverlay('Connection lost. Click Give Up to rejoin.');
  } else {
    showReconnectingOverlay('Attempting to reconnect…');
  }
});

onReconnected((data) => {
  hideReconnectingOverlay();
  if (data.rejoinAsNewPlayer) {
    showError('Your seat was no longer available. Rejoining…');
  }
});

// ── Opponent disconnected / drop player ─────────────────

function startDropButtonCountdown(disconnectedAt) {
  // Clear any existing timer
  if (dropButtonTimer) {
    clearInterval(dropButtonTimer);
    dropButtonTimer = null;
  }

  const enableTime = disconnectedAt + 60000;

  function updateButton() {
    const remaining = Math.ceil((enableTime - Date.now()) / 1000);
    if (remaining <= 0) {
      btnDropPlayer.disabled = false;
      btnDropPlayer.textContent = 'Drop Player';
      if (dropButtonTimer) {
        clearInterval(dropButtonTimer);
        dropButtonTimer = null;
      }
    } else {
      btnDropPlayer.disabled = true;
      btnDropPlayer.textContent = `Drop Player (${remaining}s)`;
    }
  }

  updateButton();
  dropButtonTimer = setInterval(updateButton, 1000);
}

function showOpponentDisconnectedBanner(color, token, disconnectedAt) {
  disconnectedOpponentToken = token;
  disconnectedOpponentColor = color;
  const icon = color === 'white' ? '♔' : '♚';
  opponentDisconnectedText.textContent = `⚠ ${icon} ${color.charAt(0).toUpperCase() + color.slice(1)} disconnected`;
  opponentDisconnectedBanner.classList.add('visible');
  // Spectators see the banner but the drop button is hidden entirely
  if (myRole === 'white' || myRole === 'black') {
    btnDropPlayer.style.display = '';
    startDropButtonCountdown(disconnectedAt);
  } else {
    btnDropPlayer.style.display = 'none';
  }
}

function hideOpponentDisconnectedBanner() {
  opponentDisconnectedBanner.classList.remove('visible');
  btnDropPlayer.style.display = ''; // reset for next time
  disconnectedOpponentToken = null;
  disconnectedOpponentColor = null;
  if (dropButtonTimer) {
    clearInterval(dropButtonTimer);
    dropButtonTimer = null;
  }
  // Also hide second banner
  hideSecondDisconnectedBanner();
}

function showSecondDisconnectedBanner(color, token) {
  secondDisconnectedToken = token;
  const icon = color === 'white' ? '♔' : '♚';
  secondDisconnectedText.textContent = `⚠ ${icon} ${color.charAt(0).toUpperCase() + color.slice(1)} disconnected`;
  secondDisconnectedBanner.classList.add('visible');
}

function hideSecondDisconnectedBanner() {
  secondDisconnectedBanner.classList.remove('visible');
  secondDisconnectedToken = null;
}

onPlayerDisconnected((msg) => {
  hideGameAvailableBanner();
  if (myRole === 'spectator') {
    // Spectator: check if this is the first or second disconnected player
    if (!disconnectedOpponentToken) {
      showOpponentDisconnectedBanner(msg.color, msg.token, msg.disconnectedAt);
    } else if (disconnectedOpponentToken !== msg.token) {
      // Second player disconnected
      showSecondDisconnectedBanner(msg.color, msg.token);
    }
  } else {
    showOpponentDisconnectedBanner(msg.color, msg.token, msg.disconnectedAt);
  }
});

onPlayerDropped(() => {
  hideOpponentDisconnectedBanner();
  hideSecondDisconnectedBanner();
});

// ── Game available (spectators) ─────────────────────────

function showGameAvailableBanner() {
  gameAvailableBanner.classList.add('visible');
}

function hideGameAvailableBanner() {
  gameAvailableBanner.classList.remove('visible');
}

onGameAvailable(() => {
  showGameAvailableBanner();
  hideOpponentDisconnectedBanner();
  hideSecondDisconnectedBanner();
});

// ── Enhanced state update: sync disconnected banners ────
onStateUpdate((msg) => {
  // Collect all disconnected players
  const disconnectedPlayers = disconnectedPlayersInfo.filter(
    p => p.color === 'white' || p.color === 'black'
  );

  if (myRole === 'white' || myRole === 'black') {
    // Player: show banner for disconnected opponent
    const opp = disconnectedPlayers.find(p => p.color !== myRole);
    if (opp && (!disconnectedOpponentToken || disconnectedOpponentToken !== opp.token)) {
      showOpponentDisconnectedBanner(opp.color, opp.token, opp.disconnectedAt);
    } else if (!opp && disconnectedOpponentToken) {
      // Opponent reconnected
      hideOpponentDisconnectedBanner();
    }
  }

  // Spectator: show banners for all disconnected players
  if (myRole === 'spectator') {
    if (disconnectedPlayers.length >= 1) {
      // Show first disconnected player
      const first = disconnectedPlayers[0];
      if (!disconnectedOpponentToken || disconnectedOpponentToken !== first.token) {
        showOpponentDisconnectedBanner(first.color, first.token, first.disconnectedAt);
      }
      // Show second disconnected player
      if (disconnectedPlayers.length >= 2) {
        const second = disconnectedPlayers[1];
        if (!secondDisconnectedToken || secondDisconnectedToken !== second.token) {
          showSecondDisconnectedBanner(second.color, second.token);
        }
      } else {
        hideSecondDisconnectedBanner();
      }
    } else {
      hideOpponentDisconnectedBanner();
    }

    // Hide game-available banner if players are no longer both disconnected
    if (disconnectedPlayers.length < 2) {
      hideGameAvailableBanner();
    }
  }

  // If not yet joined, show the join overlay
  if (!myRole) {
    showJoinOverlay();
    updateJoinButtons();
  }
});

// Show join overlay immediately on connection (before state arrives)
// Buttons based on tokens; refined when seat status arrives
onConnected(() => {
  if (!myRole) {
    showJoinOverlay();
    updateJoinButtons(); // uses tokens if seat status not yet available
  }
});

// ── Join selection overlay ──────────────────────────────

let joinCountdownTimer = null;

function showJoinOverlay() {
  joinOverlay.classList.add('visible');
}

function hideJoinOverlay() {
  joinOverlay.classList.remove('visible');
  if (joinCountdownTimer) {
    clearInterval(joinCountdownTimer);
    joinCountdownTimer = null;
  }
}

function updateJoinButtons() {
  const whiteSeat = seatStatus.white || { status: 'unknown' };
  const blackSeat = seatStatus.black || { status: 'unknown' };

  // Check for saved tokens
  const hasWhiteToken = !!localStorage.getItem(tokenKey('white'));
  const hasBlackToken = !!localStorage.getItem(tokenKey('black'));

  // White button
  if (hasWhiteToken) {
    btnJoinWhite.disabled = false;
    btnJoinWhite.querySelector('.join-status').textContent = 'Reconnect';
  } else if (whiteSeat.status === 'free') {
    btnJoinWhite.disabled = false;
    btnJoinWhite.querySelector('.join-status').textContent = 'Available';
  } else if (whiteSeat.status === 'occupied') {
    btnJoinWhite.disabled = true;
    btnJoinWhite.querySelector('.join-status').textContent = 'Occupied';
  } else if (whiteSeat.status === 'held') {
    btnJoinWhite.disabled = true;
    updateSeatCountdown(btnJoinWhite, whiteSeat.freesAt, 'White');
  } else {
    btnJoinWhite.disabled = true;
    btnJoinWhite.querySelector('.join-status').textContent = 'Checking...';
  }

  // Black button
  if (hasBlackToken) {
    btnJoinBlack.disabled = false;
    btnJoinBlack.querySelector('.join-status').textContent = 'Reconnect';
  } else if (blackSeat.status === 'free') {
    btnJoinBlack.disabled = false;
    btnJoinBlack.querySelector('.join-status').textContent = 'Available';
  } else if (blackSeat.status === 'occupied') {
    btnJoinBlack.disabled = true;
    btnJoinBlack.querySelector('.join-status').textContent = 'Occupied';
  } else if (blackSeat.status === 'held') {
    btnJoinBlack.disabled = true;
    updateSeatCountdown(btnJoinBlack, blackSeat.freesAt, 'Black');
  } else {
    btnJoinBlack.disabled = true;
    btnJoinBlack.querySelector('.join-status').textContent = 'Checking...';
  }

  // Spectator always available
  btnJoinSpectator.disabled = false;
}

function updateSeatCountdown(btn, freesAt, colorName) {
  const statusEl = btn.querySelector('.join-status');
  if (joinCountdownTimer) clearInterval(joinCountdownTimer);

  function tick() {
    const remaining = Math.max(0, Math.ceil((freesAt - Date.now()) / 1000));
    if (remaining <= 0) {
      clearInterval(joinCountdownTimer);
      joinCountdownTimer = null;
      // Seat should be free now — state update will refresh
      statusEl.textContent = 'Opening...';
    } else {
      statusEl.textContent = `${colorName} returns in ${remaining}s`;
    }
  }

  tick();
  joinCountdownTimer = setInterval(tick, 1000);
}

// Button click handlers
btnJoinWhite.addEventListener('click', () => {
  sendJoin('white');
});

btnJoinBlack.addEventListener('click', () => {
  sendJoin('black');
});

btnJoinSpectator.addEventListener('click', () => {
  sendJoin('spectator');
});

// Hide join overlay when joined
onStateUpdate((msg) => {
  if (myRole) {
    hideJoinOverlay();
  }
});

// Show join overlay when reconnect fails
onReconnectFailed(() => {
  showJoinOverlay();
  updateJoinButtons();
});
