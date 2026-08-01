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
 * Add a square highlight. Replaces any existing highlight on the same square.
 */
export function addHighlight(file, rank, color) {
  if (file < 0 || file >= 8 || rank < 0 || rank >= 8) return;
  // Remove any existing highlight on the same square
  highlights = highlights.filter((h) => !(h.file === file && h.rank === rank));
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

export function onHighlightChange(callback) {
  callbacks.push(callback);
}
