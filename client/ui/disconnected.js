// ═══════════════════════════════════════════════════════════
//  UI — Disconnected banners, drop player, game available
// ═══════════════════════════════════════════════════════════

import {
  myRole,
  disconnectedPlayersInfo,
  sendDropPlayer,
  onPlayerDisconnected,
  onPlayerDropped,
  onGameAvailable,
} from '../network.js';

// ── DOM refs ──────────────────────────────────────────────

const opponentDisconnectedBanner = document.getElementById('opponent-disconnected-banner');
const opponentDisconnectedText = document.getElementById('opponent-disconnected-text');
const btnDropPlayer = document.getElementById('btn-drop-player');

const secondDisconnectedBanner = document.getElementById('second-disconnected-banner');
const secondDisconnectedText = document.getElementById('second-disconnected-text');

const gameAvailableBanner = document.getElementById('game-available-banner');

// ── State ─────────────────────────────────────────────────

let disconnectedOpponentToken = null;
let secondDisconnectedToken = null;

let dropButtonTimer = null;

// ── Parameterized spectator countdown ─────────────────────

function startSpectatorCountdown(textEl, timerRef, setTimerRef, color, disconnectedAt) {
  if (timerRef()) {
    clearInterval(timerRef());
    setTimerRef(null);
  }

  const enableTime = disconnectedAt + 60000;

  function updateText() {
    const remaining = Math.ceil((enableTime - Date.now()) / 1000);
    if (remaining <= 0) {
      textEl.textContent = buildDisconnectedText(color);
      if (timerRef()) {
        clearInterval(timerRef());
        setTimerRef(null);
      }
    } else {
      textEl.textContent = `${buildDisconnectedText(color)} — returns in ${remaining}s`;
    }
  }

  updateText();
  setTimerRef(setInterval(updateText, 1000));
}

function stopSpectatorCountdown(timerRef, setTimerRef) {
  if (timerRef()) {
    clearInterval(timerRef());
    setTimerRef(null);
  }
}

let firstTimer = null;
let secondTimer = null;

function getFirstTimer() {
  return firstTimer;
}
function setFirstTimer(v) {
  firstTimer = v;
}
function getSecondTimer() {
  return secondTimer;
}
function setSecondTimer(v) {
  secondTimer = v;
}

// ── Helpers ───────────────────────────────────────────────

function buildDisconnectedText(color) {
  const icon = color === 'white' ? '♔' : '♚';
  return `⚠ ${icon} ${color.charAt(0).toUpperCase() + color.slice(1)} disconnected`;
}

// ── Drop player countdown (players only) ─────────────────

function startDropButtonCountdown(disconnectedAt) {
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

// ── Banner show/hide ─────────────────────────────────────

export function showOpponentDisconnectedBanner(color, token, disconnectedAt) {
  disconnectedOpponentToken = token;
  opponentDisconnectedText.textContent = buildDisconnectedText(color);
  opponentDisconnectedBanner.classList.add('visible');
  if (myRole === 'white' || myRole === 'black') {
    btnDropPlayer.style.display = '';
    startDropButtonCountdown(disconnectedAt);
  } else {
    btnDropPlayer.style.display = 'none';
    startSpectatorCountdown(
      opponentDisconnectedText,
      getFirstTimer,
      setFirstTimer,
      color,
      disconnectedAt
    );
  }
}

export function hideOpponentDisconnectedBanner() {
  opponentDisconnectedBanner.classList.remove('visible');
  btnDropPlayer.style.display = ''; // reset for next time
  disconnectedOpponentToken = null;
  if (dropButtonTimer) {
    clearInterval(dropButtonTimer);
    dropButtonTimer = null;
  }
  stopSpectatorCountdown(getFirstTimer, setFirstTimer);
  hideSecondDisconnectedBanner();
}

export function showSecondDisconnectedBanner(color, token, disconnectedAt) {
  secondDisconnectedToken = token;
  secondDisconnectedText.textContent = buildDisconnectedText(color);
  secondDisconnectedBanner.classList.add('visible');
  startSpectatorCountdown(
    secondDisconnectedText,
    getSecondTimer,
    setSecondTimer,
    color,
    disconnectedAt
  );
}

export function hideSecondDisconnectedBanner() {
  secondDisconnectedBanner.classList.remove('visible');
  secondDisconnectedToken = null;
  stopSpectatorCountdown(getSecondTimer, setSecondTimer);
}

export function showGameAvailableBanner() {
  gameAvailableBanner.classList.add('visible');
}

export function hideGameAvailableBanner() {
  gameAvailableBanner.classList.remove('visible');
}

// ── Drop player button ───────────────────────────────────

btnDropPlayer.addEventListener('click', () => {
  if (disconnectedOpponentToken) {
    sendDropPlayer(disconnectedOpponentToken);
  }
});

// ── Callbacks ─────────────────────────────────────────────

onPlayerDisconnected((msg) => {
  hideGameAvailableBanner();
  if (myRole === 'spectator') {
    if (!disconnectedOpponentToken) {
      showOpponentDisconnectedBanner(msg.color, msg.token, msg.disconnectedAt);
    } else if (disconnectedOpponentToken !== msg.token) {
      showSecondDisconnectedBanner(msg.color, msg.token, msg.disconnectedAt);
    }
  } else {
    showOpponentDisconnectedBanner(msg.color, msg.token, msg.disconnectedAt);
  }
});

onPlayerDropped(() => {
  hideOpponentDisconnectedBanner();
  hideSecondDisconnectedBanner();
});

onGameAvailable(() => {
  showGameAvailableBanner();
  hideOpponentDisconnectedBanner();
  hideSecondDisconnectedBanner();
});

// ── Sync function called by ui.js on state updates ───────

export function syncDisconnectedBanners() {
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
          showSecondDisconnectedBanner(second.color, second.token, second.disconnectedAt);
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
