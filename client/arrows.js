// ═══════════════════════════════════════════════════════════
//  ARROWS — shared arrow annotation state (client-side only)
// ═══════════════════════════════════════════════════════════

let arrows = [];
let callbacks = [];

import { getAnnotationColor } from './annotation-colors.js';

/**
 * Determine arrow color from keyboard modifiers.
 * Priority: Ctrl > Alt > Shift.
 */
export function getArrowColor(event) {
  return getAnnotationColor(event);
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
  // Check for existing arrow with same from/to
  const existingIdx = arrows.findIndex(
    (a) =>
      a.from.file === from.file &&
      a.from.rank === from.rank &&
      a.to.file === to.file &&
      a.to.rank === to.rank
  );
  if (existingIdx !== -1) {
    if (arrows[existingIdx].color === color) {
      arrows.splice(existingIdx, 1);
    } else {
      arrows[existingIdx] = { from, to, color };
      const [moved] = arrows.splice(existingIdx, 1);
      arrows.push(moved);
    }
    for (const cb of callbacks) cb();
    return;
  }
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

/**
 * Remove an arrow by its from/to coordinates.
 * Returns true if an arrow was removed.
 */
export function removeArrow(fromFile, fromRank, toFile, toRank) {
  const idx = arrows.findIndex(
    (a) =>
      a.from.file === fromFile &&
      a.from.rank === fromRank &&
      a.to.file === toFile &&
      a.to.rank === toRank
  );
  if (idx !== -1) {
    arrows.splice(idx, 1);
    for (const cb of callbacks) cb();
    return true;
  }
  return false;
}

export function onArrowChange(callback) {
  callbacks.push(callback);
}
