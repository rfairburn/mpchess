// ═══════════════════════════════════════════════════════════
//  UI — Core: HUD, menu, overlays, state sync, toasts
//  Sub-modules: ui/join.js, ui/disconnected.js, ui/computer.js, ui/connection.js
// ═══════════════════════════════════════════════════════════

import {
  myRole,
  serverTurn,
  serverPromotingPiece,
  serverGameOver,
  serverGameResult,
  moveHistory,
  seatStatus,
  tokenKey,
  halfmoveClock,
  threefoldCount,
  canClaimDraw,
  sendPromotion,
  sendRestart,
  sendConcede,
  sendLeave,
  sendExportFen,
  sendExportPgn,
  sendImportFen,
  sendOfferDraw,
  sendDrawResponse,
  sendClaimDraw,
  onStateUpdate,
  onRestart,
  onError,
  onInfo,
  onDrawOffer,
  onDrawResult,
  onDrawOfferCancelled,
  onPlayerLeft,
  onFenImportWarning,
} from './network.js';
import { setCameraForRole } from './controls.js';

// ── Sub-modules (initialize their own callbacks) ─────────

import { showError, showInfo, showWarning } from './ui/toast.js';
import { syncDisconnectedBanners } from './ui/disconnected.js';
import { showJoinOverlay, hideJoinOverlay, updateJoinButtons } from './ui/join.js';
import { updateMenuComputerSections, initComputerMenu } from './ui/computer.js';

// Initialize connection overlays
import './ui/connection.js';

// Re-export toast functions for use by other modules
export { showError, showInfo, showWarning };

// ── DOM refs ──────────────────────────────────────────────

const roleBadge = document.getElementById('role-badge');
const playerCountEl = document.getElementById('player-count');
const turnIndicator = document.getElementById('turn-indicator');
const mouseModeEl = document.getElementById('mouse-mode');
const btnClaimDraw = document.getElementById('btn-claim-draw');
const menuOverlay = document.getElementById('menu-overlay');
const btnResume = document.getElementById('btn-resume');
const btnGiveUpSpot = document.getElementById('btn-give-up-spot');
const btnReconnectAsPlayer = document.getElementById('btn-reconnect-as-player');
const btnRestart = document.getElementById('btn-restart');
const btnConcede = document.getElementById('btn-concede');
const btnOfferDraw = document.getElementById('btn-offer-draw');
const promoOverlay = document.getElementById('promo-overlay');
const promoButtons = document.querySelectorAll('#promo-choices button');
const concedeOverlay = document.getElementById('concede-overlay');
const btnConcedeConfirm = document.getElementById('btn-concede-confirm');
const btnConcedeCancel = document.getElementById('btn-concede-cancel');

// Give up spot overlay
const giveUpSpotOverlay = document.getElementById('give-up-spot-overlay');
const btnGiveUpSpotConfirm = document.getElementById('btn-give-up-spot-confirm');
const btnGiveUpSpotCancel = document.getElementById('btn-give-up-spot-cancel');

const capturedWhitePieces = document.querySelector('#captured-white .cap-pieces');
const capturedBlackPieces = document.querySelector('#captured-black .cap-pieces');

// Import FEN overlay
const importFenOverlay = document.getElementById('import-fen-overlay');
const fenInput = document.getElementById('fen-input');
const btnImportFen = document.getElementById('btn-import-fen');
const btnImportFenConfirm = document.getElementById('btn-import-fen-confirm');
const btnImportFenCancel = document.getElementById('btn-import-fen-cancel');

// Game available banner button
const btnJoinGame = document.getElementById('btn-join-game');

// Draw offer overlay
const drawOfferOverlay = document.getElementById('draw-offer-overlay');
const drawOfferText = document.getElementById('draw-offer-text');
const btnDrawAccept = document.getElementById('btn-draw-accept');
const btnDrawDecline = document.getElementById('btn-draw-decline');

export let menuOpen = false;

// Track previous role so we can reposition the camera on join/reconnect
let prevRole = null;

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

export function updateMoveLog() {
  const el = document.getElementById('move-log');
  el.innerHTML = '';
  for (let i = 0; i < moveHistory.length; i += 2) {
    const num = Math.floor(i / 2) + 1;
    const w = moveHistory[i];
    const b = moveHistory[i + 1] || '';
    const row = document.createElement('div');
    const numEl = document.createElement('b');
    numEl.textContent = `${num}.`;
    row.appendChild(numEl);
    row.appendChild(document.createTextNode(` ${w} ${b}`));
    el.appendChild(row);
  }
  // Auto-scroll to bottom
  el.scrollTop = el.scrollHeight;
}

function updateDrawInfo() {
  const el = document.getElementById('draw-info');
  if (!el) return;

  const repLabel = threefoldCount > 0 ? `Repetition: ${threefoldCount}/3` : '';
  const fiftyLabel = halfmoveClock > 0 ? `50-move: ${halfmoveClock}/100` : '';
  const seventyFiveLabel = halfmoveClock >= 100 ? `75-move: ${halfmoveClock}/150` : '';

  if (!repLabel && !fiftyLabel && !seventyFiveLabel) {
    el.classList.remove('visible');
    return;
  }

  el.classList.add('visible');
  const parts = [repLabel, fiftyLabel, seventyFiveLabel].filter(Boolean);
  el.innerHTML = '';
  for (const part of parts) {
    el.appendChild(document.createTextNode(part));
    el.appendChild(document.createElement('br'));
  }
}

function updateClaimDrawButton() {
  if (!btnClaimDraw) return;
  if (canClaimDraw && myRole && myRole !== 'spectator' && !serverGameOver) {
    btnClaimDraw.classList.add('visible');
  } else {
    btnClaimDraw.classList.remove('visible');
  }
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

// ── Menu ─────────────────────────────────────────────────

export function showMenu() {
  menuOpen = true;
  menuOverlay.classList.add('visible');
  if (document.pointerLockElement) document.exitPointerLock();
  const isSpectator = myRole === 'spectator';
  const isPlayer = myRole === 'white' || myRole === 'black';

  // Give Up Spot button — visible only for players
  if (isPlayer) {
    btnGiveUpSpot.style.display = '';
    btnGiveUpSpot.disabled = false;
    btnReconnectAsPlayer.style.display = 'none';
  } else if (isSpectator) {
    btnGiveUpSpot.style.display = 'none';
    // Reconnect as Player — enabled only if at least one seat is truly free
    const whiteAvailable = seatStatus.white?.status === 'free';
    const blackAvailable = seatStatus.black?.status === 'free';
    btnReconnectAsPlayer.style.display = '';
    btnReconnectAsPlayer.disabled = !(whiteAvailable || blackAvailable);
  } else {
    btnGiveUpSpot.style.display = 'none';
    btnReconnectAsPlayer.style.display = 'none';
  }

  btnRestart.disabled = isSpectator;
  btnConcede.disabled = isSpectator || serverGameOver;
  btnImportFen.disabled = isSpectator;
  btnOfferDraw.disabled = !isPlayer || serverGameOver;

  // Delegate computer player sections to sub-module
  updateMenuComputerSections();
}

export function hideMenu() {
  menuOverlay.classList.remove('visible');
  menuOpen = false;
}

// Wire computer menu buttons so they can close the menu (avoids circular import)
initComputerMenu(hideMenu);

btnResume.addEventListener('click', () => {
  hideMenu();
});

// Reconnect as Player — spectator wants to join as a player
btnReconnectAsPlayer.addEventListener('click', () => {
  hideMenu();
  showJoinOverlay();
  updateJoinButtons();
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

// Claim draw button (on-screen, not in menu)
if (btnClaimDraw) {
  btnClaimDraw.addEventListener('click', () => {
    sendClaimDraw();
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

// ── Give up spot ─────────────────────────────────────────

export function showGiveUpSpotConfirm() {
  hideMenu();
  giveUpSpotOverlay.classList.add('visible');
}

export function hideGiveUpSpotConfirm() {
  giveUpSpotOverlay.classList.remove('visible');
}

btnGiveUpSpot.addEventListener('click', () => showGiveUpSpotConfirm());
btnGiveUpSpotConfirm.addEventListener('click', () => {
  if (myRole === 'white' || myRole === 'black') {
    localStorage.removeItem(tokenKey(myRole));
  }
  sendLeave();
  hideGiveUpSpotConfirm();
});
btnGiveUpSpotCancel.addEventListener('click', () => hideGiveUpSpotConfirm());

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
  updateClaimDrawButton();
  updateCapturedPieces(msg.capturedPieces);
  hideConcedeConfirm();
  hideGiveUpSpotConfirm();

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

  // Disconnected player banners (delegated to sub-module)
  syncDisconnectedBanners();

  // Join overlay (delegated to sub-module)
  if (!myRole) {
    showJoinOverlay();
    updateJoinButtons();
  } else {
    hideJoinOverlay();
  }
});

onRestart(() => {
  updateMoveLog();
  updateCapturedPieces(null);
  hidePromotionPicker();
  hideConcedeConfirm();
  hideGiveUpSpotConfirm();
  hideDrawOffer();
  document.getElementById('game-over-overlay').classList.remove('visible');
});

onError((msg) => {
  showError(msg.reason);
});

onInfo((msg) => {
  showInfo(msg.reason);
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

// Opponent left voluntarily — show info toast
onPlayerLeft((msg) => {
  const colorLabel = msg.color === 'white' ? 'White' : 'Black';
  showInfo(`${colorLabel} has left — their seat is now available`);
});

// FEN import warnings — show as yellow toast
onFenImportWarning((msg) => {
  if (msg.warnings && msg.warnings.length > 0) {
    showWarning(`FEN warning: ${msg.warnings[0]}`);
  }
});
