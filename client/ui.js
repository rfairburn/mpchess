// ═══════════════════════════════════════════════════════════
//  UI — Core: HUD, menu, overlays, state sync, toasts
//  Sub-modules: ui/join.js, ui/disconnected.js, ui/computer.js, ui/connection.js
// ═══════════════════════════════════════════════════════════

/* global screen */

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
import { setCameraForRole, toggleMouseMode, setJoystickEnabled } from './controls.js';
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
const btnMenuToggle = domRef('btn-menu-toggle');
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

// ── Mobile tap targets ───────────────────────────────────

mouseModeEl.addEventListener('click', () => {
  if (menuOpen) return;
  toggleMouseMode();
});

btnMenuToggle.addEventListener('click', () => {
  if (menuOpen) {
    hideMenu();
  } else {
    showMenu();
  }
});

roleBadge.addEventListener('click', () => {
  if (menuOpen) return;
  showMenu();
});

// Close menu when clicking outside the menu box (mobile-native)
menuOverlay.addEventListener('click', (e) => {
  if (e.target === menuOverlay && menuOpen) {
    hideMenu();
  }
});

export let menuOpen = false;

// Track previous role so we can reposition the camera on join/reconnect
let prevRole = null;

// ── Mobile orientation helpers ───────────────────────────

function isMobilePhone() {
  const hasTouch =
    navigator.maxTouchPoints > 0 ||
    (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  return hasTouch && Math.min(window.innerWidth, window.innerHeight) <= 768;
}

let menuPriorOrientation = null;
let menuPortraitLocked = false;
let menuFullscreenEntered = false;
let gameLandscapeLocked = false;

// Generation counter to invalidate stale async orientation requests
let landscapeLockGen = 0;

async function lockOrientation(orientation) {
  if (!screen.orientation?.lock) return false;
  try {
    await screen.orientation.lock(orientation);
    return true;
  } catch {
    return false;
  }
}

// Centralized generation-guarded landscape request.
// All async landscape locks go through this to prevent stale state.
function requestGameLandscape() {
  const gen = ++landscapeLockGen;
  lockOrientation('landscape').then((ok) => {
    if (
      ok &&
      gen === landscapeLockGen &&
      document.fullscreenElement &&
      !menuOpen &&
      isMobilePhone()
    ) {
      gameLandscapeLocked = true;
    } else if (ok) {
      // Stale: state changed while awaiting — reconcile orientation
      if (menuOpen && isMobilePhone()) {
        lockOrientation('portrait').catch(() => {});
      } else if (!document.fullscreenElement || !isMobilePhone()) {
        lockOrientation(menuPriorOrientation || 'any').catch(() => {});
      }
    }
  });
}

async function tryEnterFullscreen() {
  if (!document.documentElement.requestFullscreen) return false;
  try {
    await document.documentElement.requestFullscreen();
    return document.fullscreenElement !== null;
  } catch {
    return false;
  }
}

// ── Fullscreen button (M3.0) ─────────────────────────────

const btnFullscreen = document.getElementById('btn-fullscreen');

// Hide button if Fullscreen API unavailable
if (btnFullscreen && !document.documentElement.requestFullscreen) {
  btnFullscreen.style.display = 'none';
}

// Use event delegation so the handler works even when the DOM is recreated
document.addEventListener('click', (e) => {
  const target = e.target;
  if (target instanceof HTMLElement && target.id === 'btn-fullscreen') {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }
});

// Update fullscreen button icon based on actual state
document.addEventListener('fullscreenchange', () => {
  const btn = document.getElementById('btn-fullscreen');
  if (document.fullscreenElement) {
    if (btn) {
      btn.textContent = '✕';
      btn.setAttribute('aria-label', 'Exit fullscreen');
    }
    // Lock landscape if not in menu (M3.1 extension)
    if (!menuOpen && isMobilePhone()) {
      requestGameLandscape();
    }
  } else {
    if (btn) {
      btn.textContent = '⛶';
      btn.setAttribute('aria-label', 'Toggle fullscreen');
    }
    // Increment generation to invalidate any pending landscape lock
    ++landscapeLockGen;
    // Release landscape lock when exiting fullscreen
    if (gameLandscapeLocked) {
      lockOrientation(menuPriorOrientation || 'any').catch(() => {});
      gameLandscapeLocked = false;
    }
  }
});

// Re-lock portrait if user rotates while menu is open
window.addEventListener('orientationchange', () => {
  if (menuOpen && menuPortraitLocked) {
    lockOrientation('portrait').catch(() => {});
  }
});

// ── M3.5.1 — Portrait HUD hiding ────────────────────────

function updatePortraitMobileClass() {
  if (!isMobilePhone()) {
    document.body.classList.remove('portrait-mobile');
    return;
  }
  if (window.innerWidth < window.innerHeight) {
    document.body.classList.add('portrait-mobile');
  } else {
    document.body.classList.remove('portrait-mobile');
  }
}

window.addEventListener('resize', updatePortraitMobileClass);
updatePortraitMobileClass();

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

// ── M4.0 — Virtual joystick toggle ──────────────────────

const joystickToggle = document.getElementById('joystick-toggle');
if (joystickToggle) {
  const saved = localStorage.getItem('virtualJoystick');
  const enabled = saved ? saved === 'true' : false;
  joystickToggle.checked = enabled;
  setJoystickEnabled(enabled);

  joystickToggle.addEventListener('change', () => {
    const state = joystickToggle.checked;
    localStorage.setItem('virtualJoystick', String(state));
    setJoystickEnabled(state);
  });
}

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

  // M3.5 — cap at last 6 move-pairs (rows) on mobile.
  // Always start on a white move (even index) so row alignment is correct.
  let moves;
  let offset;
  if (isMobilePhone()) {
    const totalRows = Math.ceil(moveHistory.length / 2);
    const firstRow = Math.max(1, totalRows - 5);
    const start = (firstRow - 1) * 2;
    moves = moveHistory.slice(start);
    offset = start;
  } else {
    moves = moveHistory;
    offset = 0;
  }

  for (let i = 0; i < moves.length; i += 2) {
    const num = Math.floor((offset + i) / 2) + 1;
    const w = moves[i];
    const b = moves[i + 1] || '';
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

export async function showMenu() {
  menuOpen = true;
  menuOverlay.classList.add('visible');
  if (document.pointerLockElement) document.exitPointerLock();

  // Invalidate any pending landscape lock from fullscreenchange handler
  ++landscapeLockGen;

  // Release landscape lock if active
  if (gameLandscapeLocked) {
    lockOrientation('any').catch(() => {});
    gameLandscapeLocked = false;
  }

  // M3.1 — force portrait on mobile
  if (isMobilePhone()) {
    menuFullscreenEntered = false;
    menuPortraitLocked = false;

    // Enter fullscreen if not already (required for orientation lock on many browsers)
    if (!document.fullscreenElement) {
      const entered = await tryEnterFullscreen();
      if (entered) menuFullscreenEntered = true;
      else return finishShowMenu(); // fallback: skip orientation lock
    }

    if (document.fullscreenElement) {
      menuPriorOrientation = screen.orientation?.type || null;
      const locked = await lockOrientation('portrait');
      if (locked) menuPortraitLocked = true;
    }
  }

  finishShowMenu();
}

function finishShowMenu() {
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

export async function hideMenu() {
  menuOverlay.classList.remove('visible');
  menuOpen = false;

  // Invalidate any pending landscape lock from fullscreenchange handler
  ++landscapeLockGen;

  // M3.1 — restore orientation
  if (menuPortraitLocked) {
    // Lock back to prior orientation (not unlock — that returns to device control)
    await lockOrientation(menuPriorOrientation || 'landscape').catch(() => {});
  }

  const enteredFullscreenForMenu = menuFullscreenEntered;

  if (menuFullscreenEntered) {
    // Await exit so we don't race with the fullscreenchange event
    await document.exitFullscreen().catch(() => {});
  }

  menuPortraitLocked = false;
  menuFullscreenEntered = false;
  menuPriorOrientation = null;

  // Lock landscape only if the user entered fullscreen independently
  // (not via the menu). Skip if we just exited menu-owned fullscreen.
  if (!enteredFullscreenForMenu && document.fullscreenElement && isMobilePhone()) {
    requestGameLandscape();
  }
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
