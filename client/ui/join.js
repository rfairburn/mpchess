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

// ── DOM refs ──────────────────────────────────────────────

const joinOverlay = document.getElementById('join-overlay');
const btnJoinWhite = document.getElementById('btn-join-white');
const btnJoinBlack = document.getElementById('btn-join-black');
const btnJoinSpectator = document.getElementById('btn-join-spectator');

// ── State ─────────────────────────────────────────────────

let joinCountdownTimer = null;

// Skill labels (must stay in sync with server)
const SKILL_LABELS = {
  beginner: 'Beginner',
  novice: 'Novice',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
  master: 'Master',
  grandmaster: 'Grandmaster',
};

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
  setJoinButton(btnJoinWhite, seatStatus.white, 'White');
  setJoinButton(btnJoinBlack, seatStatus.black, 'Black');
  btnJoinSpectator.disabled = false;
}

function setJoinButton(btn, seat, colorName) {
  const statusEl = btn.querySelector('.join-status');
  const color = colorName.toLowerCase();
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
      statusEl.textContent = 'Opening...';
    } else {
      statusEl.textContent = `${colorName} returns in ${remaining}s`;
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
