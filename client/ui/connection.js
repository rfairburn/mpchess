// ═══════════════════════════════════════════════════════════
//  UI — Connection overlays (reconnecting, connection error)
// ═══════════════════════════════════════════════════════════

import {
  tokenKey,
  onReconnecting,
  onReconnected,
  onConnectionError,
  onConnected,
  retryConnection,
} from '../network.js';
import { showError } from './toast.js';

// ── DOM refs ──────────────────────────────────────────────

const reconnectingOverlay = document.getElementById('reconnecting-overlay');
const reconnectingStatus = document.getElementById('reconnecting-status');
const btnGiveUp = document.getElementById('btn-give-up');

const connectionErrorOverlay = document.getElementById('connection-error-overlay');
const connectionErrorMessage = document.getElementById('connection-error-message');
const btnRetryConnection = document.getElementById('btn-retry-connection');

// ── Reconnecting overlay ─────────────────────────────────

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

// ── Give up button ───────────────────────────────────────

btnGiveUp.addEventListener('click', () => {
  localStorage.removeItem(tokenKey('white'));
  localStorage.removeItem(tokenKey('black'));
  window.location.reload();
});

// ── Connection error ─────────────────────────────────────

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
  let message = 'Unable to reach the server. Check your connection and try again.';
  if (code === 3) {
    message =
      'Connection to the server was refused. The server may be down or your origin is not allowed.';
  }
  showConnectionError(message);
});

onConnected(() => {
  hideConnectionError();
});
