// ═══════════════════════════════════════════════════════════
//  ARROWS — shared arrow annotation state (client-side only)
// ═══════════════════════════════════════════════════════════

let arrows = [];
let callbacks = [];

const COLORS = {
  none: '#ffdd00',
  ctrl: '#ff4444',
  alt: '#4488ff',
  shift: '#44cc44',
};

/**
 * Determine arrow color from keyboard modifiers.
 * Priority: Ctrl > Alt > Shift.
 */
export function getArrowColor(event) {
  if (event.ctrlKey) return COLORS.ctrl;
  if (event.altKey) return COLORS.alt;
  if (event.shiftKey) return COLORS.shift;
  return COLORS.none;
}

/**
 * Compute the arrow path vertices.
 * Knight moves get a two-segment path; everything else is straight.
 */
export function getArrowPath(from, to) {
  const df = to.file - from.file;
  const dr = to.rank - from.rank;
  if (Math.abs(df) + Math.abs(dr) === 3 && Math.min(Math.abs(df), Math.abs(dr)) === 1) {
    const bend = {
      file: from.file + (Math.abs(df) === 2 ? Math.sign(df) * 2 : 0),
      rank: from.rank + (Math.abs(dr) === 2 ? Math.sign(dr) * 2 : 0),
    };
    return [from, bend, to];
  }
  return [from, to];
}

export function addArrow(from, to, color) {
  if (from.file === to.file && from.rank === to.rank) return;
  arrows.push({ from, to, color });
  for (const cb of callbacks) cb();
}

export function clearArrows() {
  arrows = [];
  for (const cb of callbacks) cb();
}

export function getArrows() {
  return arrows;
}

export function onArrowChange(callback) {
  callbacks.push(callback);
}
