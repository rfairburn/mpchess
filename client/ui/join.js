// ═══════════════════════════════════════════════════════════
//  UI — Join selection overlay
// ═══════════════════════════════════════════════════════════

import {
  myRole,
  seatStatus,
  validatedTokens,
  sendJoin,
  onConnected,
  onReconnectFailed,
  onLeft,
} from '../network.js';
import { getSkillLabel } from '../constants.js';
import { t } from '../../shared/i18n.mjs';

// ── DOM refs ──────────────────────────────────────────────

const joinOverlay = document.getElementById('join-overlay');
const btnJoinWhite = document.getElementById('btn-join-white');
const btnJoinBlack = document.getElementById('btn-join-black');
const btnJoinSpectator = document.getElementById('btn-join-spectator');

// ── State ─────────────────────────────────────────────────

let joinCountdownTimer = null;

// ── Join overlay ──────────────────────────────────────────

export function showJoinOverlay() {
  joinOverlay.classList.add('visible');
}

export function hideJoinOverlay() {
  joinOverlay.classList.remove('visible');
  if (joinCountdownTimer) {
    clearInterval(joinCountdownTimer);
    joinCountdownTimer = null;
  }
}

export function updateJoinButtons() {
  setJoinButton(btnJoinWhite, seatStatus.white, 'white', t('color.white'));
  setJoinButton(btnJoinBlack, seatStatus.black, 'black', t('color.black'));
  btnJoinSpectator.disabled = false;
}

function setJoinButton(btn, seat, colorId, colorName) {
  const statusEl = btn.querySelector('.join-status');
  const canReconnect = validatedTokens[colorId] === true;

  if (canReconnect && seat && (seat.status === 'held' || seat.status === 'occupied')) {
    btn.disabled = false;
    statusEl.textContent = t('ui.seat_held');
  } else if (!seat || seat.status === 'unknown') {
    btn.disabled = true;
    statusEl.textContent = t('ui.seat_loading');
  } else if (seat.status === 'free') {
    btn.disabled = false;
    statusEl.textContent = t('ui.seat_free');
  } else if (seat.status === 'occupied') {
    btn.disabled = true;
    statusEl.textContent = t('ui.seat_occupied');
  } else if (seat.status === 'computer') {
    btn.disabled = true;
    const skillLabel = getSkillLabel(seat.skill);
    statusEl.textContent = t('ui.seat_computer', { skill: skillLabel });
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
      statusEl.textContent = t('ui.seat_opening');
    } else {
      statusEl.textContent = t('ui.seat_returning', { colorName, remaining });
    }
  }

  tick();
  joinCountdownTimer = setInterval(tick, 1000);
}

// ── Button click handlers ─────────────────────────────────

btnJoinWhite.addEventListener('click', () => {
  sendJoin('white');
});

btnJoinBlack.addEventListener('click', () => {
  sendJoin('black');
});

btnJoinSpectator.addEventListener('click', () => {
  sendJoin('spectator');
});

// ── Callbacks ─────────────────────────────────────────────

// Show join overlay immediately on connection (before state arrives)
onConnected(() => {
  if (!myRole) {
    showJoinOverlay();
    updateJoinButtons();
  }
});

onReconnectFailed(() => {
  showJoinOverlay();
  updateJoinButtons();
});

onLeft(() => {
  showJoinOverlay();
  updateJoinButtons();
});
