// ═══════════════════════════════════════════════════════════
//  SELECTION — shared piece selection state
//  (client-side only)
// ═══════════════════════════════════════════════════════════

let selectedSquare = null; // { file, rank } or null
let validMoves = [];
let callbacks = [];

export function getSelectedSquare() {
  return selectedSquare;
}

export function getValidMovesList() {
  return validMoves;
}

export function setSelectedSquare(square, moves) {
  selectedSquare = square;
  validMoves = moves;
  for (const cb of callbacks) cb();
}

export function clearSelection() {
  selectedSquare = null;
  validMoves = [];
  for (const cb of callbacks) cb();
}

export function onSelectionChange(callback) {
  callbacks.push(callback);
}
