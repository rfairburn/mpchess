// ═══════════════════════════════════════════════════════════
//  SELECTION — shared piece selection state
//  (client-side only)
// ═══════════════════════════════════════════════════════════

let selectedSquare = null; // { file, rank } or null
let validMoves = [];
let selectionMode = 'legal'; // 'legal' (on-turn) | 'premove' (off-turn candidates)
let callbacks = [];

export function getSelectedSquare() {
  return selectedSquare;
}

export function getValidMovesList() {
  return validMoves;
}

/**
 * The mode of the current selection: 'legal' for a normal on-turn selection
 * (getValidMoves candidates) or 'premove' for an off-turn premove selection
 * (getPremoveMoves candidates). Renderers use this to distinguish premove
 * selection/candidate visuals from normal legal selection.
 * @returns {'legal'|'premove'}
 */
export function getSelectionMode() {
  return selectionMode;
}

/**
 * @param {{file: number, rank: number}|null} square
 * @param {Array} moves
 * @param {'legal'|'premove'} [mode] — selection mode (default 'legal')
 */
export function setSelectedSquare(square, moves, mode = 'legal') {
  selectedSquare = square;
  validMoves = moves;
  selectionMode = mode === 'premove' ? 'premove' : 'legal';
  for (const cb of callbacks) cb();
}

export function clearSelection() {
  selectedSquare = null;
  validMoves = [];
  selectionMode = 'legal';
  for (const cb of callbacks) cb();
}

export function onSelectionChange(callback) {
  callbacks.push(callback);
}
