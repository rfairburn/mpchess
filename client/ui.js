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
import {
  setCameraForRole,
  toggleMouseMode,
  setJoystickEnabled,
  clearHeldKeys,
} from './controls.js';
import { setMute, isMuted } from './sound.js';
import { CONTROLS_CONFIG } from './controls_config.js';
import { domRef, domRefOptional, domRefQuery } from './dom_ref.js';
import { isCoarsePointer, isMobilePhone, hasFullscreen } from './capabilities.js';
import { toggle2DBoard, renderBoard2D } from './board_2d.js';
import {
  getSvgPieceSet,
  setSvgPieceSet,
  getPieceAssetUrl,
  getModelSet,
  setModelSet,
  SVG_PIECE_SETS,
  MODEL_SETS,
  reloadPieceModels,
} from './pieces.js';

// ── Sub-modules (initialize their own callbacks) ─────────

import { showError, showInfo, showWarning } from './ui/toast.js';
import { syncDisconnectedBanners } from './ui/disconnected.js';
import { showJoinOverlay, hideJoinOverlay, updateJoinButtons } from './ui/join.js';
import { updateMenuComputerSections, initComputerMenu } from './ui/computer.js';

// Initialize connection overlays
import './ui/connection.js';

// Help overlay
import { showHelp, hideHelp, helpOpen, closeHelpForMenu } from './ui/help.js';
export { helpOpen, hideHelp };

// Settings overlay
import { reloadPage } from './navigation.js';

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

// ── Top bar refs (mobile landscape / short-height) ───────
const topBarRole = document.getElementById('top-bar-role');
const topBarTurn = document.getElementById('top-bar-turn');
const btnModeToggle = document.getElementById('btn-mode-toggle');
const btnStatusDrawer = document.getElementById('btn-status-drawer');
const statusDrawer = document.getElementById('status-drawer');
const drawerPlayerCount = document.getElementById('drawer-player-count');
const drawerCapturedWhitePieces = document.querySelector('#drawer-captured-white .cap-pieces');
const drawerCapturedBlackPieces = document.querySelector('#drawer-captured-black .cap-pieces');
const drawerMoveLog = document.getElementById('drawer-move-log');
const drawerDrawInfo = document.getElementById('drawer-draw-info');

let statusDrawerOpen = false;

function closeStatusDrawer() {
  statusDrawerOpen = false;
  if (statusDrawer) statusDrawer.classList.remove('open');
}
function toggleStatusDrawer() {
  statusDrawerOpen = !statusDrawerOpen;
  if (statusDrawerOpen) {
    if (statusDrawer) statusDrawer.classList.add('open');
  } else {
    if (statusDrawer) statusDrawer.classList.remove('open');
  }
}

// ── Top bar event handlers ───────────────────────────────
if (btnModeToggle) {
  btnModeToggle.addEventListener('click', () => {
    if (menuOpen) return;
    toggleMouseMode();
  });
}
if (btnStatusDrawer) {
  btnStatusDrawer.addEventListener('click', () => {
    toggleStatusDrawer();
  });
}

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

// Desktop menu toggle (inside #desktop-hud)
const btnMenuToggleDesktop = document.getElementById('btn-menu-toggle-desktop');
if (btnMenuToggleDesktop) {
  btnMenuToggleDesktop.addEventListener('click', () => {
    if (menuOpen) {
      hideMenu();
    } else {
      showMenu();
    }
  });
}
// Desktop fullscreen button is handled by the document-level delegated listener

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

// Store last captured pieces for re-rendering when piece set changes
let lastCapturedPieces = null;

// ── Mobile detection (from capabilities.js) ──────────────

// ── Fullscreen button (M3.0) ─────────────────────────────

const btnFullscreen = document.getElementById('btn-fullscreen');

// Hide button if Fullscreen API unavailable
if (btnFullscreen && !hasFullscreen()) {
  btnFullscreen.style.display = 'none';
}

// Use event delegation so the handler works even when the DOM is recreated
document.addEventListener('click', (e) => {
  const target = e.target;
  if (
    target instanceof HTMLElement &&
    (target.id === 'btn-fullscreen' || target.id === 'btn-fullscreen-desktop')
  ) {
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
  const btnDesktop = document.getElementById('btn-fullscreen-desktop');
  if (document.fullscreenElement) {
    if (btn) {
      btn.textContent = '✕';
      btn.setAttribute('aria-label', 'Exit fullscreen');
    }
    if (btnDesktop) {
      btnDesktop.textContent = '✕';
      btnDesktop.setAttribute('aria-label', 'Exit fullscreen');
    }
  } else {
    if (btn) {
      btn.textContent = '⛶';
      btn.setAttribute('aria-label', 'Toggle fullscreen');
    }
    if (btnDesktop) {
      btnDesktop.textContent = '⛶';
      btnDesktop.setAttribute('aria-label', 'Toggle fullscreen');
    }
  }
});

// ── Sound toggle button ──────────────────────────────────

// Sync button icons with persisted mute state on page load
function updateSoundButtons() {
  const icon = isMuted() ? '🔇' : '🔊';
  const label = isMuted() ? 'Enable sound' : 'Mute sound';
  const btn = document.getElementById('btn-sound');
  const btnDesktop = document.getElementById('btn-sound-desktop');
  if (btn) {
    btn.textContent = icon;
    btn.setAttribute('aria-label', label);
  }
  if (btnDesktop) {
    btnDesktop.textContent = icon;
    btnDesktop.setAttribute('aria-label', label);
  }
}

document.addEventListener('click', (e) => {
  const target = e.target;
  if (
    target instanceof HTMLElement &&
    (target.id === 'btn-sound' || target.id === 'btn-sound-desktop')
  ) {
    setMute(!isMuted());
    updateSoundButtons();
  }
});

// Apply saved mute state to button icons on load
updateSoundButtons();

// ── 2D Board toggle ──────────────────────────────────────

document.addEventListener('click', (e) => {
  const target = e.target;
  if (
    target instanceof HTMLElement &&
    (target.id === 'btn-board-2d' || target.id === 'btn-board-2d-desktop')
  ) {
    toggle2DBoard();
  }
});

// ── M3.5.1 — Portrait HUD hiding ────────────────────────

// Returns true when the compact top-bar layout is active in landscape.
// Mirrors the CSS breakpoints:
//   @media (pointer: coarse) and (max-height: 480px)
//   @media (pointer: coarse) and (orientation: landscape) and (max-width: 900px)
// Uses isCoarsePointer() to match the CSS (pointer: coarse) media query,
// consistent with isMobileLayout() in capabilities.js.
function isCompactLandscapeActive() {
  if (!isCoarsePointer()) return false;
  // Short-height (any orientation)
  if (window.innerHeight <= 480) return true;
  // Landscape phone (max-width 900px)
  if (window.innerWidth > window.innerHeight && window.innerWidth <= 900) return true;
  return false;
}

let portraitMobileInitialized = false;
let prevCompactLandscape = false;

function updatePortraitMobileClass() {
  const wasPortrait = document.body.classList.contains('portrait-mobile');
  const wasCompactLandscape = prevCompactLandscape;

  if (!isMobilePhone()) {
    document.body.classList.remove('portrait-mobile');
  } else if (window.innerWidth < window.innerHeight) {
    document.body.classList.add('portrait-mobile');
  } else {
    document.body.classList.remove('portrait-mobile');
  }

  const isPortrait = document.body.classList.contains('portrait-mobile');
  const isCompactLandscape = isCompactLandscapeActive();
  prevCompactLandscape = isCompactLandscape;

  // Close drawer when:
  // 1. Entering portrait (toggle button is hidden)
  // 2. Leaving compact landscape entirely (not mobile, or viewport too large)
  // Skip on initial call to avoid closing a drawer the test/user hasn't opened yet.
  if (portraitMobileInitialized) {
    if (
      (!wasPortrait && isPortrait) ||
      (wasCompactLandscape && !isCompactLandscape && !isPortrait)
    ) {
      closeStatusDrawer();
    }
  }
  portraitMobileInitialized = true;
}

window.addEventListener('resize', updatePortraitMobileClass);
updatePortraitMobileClass();

// ── Mouse sensitivity (persisted, used by controls.js) ──
// Logarithmic scale: slider 1–100 maps to ~0.0002–~0.004.
// Linear mapping (v * 0.0001) gave 0.0001–0.01, where the upper end was
// too fast for most users.  The exponential curve keeps low values precise
// and caps the top at a comfortable speed.
// Constants are defined in CONTROLS_CONFIG (controls.js).

export let mouseSensitivity = parseFloat(
  localStorage.getItem('mouseSensitivity') || String(CONTROLS_CONFIG.defaultMouseSensitivity)
);

function sliderToSens(v) {
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
  const { sensitivityMin, sensitivitySliderMin, sensitivitySliderMax, sensitivitySliderBase } =
    CONTROLS_CONFIG;
  return Math.round(
    sensitivitySliderMin +
      ((sensitivitySliderMax - sensitivitySliderMin) * Math.log(s / sensitivityMin)) /
        Math.log(sensitivitySliderBase)
  );
}

// ── Settings overlay ─────────────────────────────────────

const settingsOverlay = document.getElementById('settings-overlay');
const btnSettings = document.getElementById('btn-settings');
const btnSettingsClose = document.getElementById('btn-settings-close');
const sensitivitySlider = document.getElementById('sensitivity-slider');
const sensitivityValue = document.getElementById('sensitivity-value');
const joystickToggle = document.getElementById('joystick-toggle');
const select2dSet = document.getElementById('select-2d-set');
const select3dSet = document.getElementById('select-3d-set');

export let settingsOpen = false;

// Three.js scene reference — set by app.js for in-place model reload
let _threeScene = null;
export function setThreeScene(scene) {
  _threeScene = scene;
}

// Focus management for settings overlay
let _settingsPreviousFocus = null;
let _settingsCloseCallback = null;

function isActuallyVisible(element) {
  if (!element?.isConnected || element.disabled) return false;
  const style = window.getComputedStyle(element);
  return (
    style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0
  );
}

function settingsTrapHandler(event) {
  if (event.key !== 'Tab') return;
  if (!settingsOverlay) return;
  const allFocusable = settingsOverlay.querySelectorAll(
    'button, [href], input, select, [tabindex]:not([tabindex="-1"])'
  );
  const focusable = Array.from(allFocusable).filter(isActuallyVisible);
  if (focusable.length === 0) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  }
}

// Populate model set dropdowns
if (select2dSet) {
  for (const setName of SVG_PIECE_SETS) {
    const opt = document.createElement('option');
    opt.value = setName;
    opt.textContent = setName;
    select2dSet.appendChild(opt);
  }
}
if (select3dSet) {
  for (const setName of MODEL_SETS) {
    const opt = document.createElement('option');
    opt.value = setName;
    opt.textContent = setName;
    select3dSet.appendChild(opt);
  }
}

// Initialize sensitivity slider from saved value
if (sensitivitySlider && sensitivityValue) {
  sensitivitySlider.value = sensToSlider(mouseSensitivity);
  sensitivityValue.textContent = sensitivitySlider.value;
}

// Initialize joystick toggle
{
  const saved = localStorage.getItem('virtualJoystick');
  const isMobile = navigator.maxTouchPoints > 0;
  const enabled = saved ? saved === 'true' : isMobile;
  if (joystickToggle) joystickToggle.checked = enabled;
  setJoystickEnabled(enabled);
}

// Initialize model set dropdowns from saved values
{
  const saved2d = localStorage.getItem('svgPieceSet');
  if (saved2d && SVG_PIECE_SETS.includes(saved2d)) {
    setSvgPieceSet(saved2d);
    if (select2dSet) select2dSet.value = saved2d;
  } else if (select2dSet) {
    select2dSet.value = getSvgPieceSet();
  }
  const saved3d = localStorage.getItem('modelSet');
  if (saved3d && MODEL_SETS.includes(saved3d)) {
    setModelSet(saved3d);
    if (select3dSet) select3dSet.value = saved3d;
  } else if (select3dSet) {
    select3dSet.value = getModelSet();
  }
}

// Sensitivity slider handler
if (sensitivitySlider && sensitivityValue) {
  sensitivitySlider.addEventListener('input', () => {
    const v = parseInt(sensitivitySlider.value, 10);
    mouseSensitivity = sliderToSens(v);
    sensitivityValue.textContent = v;
    localStorage.setItem('mouseSensitivity', String(mouseSensitivity));
  });
}

// Joystick toggle handler
if (joystickToggle) {
  joystickToggle.addEventListener('change', () => {
    const state = joystickToggle.checked;
    localStorage.setItem('virtualJoystick', String(state));
    setJoystickEnabled(state);
  });
}

// 2D piece set change handler
if (select2dSet) {
  select2dSet.addEventListener('change', () => {
    const val = select2dSet.value;
    setSvgPieceSet(val);
    localStorage.setItem('svgPieceSet', val);
    // Re-render captured pieces with new set
    if (lastCapturedPieces) updateCapturedPieces(lastCapturedPieces);
    // Re-render 2D board if visible
    renderBoard2D();
  });
}

// 3D model set change handler
if (select3dSet) {
  select3dSet.addEventListener('change', () => {
    const val = select3dSet.value;
    setModelSet(val);
    localStorage.setItem('modelSet', val);
    // Reload 3D models in-place
    if (_threeScene) {
      reloadPieceModels(_threeScene, () => {});
    }
  });
}

export function showSettings(onClose) {
  if (!settingsOverlay) return;
  _settingsPreviousFocus = document.activeElement;
  _settingsCloseCallback = onClose || null;
  settingsOpen = true;
  settingsOverlay.classList.add('visible');
  settingsOverlay.addEventListener('keydown', settingsTrapHandler);
  // Clear held movement keys so WASD doesn't affect the game
  clearHeldKeys();
  // Focus the close button for keyboard accessibility
  if (btnSettingsClose) btnSettingsClose.focus();
}

export function hideSettings() {
  if (!settingsOverlay || !settingsOpen) return;

  const focusTarget = _settingsPreviousFocus;
  const restoreUi = _settingsCloseCallback;
  _settingsPreviousFocus = null;
  _settingsCloseCallback = null;
  settingsOpen = false;
  settingsOverlay.classList.remove('visible');
  settingsOverlay.removeEventListener('keydown', settingsTrapHandler);

  // Restore UI state first (e.g. show menu), then restore focus
  if (restoreUi) restoreUi();

  // Focus the previously focused element if visible, otherwise fall back
  if (focusTarget && isActuallyVisible(focusTarget)) {
    focusTarget.focus();
  } else if (btnSettings && isActuallyVisible(btnSettings)) {
    btnSettings.focus();
  }
}

// Settings button click handler
if (btnSettings) {
  btnSettings.addEventListener('click', () => {
    hideMenu();
    showSettings(showMenu);
  });
}

// Settings close button
if (btnSettingsClose) {
  btnSettingsClose.addEventListener('click', () => {
    hideSettings();
  });
}

// Close settings when clicking outside the box
if (settingsOverlay) {
  settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay && settingsOpen) {
      hideSettings();
    }
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
    if (btnModeToggle) btnModeToggle.textContent = '🖱';
  } else {
    mouseModeEl.textContent = '♟ Piece Mode';
    mouseModeEl.style.borderColor = 'rgba(68, 187, 68, 0.6)';
    hud.textContent = 'Click to move pieces · TAB toggle mouse-look · ESC menu';
    if (btnModeToggle) btnModeToggle.textContent = '♟';
  }
}

function updateRoleBadge() {
  const roleText = myRole === 'white' ? '♔ White' : myRole === 'black' ? '♚ Black' : '👁 Spectator';
  roleBadge.textContent = roleText;
  roleBadge.className = myRole;
  if (topBarRole) {
    topBarRole.textContent = roleText;
    topBarRole.className = myRole;
  }
}

function updatePlayerCount(players, spectators) {
  const text = `Players: ${players} · Spectators: ${spectators}`;
  playerCountEl.textContent = text;
  if (drawerPlayerCount) drawerPlayerCount.textContent = text;
}

function updateTurnIndicator() {
  const isWhite = serverTurn === 'white';
  const text = isWhite ? "⬤ White's Turn" : "⬤ Black's Turn";
  const cls = isWhite ? 'white-turn' : 'black-turn';
  turnIndicator.textContent = text;
  turnIndicator.className = cls;
  if (topBarTurn) {
    topBarTurn.textContent = text;
    topBarTurn.className = cls;
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

  // Also update the drawer move log
  if (drawerMoveLog) {
    drawerMoveLog.innerHTML = el.innerHTML;
    drawerMoveLog.scrollTop = drawerMoveLog.scrollHeight;
  }
}

function updateDrawInfo() {
  const el = domRefOptional('draw-info');
  if (!el) return;

  const repLabel = threefoldCount > 0 ? `Repetition: ${threefoldCount}/3` : '';
  const fiftyLabel = halfmoveClock > 0 ? `50-move: ${halfmoveClock}/100` : '';
  const seventyFiveLabel = halfmoveClock >= 100 ? `75-move: ${halfmoveClock}/150` : '';

  const hasInfo = repLabel || fiftyLabel || seventyFiveLabel;

  if (!hasInfo) {
    el.classList.remove('visible');
    if (drawerDrawInfo) drawerDrawInfo.classList.remove('visible');
    return;
  }

  el.classList.add('visible');
  const parts = [repLabel, fiftyLabel, seventyFiveLabel].filter(Boolean);
  el.innerHTML = '';
  for (const part of parts) {
    el.appendChild(document.createTextNode(part));
    el.appendChild(document.createElement('br'));
  }

  // Also update the drawer draw info
  if (drawerDrawInfo) {
    drawerDrawInfo.classList.add('visible');
    drawerDrawInfo.innerHTML = el.innerHTML;
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

const CAPTURE_ORDER = { queen: 0, rook: 1, bishop: 2, knight: 3, pawn: 4 };

const CAPTURE_TYPE_TO_LETTER = {
  pawn: 'P',
  knight: 'N',
  bishop: 'B',
  rook: 'R',
  queen: 'Q',
};

/**
 * Get the asset URL for a captured piece by type and color.
 * @param {string} type - pawn, knight, bishop, rook, queen
 * @param {string} color - white, black
 * @returns {string}
 */
function capturePieceSvg(type, color) {
  const letter = CAPTURE_TYPE_TO_LETTER[type];
  if (!letter) return '';
  const file = `${color[0]}${letter}`;
  return getPieceAssetUrl(file);
}

/**
 * Render captured pieces as SVG images into a container element.
 * @param {HTMLElement} container
 * @param {string[]} pieceTypes - array of piece types (queen, rook, etc.)
 */
function renderCaptureImages(container, pieceTypes) {
  container.innerHTML = '';
  for (const type of [...pieceTypes].sort(
    (a, b) => (CAPTURE_ORDER[a] ?? 99) - (CAPTURE_ORDER[b] ?? 99)
  )) {
    const img = document.createElement('img');
    img.className = 'cap-piece';
    img.src = capturePieceSvg(type, colorForContainer(container));
    img.alt = type;
    img.draggable = false;
    container.appendChild(img);
  }
}

/**
 * Determine the piece color to display based on which container is being rendered.
 * capturedWhitePieces shows black pieces (captured BY white), and vice versa.
 * @param {HTMLElement} container
 * @returns {string}
 */
function colorForContainer(container) {
  return container === capturedBlackPieces || container === drawerCapturedBlackPieces
    ? 'white'
    : 'black';
}

export function updateCapturedPieces(captured) {
  if (!captured) {
    capturedWhitePieces.innerHTML = '';
    capturedBlackPieces.innerHTML = '';
    if (drawerCapturedWhitePieces) drawerCapturedWhitePieces.innerHTML = '';
    if (drawerCapturedBlackPieces) drawerCapturedBlackPieces.innerHTML = '';
    return;
  }
  renderCaptureImages(capturedWhitePieces, captured.white);
  renderCaptureImages(capturedBlackPieces, captured.black);
  if (drawerCapturedWhitePieces) renderCaptureImages(drawerCapturedWhitePieces, captured.white);
  if (drawerCapturedBlackPieces) renderCaptureImages(drawerCapturedBlackPieces, captured.black);
}

// ── Menu ─────────────────────────────────────────────────

export function showMenu() {
  menuOpen = true;
  menuOverlay.classList.add('visible');
  if (document.pointerLockElement) document.exitPointerLock();
  // Close status drawer, help overlay, and settings when menu is opened
  closeStatusDrawer();
  closeHelpForMenu();
  hideSettings();
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
  reloadPage();
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

// Help button
const btnHelp = domRefOptional('btn-help');
if (btnHelp) {
  btnHelp.addEventListener('click', openHelpFromMenu);
}

// Production function for opening Help from the menu.
// Hides the menu, clears held movement keys, then shows Help with showMenu as close callback.
export function openHelpFromMenu() {
  hideMenu();
  clearHeldKeys();
  showHelp(showMenu);
}
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
  lastCapturedPieces = msg.capturedPieces;
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
