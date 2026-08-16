// ═══════════════════════════════════════════════════════════
//  PREMOVE — shared pending-premove state
//  (client-side only)
// ═══════════════════════════════════════════════════════════

let premove = null; // { fromFile, fromRank, toFile, toRank, promotion } or null
let callbacks = [];

// Normalize a raw premove value (server echo / state field) into the
// canonical stored shape. Malformed values (missing/non-integer/out-of-range
// coordinates) normalize to null so the client never holds garbage state.
// All four coordinates must be integers in 0-7: an out-of-range destination
// in particular would otherwise let a renderer place a ghost off-board (3D)
// or wrap the grid index onto a wrong square (2D).
function normalizePremove(value) {
  if (!value) return null;
  const { fromFile, fromRank, toFile, toRank } = value;
  const inRange = (v) => Number.isInteger(v) && v >= 0 && v <= 7;
  if (![fromFile, fromRank, toFile, toRank].every(inRange)) return null;
  const promotion =
    typeof value.promotion === 'string' && value.promotion !== '' ? value.promotion : null;
  return { fromFile, fromRank, toFile, toRank, promotion };
}

function samePremove(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.fromFile === b.fromFile &&
    a.fromRank === b.fromRank &&
    a.toFile === b.toFile &&
    a.toRank === b.toRank &&
    a.promotion === b.promotion
  );
}

function notify() {
  for (const cb of callbacks) cb();
}

export function getPremove() {
  return premove;
}

// Set (or replace) the pending premove. Passing null/undefined clears.
// Subscribers are notified only when the normalized value actually changes.
export function setPremove(value) {
  const next = normalizePremove(value);
  if (samePremove(next, premove)) return;
  premove = next;
  notify();
}

export function clearPremove() {
  if (premove === null) return;
  premove = null;
  notify();
}

export function onPremoveChange(callback) {
  callbacks.push(callback);
}
