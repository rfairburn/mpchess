// ═══════════════════════════════════════════════════════════
//  UI — HUD overlays, menus, promotion picker, move log, etc.
// ═══════════════════════════════════════════════════════════

import {
  myRole, serverTurn, serverPromotingPiece, serverGameOver, serverGameResult,
  moveHistory, disconnectedPlayersInfo, seatStatus, tokenKey, validatedTokens,
  halfmoveClock, threefoldCount, currentFen,
  sendPromotion, sendRestart, sendConcede, sendDropPlayer, sendJoin,
  sendExportFen, sendExportPgn, sendImportFen,
  onStateUpdate, onRestart, onError, onInfo, onReconnecting, onReconnected,
  onPlayerDisconnected, onPlayerDropped, onGameAvailable, onReconnectFailed,
  onConnected
} from './network.js';
import { setCameraForRole } from './controls.js';

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

// Import FEN overlay
const importFenOverlay = document.getElementById('import-fen-overlay');
const fenInput = document.getElementById('fen-input');
const btnImportFen = document.getElementById('btn-import-fen');
const btnImportFenConfirm = document.getElementById('btn-import-fen-confirm');
const btnImportFenCancel = document.getElementById('btn-import-fen-cancel');

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

// Track previous role so we can reposition the camera on join/reconnect
let prevRole = null;

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
  const hud = document.getElementById('hud');
  if (mouseLookOn) {
    mouseModeEl.textContent = '🖱 Camera Mode';
    mouseModeEl.style.borderColor = 'rgba(181, 136, 99, 0.3)';
    hud.textContent = 'Click to look around · WASD move · Q/E up/down · TAB toggle mouse-look · ESC menu';
  } else {
    mouseModeEl.textContent = '♟ Piece Mode';
    mouseModeEl.style.borderColor = 'rgba(68, 187, 68, 0.6)';
    hud.textContent = 'Click to move pieces · TAB toggle mouse-look · ESC menu';
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
  el.innerHTML = pairs.join('');
  // Auto-scroll to bottom
  el.scrollTop = el.scrollHeight;
}

function updateDrawInfo() {
  const el = document.getElementById('draw-info');
  if (!el) return;

  const repLabel = threefoldCount > 0 ? `Repetition: ${threefoldCount}/3` : '';
  const fiftyLabel = halfmoveClock > 0 ? `50-move: ${halfmoveClock}/100` : '';

  if (!repLabel && !fiftyLabel) {
    el.classList.remove('visible');
    return;
  }

  el.classList.add('visible');
  const parts = [repLabel, fiftyLabel].filter(Boolean);
  el.innerHTML = parts.join('<br>');
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
  errorToast.style.color = '#ff6b6b';
  errorToast.style.borderColor = 'rgba(255, 80, 80, 0.4)';
  errorToast.classList.add('visible');
  clearTimeout(errorTimeout);
  errorTimeout = setTimeout(() => errorToast.classList.remove('visible'), 2500);
}

export function showInfo(msg) {
  errorToast.textContent = msg;
  errorToast.style.color = '#6bff6b';
  errorToast.style.borderColor = 'rgba(80, 255, 80, 0.4)';
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
  btnImportFen.disabled = isSpectator;
}

export function hideMenu() {
  menuOverlay.classList.remove('visible');
  menuOpen = false;
}

btnResume.addEventListener('click', () => { hideMenu(); });

btnGiveUp.addEventListener('click', () => {
  localStorage.removeItem(tokenKey('white'));
  localStorage.removeItem(tokenKey('black'));
  window.location.reload();
});

btnDropPlayer.addEventListener('click', () => {
  if (disconnectedOpponentToken) {
    sendDropPlayer(disconnectedOpponentToken);
  }
});

btnJoinGame.addEventListener('click', () => {
  localStorage.removeItem(tokenKey('white'));
  localStorage.removeItem(tokenKey('black'));
  window.location.reload();
});

btnRestart.addEventListener('click', () => { sendRestart(); hideMenu(); });

// Export buttons
const btnExportFen = document.getElementById('btn-export-fen');
const btnExportPgn = document.getElementById('btn-export-pgn');

btnExportFen.addEventListener('click', () => {
  sendExportFen();
});

btnExportPgn.addEventListener('click', () => {
  sendExportPgn();
});

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

// ── Import FEN ───────────────────────────────────────────

export function showImportFenDialog() {
  hideMenu();
  fenInput.value = '';
  importFenOverlay.classList.add('visible');
  setTimeout(() => fenInput.focus(), 50);
}

export function hideImportFenDialog() {
  importFenOverlay.classList.remove('visible');
}

btnImportFen.addEventListener('click', () => showImportFenDialog());
btnImportFenConfirm.addEventListener('click', () => {
  const fen = fenInput.value.trim();
  if (fen) {
    sendImportFen(fen);
    hideImportFenDialog();
  }
});
btnImportFenCancel.addEventListener('click', () => hideImportFenDialog());

// Allow Enter to submit FEN from the textarea
fenInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    btnImportFenConfirm.click();
  }
});

// ── Unified state update handler ────────────────────────

function syncDisconnectedBanners() {
  const dp = disconnectedPlayersInfo.filter(p => p.color === 'white' || p.color === 'black');

  if (myRole === 'white' || myRole === 'black') {
    const opp = dp.find(p => p.color !== myRole);
    if (opp && (!disconnectedOpponentToken || disconnectedOpponentToken !== opp.token)) {
      showOpponentDisconnectedBanner(opp.color, opp.token, opp.disconnectedAt);
    } else if (!opp && disconnectedOpponentToken) {
      hideOpponentDisconnectedBanner();
    }
  }

  if (myRole === 'spectator') {
    if (dp.length >= 1) {
      const first = dp[0];
      if (!disconnectedOpponentToken || disconnectedOpponentToken !== first.token) {
        showOpponentDisconnectedBanner(first.color, first.token, first.disconnectedAt);
      }
      if (dp.length >= 2) {
        const second = dp[1];
        if (!secondDisconnectedToken || secondDisconnectedToken !== second.token) {
          showSecondDisconnectedBanner(second.color, second.token);
        }
      } else {
        hideSecondDisconnectedBanner();
      }
    } else {
      hideOpponentDisconnectedBanner();
    }
    if (dp.length < 2) hideGameAvailableBanner();
  }
}

function syncJoinOverlay() {
  if (!myRole) {
    showJoinOverlay();
    updateJoinButtons();
  } else {
    hideJoinOverlay();
  }
}

onStateUpdate((msg) => {
  // Reposition camera when role changes (join, reconnect, etc.)
  if (myRole && myRole !== prevRole) {
    setCameraForRole(myRole);
    prevRole = myRole;
  }

  // HUD
  updateRoleBadge();
  updatePlayerCount(msg.playerCount, msg.spectatorCount);
  updateTurnIndicator();
  updateMoveLog();
  updateDrawInfo();
  updateCapturedPieces(msg.capturedPieces);
  hideConcedeConfirm();

  // Game over
  if (serverGameOver && serverGameResult) {
    document.getElementById('game-over-text').textContent = serverGameResult;
    btnNewGame.disabled = myRole === 'spectator';
    document.getElementById('game-over-overlay').classList.add('visible');
  } else {
    btnNewGame.disabled = false;
    document.getElementById('game-over-overlay').classList.remove('visible');
  }

  // Promotion picker
  if (serverPromotingPiece && serverPromotingPiece.color === myRole) {
    showPromotionPicker(serverPromotingPiece.file, serverPromotingPiece.rank, serverPromotingPiece.color);
  } else {
    hidePromotionPicker();
  }

  // Disconnected player banners
  syncDisconnectedBanners();

  // Join overlay
  syncJoinOverlay();
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

onInfo((msg) => {
  showInfo(msg.reason);
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
  setJoinButton(btnJoinWhite, seatStatus.white, 'White');
  setJoinButton(btnJoinBlack, seatStatus.black, 'Black');
  btnJoinSpectator.disabled = false;
}

function setJoinButton(btn, seat, colorName) {
  const statusEl = btn.querySelector('.join-status');
  const color = colorName.toLowerCase();
  // Only offer "Reconnect" when the SERVER confirmed our stored token is valid
  const canReconnect = validatedTokens[color] === true;

  if (canReconnect && seat && (seat.status === 'held' || seat.status === 'occupied')) {
    btn.disabled = false;
    statusEl.textContent = 'Reconnect';
  } else if (!seat || seat.status === 'unknown') {
    btn.disabled = true;
    statusEl.textContent = 'Checking...';
  } else if (seat.status === 'free') {
    btn.disabled = false;
    statusEl.textContent = 'Available';
  } else if (seat.status === 'occupied') {
    btn.disabled = true;
    statusEl.textContent = 'Occupied';
  } else if (seat.status === 'held') {
    btn.disabled = true;
    updateSeatCountdown(btn, seat.freesAt, colorName);
  }
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

// Show join overlay when reconnect fails
onReconnectFailed(() => {
  showJoinOverlay();
  updateJoinButtons();
});
