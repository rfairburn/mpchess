// ═══════════════════════════════════════════════════════════
//  UI — HUD overlays, menus, promotion picker, move log, etc.
// ═══════════════════════════════════════════════════════════

import {
  myRole,
  serverTurn,
  serverPromotingPiece,
  serverGameOver,
  serverGameResult,
  moveHistory,
  disconnectedPlayersInfo,
  seatStatus,
  computerPlayer,
  tokenKey,
  validatedTokens,
  halfmoveClock,
  threefoldCount,
  sendPromotion,
  sendRestart,
  sendConcede,
  sendDropPlayer,
  sendJoin,
  sendExportFen,
  sendExportPgn,
  sendImportFen,
  sendActivateComputer,
  sendChangeSkill,
  sendOfferDraw,
  sendDrawResponse,
  onStateUpdate,
  onMove,
  onRestart,
  onError,
  onInfo,
  onReconnecting,
  onReconnected,
  onPlayerDisconnected,
  onPlayerDropped,
  onGameAvailable,
  onReconnectFailed,
  onConnected,
  onConnectionError,
  onComputerActivated,
  onComputerThinking,
  onComputerSkillChanged,
  onComputerUnavailable,
  onDrawOffer,
  onDrawResult,
  onDrawOfferCancelled,
  retryConnection,
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
const btnOfferDraw = document.getElementById('btn-offer-draw');
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

// Connection error UI
const connectionErrorOverlay = document.getElementById('connection-error-overlay');
const connectionErrorMessage = document.getElementById('connection-error-message');
const btnRetryConnection = document.getElementById('btn-retry-connection');

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

// Computer player UI
const computerThinkingIndicator = document.getElementById('computer-thinking');

// Menu computer player section
const menuComputerSection = document.getElementById('menu-computer-section');
const menuSkillChangeSection = document.getElementById('menu-skill-change-section');
const menuComputerSkillDropdown = document.getElementById('menu-computer-skill-dropdown');
const menuSkillChangeDropdown = document.getElementById('menu-skill-change-dropdown');
const btnMenuActivateComputer = document.getElementById('btn-menu-activate-computer');
const btnMenuChangeSkill = document.getElementById('btn-menu-change-skill');

// Draw offer overlay
const drawOfferOverlay = document.getElementById('draw-offer-overlay');
const drawOfferText = document.getElementById('draw-offer-text');
const btnDrawAccept = document.getElementById('btn-draw-accept');
const btnDrawDecline = document.getElementById('btn-draw-decline');

let errorTimeout = null;
export let menuOpen = false;

// Skill labels (must stay in sync with server)
const SKILL_LABELS = {
  beginner: 'Beginner',
  novice: 'Novice',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
  master: 'Master',
  grandmaster: 'Grandmaster',
};

// Track previous role so we can reposition the camera on join/reconnect
let prevRole = null;

// Track disconnected opponent for drop button
let disconnectedOpponentToken = null;

let dropButtonTimer = null;

// Track second disconnected player (spectators only)
let secondDisconnectedToken = null;

// ── Mouse sensitivity ────────────────────────────────────
// Logarithmic scale: slider 1–100 maps to ~0.0002–~0.004.
// Linear mapping (v * 0.0001) gave 0.0001–0.01, where the upper end was
// too fast for most users.  The exponential curve keeps low values precise
// and caps the top at a comfortable speed.

const sensitivitySlider = document.getElementById('sensitivity-slider');
const sensitivityValue = document.getElementById('sensitivity-value');
export let mouseSensitivity = parseFloat(localStorage.getItem('mouseSensitivity') || '0.002');

function sliderToSens(v) {
  // Exponential: 1 → 0.0002, 50 → 0.002, 100 → 0.004
  return 0.0002 * Math.pow(20, (v - 1) / 99);
}
function sensToSlider(s) {
  // Inverse of sliderToSens
  return Math.round(1 + (99 * Math.log(s / 0.0002)) / Math.log(20));
}
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
    hud.textContent =
      'Click to look around · WASD move · Q/E up/down · TAB toggle mouse-look · ESC menu';
  } else {
    mouseModeEl.textContent = '♟ Piece Mode';
    mouseModeEl.style.borderColor = 'rgba(68, 187, 68, 0.6)';
    hud.textContent = 'Click to move pieces · TAB toggle mouse-look · ESC menu';
  }
}

function updateRoleBadge() {
  roleBadge.textContent =
    myRole === 'white' ? '♔ White' : myRole === 'black' ? '♚ Black' : '👁 Spectator';
  roleBadge.className = myRole;
}

function updatePlayerCount(players, spectators) {
  playerCountEl.textContent = `Players: ${players} · Spectators: ${spectators}`;
}

function updateTurnIndicator() {
  if (serverTurn === 'white') {
    turnIndicator.textContent = "⬤ White's Turn";
    turnIndicator.className = 'white-turn';
  } else {
    turnIndicator.textContent = "⬤ Black's Turn";
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
  pawn: { white: '♙', black: '♟' },
};
const CAPTURE_ORDER = { queen: 0, rook: 1, bishop: 2, knight: 3, pawn: 4 };

function updateCapturedPieces(captured) {
  if (!captured) {
    capturedWhitePieces.textContent = '';
    capturedBlackPieces.textContent = '';
    return;
  }
  const sortFn = (a, b) => (CAPTURE_ORDER[a] ?? 99) - (CAPTURE_ORDER[b] ?? 99);
  capturedWhitePieces.textContent = captured.white
    .slice()
    .sort(sortFn)
    .map((t) => CAPTURE_SYMBOLS[t]?.black || '')
    .join(' ');
  capturedBlackPieces.textContent = captured.black
    .slice()
    .sort(sortFn)
    .map((t) => CAPTURE_SYMBOLS[t]?.white || '')
    .join(' ');
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
  const isPlayer = myRole === 'white' || myRole === 'black';
  btnRestart.disabled = isSpectator;
  btnConcede.disabled = isSpectator || serverGameOver;
  btnImportFen.disabled = isSpectator;
  btnOfferDraw.disabled = !isPlayer || serverGameOver;

  // Show/hide computer player sections in menu
  if (isPlayer && !serverGameOver) {
    const opponentColor = myRole === 'white' ? 'black' : 'white';
    const opponentSeat = seatStatus[opponentColor];
    const opponentSeatFree = opponentSeat?.status === 'free';

    if (computerPlayer) {
      // Computer opponent is active — show skill change section
      menuComputerSection.classList.remove('visible');
      menuSkillChangeSection.classList.add('visible');
      menuSkillChangeDropdown.value = computerPlayer.skill || 'master';
    } else if (opponentSeatFree) {
      // No computer opponent and opponent seat is free — show activate section
      menuComputerSection.classList.add('visible');
      menuSkillChangeSection.classList.remove('visible');
    } else {
      // Opponent seat is occupied, held, or computer — hide both sections
      menuComputerSection.classList.remove('visible');
      menuSkillChangeSection.classList.remove('visible');
    }
  } else {
    menuComputerSection.classList.remove('visible');
    menuSkillChangeSection.classList.remove('visible');
  }
}

export function hideMenu() {
  menuOverlay.classList.remove('visible');
  menuOpen = false;
}

btnResume.addEventListener('click', () => {
  hideMenu();
});

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

btnRestart.addEventListener('click', () => {
  sendRestart();
  hideMenu();
});

// Offer draw button
btnOfferDraw.addEventListener('click', () => {
  sendOfferDraw();
  hideMenu();
});

// Menu computer player activation
if (btnMenuActivateComputer) {
  btnMenuActivateComputer.addEventListener('click', () => {
    const skill = menuComputerSkillDropdown?.value || 'master';
    const opponentColor = myRole === 'white' ? 'black' : 'white';
    sendActivateComputer(opponentColor, skill);
    hideMenu();
  });
}

// Menu skill change
if (btnMenuChangeSkill) {
  btnMenuChangeSkill.addEventListener('click', () => {
    const skill = menuSkillChangeDropdown?.value || 'master';
    sendChangeSkill(skill);
    hideMenu();
  });
}

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
  const symbols =
    color === 'white'
      ? { queen: '♕', rook: '♖', bishop: '♗', knight: '♘' }
      : { queen: '♛', rook: '♜', bishop: '♝', knight: '♞' };
  promoButtons.forEach((btn) => {
    const t = btn.dataset.type;
    btn.textContent = symbols[t];
  });
  promoOverlay.classList.add('visible');
}

export function hidePromotionPicker() {
  promoOverlay.classList.remove('visible');
}

promoButtons.forEach((btn) => {
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
btnConcedeConfirm.addEventListener('click', () => {
  sendConcede();
  hideConcedeConfirm();
});
btnConcedeCancel.addEventListener('click', () => hideConcedeConfirm());

// ── Draw offer ───────────────────────────────────────────

export function showDrawOffer(fromColor) {
  const colorLabel = fromColor === 'white' ? 'White' : 'Black';
  drawOfferText.textContent = `${colorLabel} offers a draw.`;
  drawOfferOverlay.classList.add('visible');
}

export function hideDrawOffer() {
  drawOfferOverlay.classList.remove('visible');
}

btnDrawAccept.addEventListener('click', () => {
  sendDrawResponse(true);
  hideDrawOffer();
});
btnDrawDecline.addEventListener('click', () => {
  sendDrawResponse(false);
  hideDrawOffer();
});

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
  const dp = disconnectedPlayersInfo.filter((p) => p.color === 'white' || p.color === 'black');

  if (myRole === 'white' || myRole === 'black') {
    const opp = dp.find((p) => p.color !== myRole);
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

  // Hide draw offer popup when game ends
  if (serverGameOver) {
    hideDrawOffer();
  }

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
    showPromotionPicker(
      serverPromotingPiece.file,
      serverPromotingPiece.rank,
      serverPromotingPiece.color
    );
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
  hideDrawOffer();
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

// ── Connection error ────────────────────────────────────

function showConnectionError(message) {
  connectionErrorMessage.textContent = message;
  connectionErrorOverlay.classList.add('visible');
}

function hideConnectionError() {
  connectionErrorOverlay.classList.remove('visible');
}

btnRetryConnection.addEventListener('click', () => {
  hideConnectionError();
  retryConnection();
});

onConnectionError((data) => {
  const code = data.event?.target?.readyState;
  // WebSocket readyState: 0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED
  let message = 'Unable to reach the server. Check your connection and try again.';
  if (code === 3) {
    // Connection was rejected or failed
    message =
      'Connection to the server was refused. The server may be down or your origin is not allowed.';
  }
  showConnectionError(message);
});

// Hide connection error when a successful connection is established
onConnected(() => {
  hideConnectionError();
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

// ── Unified disconnected-banner helpers (D7) ───────────

function buildDisconnectedText(color) {
  const icon = color === 'white' ? '♔' : '♚';
  return `⚠ ${icon} ${color.charAt(0).toUpperCase() + color.slice(1)} disconnected`;
}

function showOpponentDisconnectedBanner(color, token, disconnectedAt) {
  disconnectedOpponentToken = token;
  opponentDisconnectedText.textContent = buildDisconnectedText(color);
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
  if (dropButtonTimer) {
    clearInterval(dropButtonTimer);
    dropButtonTimer = null;
  }
  // Also hide second banner
  hideSecondDisconnectedBanner();
}

function showSecondDisconnectedBanner(color, token) {
  secondDisconnectedToken = token;
  secondDisconnectedText.textContent = buildDisconnectedText(color);
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

  // Computer skill selector is now in the ESC menu, not the join overlay
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
    statusEl.textContent = 'Loading...';
  } else if (seat.status === 'free') {
    btn.disabled = false;
    statusEl.textContent = 'Available';
  } else if (seat.status === 'occupied') {
    btn.disabled = true;
    statusEl.textContent = 'Occupied';
  } else if (seat.status === 'computer') {
    btn.disabled = true;
    const skillLabel = SKILL_LABELS[seat.skill] || seat.skill;
    statusEl.textContent = `Computer (${skillLabel})`;
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

// ── Computer player callbacks ───────────────────────────

onComputerActivated((msg) => {
  showInfo(`Computer player activated (${SKILL_LABELS[msg.skill] || msg.skill})`);
});

onComputerThinking((msg) => {
  if (computerThinkingIndicator) {
    const color = msg.color === 'white' ? 'White' : 'Black';
    computerThinkingIndicator.textContent = `🤖 ${color} is thinking...`;
    computerThinkingIndicator.classList.add('visible');
  }
});

// Hide thinking indicator on any move
onMove(() => {
  if (computerThinkingIndicator) {
    computerThinkingIndicator.classList.remove('visible');
  }
});

onComputerSkillChanged((msg) => {
  showInfo(`Skill changed to ${SKILL_LABELS[msg.skill] || msg.skill}`);
});

onComputerUnavailable((msg) => {
  showError(msg.reason || 'Computer player unavailable');
  if (computerThinkingIndicator) {
    computerThinkingIndicator.classList.remove('visible');
  }
});

// Show join overlay when reconnect fails
onReconnectFailed(() => {
  showJoinOverlay();
  updateJoinButtons();
});

// ── Draw offer callbacks ────────────────────────────────

onDrawOffer((msg) => {
  showDrawOffer(msg.fromColor);
});

onDrawResult((msg) => {
  hideDrawOffer();
  if (msg.accepted) {
    showInfo('Draw accepted — game ended in a draw.');
  } else {
    showError(msg.reason || 'Draw offer declined.');
  }
});

onDrawOfferCancelled(() => {
  hideDrawOffer();
  showInfo('Draw offer was cancelled.');
});
