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
import { CONTROLS_CONFIG } from './controls_config.js';
import { domRef, domRefOptional, domRefQuery } from './dom_ref.js';

// ── Sub-modules (initialize their own callbacks) ─────────

import { showError, showInfo, showWarning } from './ui/toast.js';
import { syncDisconnectedBanners } from './ui/disconnected.js';
import { showJoinOverlay, hideJoinOverlay, updateJoinButtons } from './ui/join.js';
import { updateMenuComputerSections, initComputerMenu } from './ui/computer.js';

// Initialize connection overlays
import './ui/connection.js';

// Re-export toast functions for use by other modules
export { showError, showInfo, showWarning };

// ── DOM refs (validated via dom_ref.js) ───────────────────

const roleBadge = domRef('role-badge');
const playerCountEl = domRef('player-count');
const turnIndicator = domRef('turn-indicator');
const mouseModeEl = domRef('mouse-mode');
const btnClaimDraw = domRefOptional('btn-claim-draw');
const menuOverlay = domRef('menu-overlay');
const btnResume = domRef('btn-resume');
const btnGiveUpSpot = domRef('btn-give-up-spot');
const btnReconnectAsPlayer = domRef('btn-reconnect-as-player');
const btnRestart = domRef('btn-restart');
const btnConcede = domRef('btn-concede');
const btnOfferDraw = domRef('btn-offer-draw');
const promoOverlay = domRef('promo-overlay');
const promoButtons = document.querySelectorAll('#promo-choices button');
const concedeOverlay = domRef('concede-overlay');
const btnConcedeConfirm = domRef('btn-concede-confirm');
const btnConcedeCancel = domRef('btn-concede-cancel');

// Give up spot overlay
const giveUpSpotOverlay = domRef('give-up-spot-overlay');
const btnGiveUpSpotConfirm = domRef('btn-give-up-spot-confirm');
const btnGiveUpSpotCancel = domRef('btn-give-up-spot-cancel');

const capturedWhitePieces = domRefQuery('#captured-white .cap-pieces');
const capturedBlackPieces = domRefQuery('#captured-black .cap-pieces');

// Import FEN overlay
const importFenOverlay = domRef('import-fen-overlay');
const fenInput = domRef('fen-input');
const btnImportFen = domRef('btn-import-fen');
const btnImportFenConfirm = domRef('btn-import-fen-confirm');
const btnImportFenCancel = domRef('btn-import-fen-cancel');

// Game available banner button
const btnJoinGame = domRef('btn-join-game');

// Draw offer overlay
const drawOfferOverlay = domRef('draw-offer-overlay');
const drawOfferText = domRef('draw-offer-text');
const btnDrawAccept = domRef('btn-draw-accept');
const btnDrawDecline = domRef('btn-draw-decline');

export let menuOpen = false;

// Track previous role so we can reposition the camera on join/reconnect
let prevRole = null;

// ── Mouse sensitivity ────────────────────────────────────
// Logarithmic scale: slider 1–100 maps to ~0.0002–~0.004.
// Linear mapping (v * 0.0001) gave 0.0001–0.01, where the upper end was
// too fast for most users.  The exponential curve keeps low values precise
// and caps the top at a comfortable speed.
// Constants are defined in CONTROLS_CONFIG (controls.js).

const sensitivitySlider = domRef('sensitivity-slider');
const sensitivityValue = domRef('sensitivity-value');
export let mouseSensitivity = parseFloat(
  localStorage.getItem('mouseSensitivity') || String(CONTROLS_CONFIG.defaultMouseSensitivity)
);

function sliderToSens(v) {
  // Exponential: sliderMin → sensitivityMin, sliderMax → sensitivityMax
  const { sensitivityMin, sensitivitySliderMin, sensitivitySliderMax, sensitivitySliderBase } =
    CONTROLS_CONFIG;
  return (
    sensitivityMin *
    Math.pow(
      sensitivitySliderBase,
      (v - sensitivitySliderMin) / (sensitivitySliderMax - sensitivitySliderMin)
    )
  );
}
function sensToSlider(s) {
  // Inverse of sliderToSens
  const { sensitivityMin, sensitivitySliderMin, sensitivitySliderMax, sensitivitySliderBase } =
    CONTROLS_CONFIG;
  return Math.round(
    sensitivitySliderMin +
      ((sensitivitySliderMax - sensitivitySliderMin) * Math.log(s / sensitivityMin)) /
        Math.log(sensitivitySliderBase)
  );
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
  const hud = domRef('hud');
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
  const el = domRef('move-log');
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
  const el = domRefOptional('draw-info');
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
const btnExportFen = domRef('btn-export-fen');
const btnExportPgn = domRef('btn-export-pgn');

btnExportFen.addEventListener('click', () => {
  sendExportFen();
});

btnExportPgn.addEventListener('click', () => {
  sendExportPgn();
});

const btnNewGame = domRef('btn-new-game');
const gameOverOverlay = domRef('game-over-overlay');
const gameOverText = domRef('game-over-text');

btnNewGame.addEventListener('click', () => {
  if (myRole === 'spectator') return;
  sendRestart();
  gameOverOverlay.classList.remove('visible');
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
    gameOverText.textContent = serverGameResult;
    btnNewGame.disabled = myRole === 'spectator';
    gameOverOverlay.classList.add('visible');
  } else {
    btnNewGame.disabled = false;
    gameOverOverlay.classList.remove('visible');
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
  gameOverOverlay.classList.remove('visible');
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
