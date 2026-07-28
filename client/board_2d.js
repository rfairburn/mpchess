// ═══════════════════════════════════════════════════════════
//  2D BOARD — live board overlay (read-only, phase 1)
// ═══════════════════════════════════════════════════════════

import { onStateUpdate, onRestart, myRole, serverBoard } from './network.js';
import { isTouchDevice } from './capabilities.js';

// Unicode chess pieces — all dark (filled) variants; color via CSS
const PIECE_SYMBOLS = {
  1: '\u265F', // W_PAWN  ♟
  2: '\u265E', // W_KNIGHT ♞
  3: '\u265D', // W_BISHOP ♝
  4: '\u265C', // W_ROOK  ♜
  5: '\u265B', // W_QUEEN ♛
  6: '\u265A', // W_KING  ♚
  7: '\u265F', // B_PAWN  ♟
  8: '\u265E', // B_KNIGHT ♞
  9: '\u265D', // B_BISHOP ♝
  10: '\u265C', // B_ROOK  ♜
  11: '\u265B', // B_QUEEN ♛
  12: '\u265A', // B_KING  ♚
};

let boardEl = null;
// 0 = off, 1 = small (top-right), 2 = fullscreen (centered)
let mode = 0;

/**
 * Get the orientation for the 2D board based on role.
 * White: rank 8 at top, rank 1 at bottom (standard).
 * Black: rank 1 at top, rank 8 at bottom (flipped).
 * Spectator: same as white (standard orientation).
 */
function getOrientation() {
  return myRole === 'black' ? 'flipped' : 'standard';
}

function renderBoard() {
  if (!boardEl) return;

  const orientation = getOrientation();
  boardEl.innerHTML = '';

  // Create 8x8 grid
  const grid = document.createElement('div');
  grid.className = 'board2d-grid';

  for (let displayRank = 0; displayRank < 8; displayRank++) {
    const actualRank = orientation === 'flipped' ? displayRank : 7 - displayRank;

    for (let file = 0; file < 8; file++) {
      const actualFile = orientation === 'flipped' ? 7 - file : file;
      const square = document.createElement('div');
      const isLight = (actualRank + actualFile) % 2 === 1; // white-on-right: h1 is light
      square.className = `board2d-square ${isLight ? 'light' : 'dark'}`;

      const piece = serverBoard?.[actualRank]?.[actualFile];
      if (piece && piece !== 0) {
        const symbol = document.createElement('span');
        symbol.className = 'board2d-piece';
        symbol.textContent = PIECE_SYMBOLS[piece];

        // Color the piece text
        if (piece <= 6) {
          symbol.classList.add('white-piece');
        } else {
          symbol.classList.add('black-piece');
        }

        square.appendChild(symbol);
      }

      grid.appendChild(square);
    }
  }

  boardEl.appendChild(grid);
}

// Subscribe to state updates
onStateUpdate(() => {
  if (mode > 0) renderBoard();
});

onRestart(() => {
  if (mode > 0) renderBoard();
});

function applyMode() {
  boardEl = document.getElementById('board-2d-overlay');
  if (!boardEl) return;

  if (mode === 0) {
    boardEl.classList.remove('visible', 'fullscreen');
  } else {
    boardEl.classList.add('visible');
    if (mode === 2) {
      boardEl.classList.add('fullscreen');
    } else {
      boardEl.classList.remove('fullscreen');
    }
    renderBoard();
  }
}

/**
 * Cycle the 2D board modes: desktop cycles off → small → fullscreen, mobile cycles off → on.
 */
export function toggle2DBoard() {
  const maxMode = isTouchDevice() ? 2 : 3;
  mode = (mode + 1) % maxMode;
  applyMode();
}

/**
 * Check if the 2D board is currently visible.
 * @returns {boolean}
 */
export function is2DBoardVisible() {
  return mode > 0;
}

// Saved mode for restoring after camera navigation
let savedMode = 0;

/**
 * Save the current 2D board mode and hide it.
 * Call this when entering camera/move navigation mode.
 */
export function saveAndHide2DBoard() {
  savedMode = mode;
  mode = 0;
  applyMode();
}

/**
 * Restore the 2D board to its previously saved state.
 * Call this when exiting camera/move navigation mode.
 */
export function restore2DBoard() {
  mode = savedMode;
  savedMode = 0;
  applyMode();
}
