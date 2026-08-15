// ═══════════════════════════════════════════════════════════
//  UI — Evaluation bar (live Stockfish evaluation)
//  Desktop: vertical bar on the left edge (white at the bottom).
//  Mobile: wide horizontal bar at the bottom-center (white on the left).
//  Score is centipawns from the server (positive = white advantage);
//  null means no evaluation yet (bar renders neutral at 50%).
// ═══════════════════════════════════════════════════════════

import { serverEvaluation, onEvaluation, onStateUpdate, onRestart } from '../network.js';
import { t } from '../../shared/i18n.mjs';

// ── DOM refs ──────────────────────────────────────────────

const evalBar = document.getElementById('eval-bar');
const evalBarFill = document.getElementById('eval-bar-fill');
const evalBarMarker = document.getElementById('eval-bar-marker');
const evalScore = document.getElementById('eval-score');

const evalBarMobile = document.getElementById('eval-bar-mobile');
const evalBarMobileTrack = document.getElementById('eval-bar-mobile-track');
const evalScoreMobile = document.getElementById('eval-score-mobile');

// ── Score conversion ──────────────────────────────────────

const MATE_SCORE = 10000; // engine convention: mate → ±10000 centipawns
const BAR_RANGE_PAWNS = 10; // ±10 pawns spans the full bar

/**
 * Convert a centipawn score to a bar percentage (0 = black wins,
 * 100 = white wins). Null (no data) renders neutral at 50%.
 * @param {number|null} score - Centipawns, positive = white advantage
 * @returns {number} Percentage 0–100
 */
export function scoreToPercent(score) {
  if (score == null) return 50;
  if (score >= MATE_SCORE) return 100;
  if (score <= -MATE_SCORE) return 0;
  const pawns = score / 100;
  const clamped = Math.max(-BAR_RANGE_PAWNS, Math.min(BAR_RANGE_PAWNS, pawns));
  return 50 + (clamped / BAR_RANGE_PAWNS) * 50;
}

/**
 * Format a centipawn score for display: "+1.25", "-0.50", "0.00",
 * "M" (mate), or "–" when no evaluation is available.
 * @param {number|null} score - Centipawns, positive = white advantage
 * @returns {string} Display label
 */
export function scoreToLabel(score) {
  if (score == null) return '–';
  if (score >= MATE_SCORE) return 'M';
  if (score <= -MATE_SCORE) return '-M';
  const pawns = score / 100;
  const abs = Math.abs(pawns).toFixed(2);
  if (pawns > 0) return `+${abs}`;
  if (pawns < 0) return `-${abs}`;
  return abs;
}

// ── Rendering ─────────────────────────────────────────────

let currentScore = null;

function render() {
  const pct = scoreToPercent(currentScore);
  const label = scoreToLabel(currentScore);
  if (evalBarFill) evalBarFill.style.height = `${pct}%`;
  if (evalBarMarker) evalBarMarker.style.bottom = `${pct}%`;
  if (evalScore) evalScore.textContent = label;
  // Mobile fill/marker read --eval-pct so the same markup renders a
  // horizontal bar in portrait and a vertical bar in landscape.
  if (evalBarMobileTrack) evalBarMobileTrack.style.setProperty('--eval-pct', `${pct}%`);
  if (evalScoreMobile) evalScoreMobile.textContent = label;
}

function updateAriaLabels() {
  const label = t('ui.eval_bar');
  if (evalBar) evalBar.setAttribute('aria-label', label);
  if (evalBarMobile) evalBarMobile.setAttribute('aria-label', label);
}

function setScore(score) {
  currentScore = score;
  render();
}

// ── Callbacks ─────────────────────────────────────────────

onEvaluation((msg) => {
  setScore(msg.score ?? null);
});

// State messages carry the latest evaluation so new/reconnecting
// clients render the bar immediately.
onStateUpdate(() => {
  setScore(serverEvaluation);
});

onRestart(() => {
  setScore(null);
});

// Initial render (neutral until the first evaluation arrives)
updateAriaLabels();
render();

// ── Locale refresh ────────────────────────────────────────

export function refreshEvaluation() {
  updateAriaLabels();
}
