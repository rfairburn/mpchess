// ═══════════════════════════════════════════════════════════
//  HIGHLIGHTS — shared square highlight annotation state
//  (client-side only)
// ═══════════════════════════════════════════════════════════

let highlights = [];
let callbacks = [];

// Reuse the same color scheme as arrows
const COLORS = {
  none: '#ffdd00',
  ctrl: '#ff4444',
  alt: '#4488ff',
  shift: '#44cc44',
};

/**
 * Determine highlight color from keyboard modifiers.
 * Priority: Ctrl > Alt > Shift.
 */
export function getHighlightColor(event) {
  if (event.ctrlKey) return COLORS.ctrl;
  if (event.altKey) return COLORS.alt;
  if (event.shiftKey) return COLORS.shift;
  return COLORS.none;
}

/**
 * Add a square highlight.
 * Same color on same square removes it; different color replaces it.
 */
export function addHighlight(file, rank, color) {
  if (file < 0 || file >= 8 || rank < 0 || rank >= 8) return;
  const existingIdx = highlights.findIndex((h) => h.file === file && h.rank === rank);
  if (existingIdx !== -1) {
    if (highlights[existingIdx].color === color) {
      highlights.splice(existingIdx, 1);
    } else {
      highlights[existingIdx] = { file, rank, color };
    }
    for (const cb of callbacks) cb();
    return;
  }
  highlights.push({ file, rank, color });
  for (const cb of callbacks) cb();
}

export function clearHighlights() {
  highlights = [];
  for (const cb of callbacks) cb();
}

export function getHighlights() {
  return highlights;
}

/**
 * Remove a highlight by its file/rank coordinates.
 * Returns true if a highlight was removed.
 */
export function removeHighlight(file, rank) {
  const idx = highlights.findIndex((h) => h.file === file && h.rank === rank);
  if (idx !== -1) {
    highlights.splice(idx, 1);
    for (const cb of callbacks) cb();
    return true;
  }
  return false;
}

export function onHighlightChange(callback) {
  callbacks.push(callback);
}
