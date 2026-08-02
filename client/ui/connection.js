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
import { t } from '../i18n.js';

// ── DOM refs ──────────────────────────────────────────────

const reconnectingOverlay = document.getElementById('reconnecting-overlay');
const reconnectingStatus = document.getElementById('reconnecting-status');
const btnGiveUp = document.getElementById('btn-give-up');

const connectionErrorOverlay = document.getElementById('connection-error-overlay');
const connectionErrorMessage = document.getElementById('connection-error-message');
const btnRetryConnection = document.getElementById('btn-retry-connection');

// ── Reconnecting overlay ─────────────────────────────────

function showReconnectingOverlay(status) {
  reconnectingStatus.textContent = status || t('msg.reconnecting');
  reconnectingOverlay.classList.add('visible');
}

function hideReconnectingOverlay() {
  reconnectingOverlay.classList.remove('visible');
}

onReconnecting((data) => {
  if (data.maxAttemptsReached) {
    showReconnectingOverlay(t('msg.connection_lost'));
  } else {
    showReconnectingOverlay(t('msg.reconnecting'));
  }
});

onReconnected((data) => {
  hideReconnectingOverlay();
  if (data.rejoinAsNewPlayer) {
    showError(t('msg.seat_gone'));
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
  let message = t('msg.unreachable');
  if (code === 3) {
    message = t('msg.connection_refused');
  }
  showConnectionError(message);
});

onConnected(() => {
  hideConnectionError();
});
