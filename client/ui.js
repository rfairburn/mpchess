// ═══════════════════════════════════════════════════════════
//  UI — HUD overlays, menus, promotion picker, move log, etc.
// ═══════════════════════════════════════════════════════════

import {
  myRole, serverTurn, serverPromotingPiece, serverGameOver, serverGameResult,
  moveHistory, sendPromotion, sendRestart, sendConcede,
  onStateUpdate, onRestart, onError
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

let errorTimeout = null;
export let menuOpen = false;

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
