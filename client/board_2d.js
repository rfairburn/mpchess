// ═══════════════════════════════════════════════════════════
//  2D BOARD — interactive board overlay
// ═══════════════════════════════════════════════════════════

import {
  onStateUpdate,
  onRestart,
  myRole,
  serverBoard,
  serverTurn,
  serverPromotingPiece,
  serverGameOver,
  castlingRights,
  enPassantTarget,
  sendMove,
} from './network.js';
import { isTouchDevice } from './capabilities.js';
import { pieceColor, getValidMoves, findKing, isInCheck } from './chess.mjs';
import { playMove } from './sound.js';
import { showError } from './ui.js';

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
let gridEl = null;
// 0 = off, 1 = small (top-right), 2 = fullscreen (centered)
let mode = 0;

// ── Selection state ──────────────────────────────────────

let selectedSquare = null; // { file, rank } in actual (board) coordinates
let validMoves = [];

// ── Drag state ───────────────────────────────────────────

const DRAG_THRESHOLD = 10; // pixels before drag commits
let dragging = false;
let dragCandidate = null; // { file, rank } — piece under mousedown (not yet committed)
let dragPiece = null; // { file, rank } — committed drag piece
let dragStartX = 0;
let dragStartY = 0;
let dragCompleted = false; // suppress click after drag
let dragTouchId = null;
let dragGhost = null; // floating piece element that follows cursor
let dragPieceEl = null; // original piece element (hidden during drag)

/**
 * Get the orientation for the 2D board based on role.
 * White: rank 8 at top, rank 1 at bottom (standard).
 * Black: rank 1 at top, rank 8 at bottom (flipped).
 * Spectator: same as white (standard orientation).
 */
function getOrientation() {
  return myRole === 'black' ? 'flipped' : 'standard';
}

/**
 * Clear all highlight classes from all squares.
 */
function clearHighlights() {
  if (!gridEl) return;
  for (const sq of gridEl.children) {
    sq.classList.remove('selected', 'valid-move', 'capture-move', 'in-check');
  }
}

/**
 * Highlight a square by its actual board coordinates.
 */
function highlightSquare(file, rank, className) {
  const orientation = getOrientation();
  const displayRank = orientation === 'flipped' ? rank : 7 - rank;
  const displayFile = orientation === 'flipped' ? 7 - file : file;
  const index = displayRank * 8 + displayFile;
  const sq = gridEl?.children[index];
  if (sq) sq.classList.add(className);
}

/**
 * Highlight all valid moves for the selected piece.
 */
function highlightValidMoves(moves) {
  for (const m of moves) {
    if (serverBoard && (serverBoard[m.rank][m.file] !== 0 || m.enPassant)) {
      highlightSquare(m.file, m.rank, 'capture-move');
    } else {
      highlightSquare(m.file, m.rank, 'valid-move');
    }
  }
}

/**
 * Highlight the selected square.
 */
function highlightSelected(file, rank) {
  highlightSquare(file, rank, 'selected');
}

/**
 * Highlight the king in check — only when the side to move is actually in check.
 */
function highlightCheck() {
  if (!serverBoard) return;
  if (!isInCheck(serverBoard, serverTurn)) return;
  const king = findKing(serverBoard, serverTurn);
  if (king) {
    highlightSquare(king.file, king.rank, 'in-check');
  }
}

/**
 * Deselect the current piece and clear all highlights.
 */
function deselect() {
  selectedSquare = null;
  validMoves = [];
  clearHighlights();
  highlightCheck();
}

/**
 * Select a piece and show its valid moves.
 */
function selectPiece(file, rank) {
  selectedSquare = { file, rank };
  validMoves = getValidMoves(
    serverBoard.map((r) => [...r]),
    file,
    rank,
    castlingRights,
    enPassantTarget
  );
  clearHighlights();
  highlightSelected(file, rank);
  highlightValidMoves(validMoves);
}

/**
 * Check if a move is valid for the current selection.
 */
function isValidMove(file, rank) {
  return validMoves.some((m) => m.file === file && m.rank === rank);
}

/**
 * Execute a move.
 */
function executeMove(fromFile, fromRank, toFile, toRank) {
  sendMove(fromFile, fromRank, toFile, toRank);
  deselect();
}

// ── Render ───────────────────────────────────────────────

function renderBoard() {
  if (!boardEl) return;

  const orientation = getOrientation();
  boardEl.innerHTML = '';

  // Create container
  const container = document.createElement('div');
  container.id = 'board-2d-container';

  // Create 8x8 grid
  gridEl = document.createElement('div');
  gridEl.className = 'board2d-grid';

  for (let displayRank = 0; displayRank < 8; displayRank++) {
    const actualRank = orientation === 'flipped' ? displayRank : 7 - displayRank;

    for (let file = 0; file < 8; file++) {
      const actualFile = orientation === 'flipped' ? 7 - file : file;
      const square = document.createElement('div');
      const isLight = (actualRank + actualFile) % 2 === 1; // white-on-right: h1 is light
      square.className = `board2d-square ${isLight ? 'light' : 'dark'}`;
      square.dataset.file = actualFile;
      square.dataset.rank = actualRank;

      const piece = serverBoard?.[actualRank]?.[actualFile];
      if (piece && piece !== 0) {
        const symbol = document.createElement('span');
        symbol.className = 'board2d-piece';
        symbol.textContent = PIECE_SYMBOLS[piece];

        if (piece <= 6) {
          symbol.classList.add('white-piece');
        } else {
          symbol.classList.add('black-piece');
        }

        square.appendChild(symbol);
      }

      gridEl.appendChild(square);
    }
  }

  container.appendChild(gridEl);
  boardEl.appendChild(container);

  // Re-apply highlights if something is selected
  if (selectedSquare) {
    highlightSelected(selectedSquare.file, selectedSquare.rank);
    highlightValidMoves(validMoves);
  } else {
    highlightCheck();
  }
}

// ── Interaction helpers ──────────────────────────────────

/**
 * Get the actual board coordinates from a square element.
 */
function getSquareCoords(sq) {
  const file = parseInt(sq.dataset.file, 10);
  const rank = parseInt(sq.dataset.rank, 10);
  if (isNaN(file) || isNaN(rank)) return null;
  return { file, rank };
}

/**
 * Find the square element under a pointer event.
 */
function findSquareUnderEvent(event) {
  const clientX = event.clientX ?? event.touches?.[0]?.clientX ?? 0;
  const clientY = event.clientY ?? event.touches?.[0]?.clientY ?? 0;
  const target = document.elementFromPoint(clientX, clientY);
  return target?.closest('.board2d-square');
}

/**
 * Handle a click on a square.
 */
function handleSquareClick(sq) {
  if (!serverBoard || serverPromotingPiece || serverGameOver) return;

  const coords = getSquareCoords(sq);
  if (!coords) return;
  const { file, rank } = coords;
  const piece = serverBoard[rank][file];

  // Enforce turn guard before any interaction
  if (myRole && myRole !== serverTurn) {
    deselect();
    showError('Not your turn');
    return;
  }

  if (selectedSquare) {
    // Clicking the same piece again deselects it
    if (selectedSquare.file === file && selectedSquare.rank === rank) {
      deselect();
      return;
    }

    const isValid = isValidMove(file, rank);
    if (!isValid) {
      // Clicked an invalid square — if it's one of our pieces, select it instead
      if (piece !== 0 && pieceColor(piece) === myRole) {
        selectPiece(file, rank);
      } else {
        deselect();
      }
      return;
    }

    executeMove(selectedSquare.file, selectedSquare.rank, file, rank);
    return;
  }

  // No selection — try to select a piece
  if (piece !== 0 && pieceColor(piece) === myRole) {
    selectPiece(file, rank);
  } else {
    deselect();
  }
}

// ── Mouse drag handlers ──────────────────────────────────

function onMouseDown(event) {
  if (event.button !== 0) return;
  if (!serverBoard || serverPromotingPiece || serverGameOver) return;

  const sq = event.target.closest('.board2d-square');
  if (!sq) return;

  const coords = getSquareCoords(sq);
  if (!coords) return;
  const { file, rank } = coords;
  const piece = serverBoard[rank][file];

  if (piece === 0 || pieceColor(piece) !== myRole || myRole !== serverTurn) return;

  dragStartX = event.clientX;
  dragStartY = event.clientY;
  dragCandidate = { file, rank };
  dragging = false;
  dragPiece = null;
  dragCompleted = false;
}

function onMouseMove(event) {
  if (!dragCandidate && !dragging) return;

  if (!dragging) {
    const dx = event.clientX - dragStartX;
    const dy = event.clientY - dragStartY;
    if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;
    commitDrag();
    if (!dragging) return;
  }

  positionDragGhost(event.clientX, event.clientY);
}

function onMouseUp(event) {
  if (!dragging && !dragCandidate) return;

  if (!dragging) {
    dragCandidate = null;
    return;
  }

  dragging = false;
  removeDragGhost();

  const sq = findSquareUnderEvent(event);
  if (sq) {
    const coords = getSquareCoords(sq);
    if (coords && isValidMove(coords.file, coords.rank)) {
      executeMove(dragPiece.file, dragPiece.rank, coords.file, coords.rank);
      dragPiece = null;
      return;
    }
  }

  deselect();
  dragPiece = null;

  // Suppress only the immediate synthetic click from this mouseup.
  // Use a one-shot document handler so drops outside the board don't
  // leave dragCompleted true and swallow the next legitimate click.
  dragCompleted = true;
  const suppressOnce = () => {
    dragCompleted = false;
    document.removeEventListener('click', suppressOnce);
  };
  document.addEventListener('click', suppressOnce, { once: true });
}

function commitDrag() {
  if (!dragCandidate) return;
  const { file, rank } = dragCandidate;
  selectPiece(file, rank);
  dragging = true;
  dragPiece = { file, rank };
  playMove();
  dragCandidate = null;

  // Create a floating ghost piece that follows the cursor
  const orientation = getOrientation();
  const displayRank = orientation === 'flipped' ? rank : 7 - rank;
  const displayFile = orientation === 'flipped' ? 7 - file : file;
  const sq = gridEl?.children[displayRank * 8 + displayFile];
  const pieceEl = sq?.querySelector('.board2d-piece');
  if (pieceEl) {
    dragPieceEl = pieceEl;
    pieceEl.style.visibility = 'hidden';
    dragGhost = pieceEl.cloneNode(true);
    dragGhost.classList.add('board2d-drag-ghost');
    dragGhost.style.visibility = 'visible';
    // Preserve the computed font-size so the ghost matches the original
    const computedSize = getComputedStyle(pieceEl).fontSize;
    dragGhost.style.fontSize = computedSize;
    document.body.appendChild(dragGhost);
    // Position ghost at current cursor
    positionDragGhost(dragStartX, dragStartY);
  }
}

function positionDragGhost(x, y) {
  if (!dragGhost) return;
  const size = dragGhost.offsetWidth || 30;
  dragGhost.style.left = x - size / 2 + 'px';
  dragGhost.style.top = y - size / 2 + 'px';
}

function removeDragGhost() {
  if (dragGhost) {
    dragGhost.remove();
    dragGhost = null;
  }
  // Restore the original piece visibility
  if (dragPieceEl) {
    dragPieceEl.style.visibility = '';
    dragPieceEl = null;
  }
}

// ── Touch drag handlers ──────────────────────────────────

function onTouchStart(event) {
  if (!serverBoard || serverPromotingPiece || serverGameOver) return;
  if (dragTouchId !== null || dragCandidate !== null || dragging) return;

  const t = event.changedTouches[0];
  const sq = findSquareUnderEvent(t);
  if (!sq) return;

  const coords = getSquareCoords(sq);
  if (!coords) return;
  const { file, rank } = coords;
  const piece = serverBoard[rank][file];

  if (piece === 0 || pieceColor(piece) !== myRole || myRole !== serverTurn) return;

  dragTouchId = t.identifier;
  dragStartX = t.clientX;
  dragStartY = t.clientY;
  dragCandidate = { file, rank };
  dragging = false;
  dragPiece = null;
  dragCompleted = false;
}

function onTouchMove(event) {
  if (!dragCandidate && !dragging) return;

  const touches = event.touches;
  let t = null;
  for (let i = 0; i < touches.length; i++) {
    if (touches[i].identifier === dragTouchId) {
      t = touches[i];
      break;
    }
  }
  if (!t) return;

  if (!dragging) {
    const dx = t.clientX - dragStartX;
    const dy = t.clientY - dragStartY;
    if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;
  }
  event.preventDefault();

  if (!dragging) {
    commitDrag();
    if (!dragging) return;
  }

  positionDragGhost(t.clientX, t.clientY);
}

function onTouchEnd(event) {
  if (!dragging && !dragCandidate) return;

  const changed = event.changedTouches;
  let t = null;
  for (let i = 0; i < changed.length; i++) {
    if (changed[i].identifier === dragTouchId) {
      t = changed[i];
      break;
    }
  }
  if (!t) return;

  const wasCommittedDrag = dragging;

  if (dragging) {
    dragging = false;
    dragCompleted = true;
    removeDragGhost();

    const sq = findSquareUnderEvent(t);
    if (sq) {
      const coords = getSquareCoords(sq);
      if (coords && isValidMove(coords.file, coords.rank)) {
        executeMove(dragPiece.file, dragPiece.rank, coords.file, coords.rank);
        dragPiece = null;
        if (wasCommittedDrag) event.preventDefault();
        dragTouchId = null;
        dragCompleted = false;
        return;
      }
    }

    deselect();
    dragPiece = null;
  }

  if (wasCommittedDrag) {
    event.preventDefault();
    dragCompleted = false;
  }
  dragTouchId = null;
  dragCandidate = null;
}

function onTouchCancel() {
  dragTouchId = null;
  dragCandidate = null;
  if (dragging && dragPiece) {
    dragging = false;
    dragPiece = null;
  }
  removeDragGhost();
  deselect();
}

// ── Event binding (stable named handlers, bound once) ───

let eventsBound = false;

function onClickHandler(event) {
  if (dragCompleted) {
    dragCompleted = false;
    return;
  }
  const sq = event.target.closest('.board2d-square');
  if (sq) handleSquareClick(sq);
}

function bindEvents() {
  if (!boardEl || eventsBound) return;
  eventsBound = true;

  boardEl.addEventListener('click', onClickHandler);
  boardEl.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  boardEl.addEventListener('touchstart', onTouchStart, { passive: false });
  document.addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('touchend', onTouchEnd, { passive: false });
  document.addEventListener('touchcancel', onTouchCancel);
}

function unbindEvents() {
  if (!eventsBound) return;
  eventsBound = false;

  if (boardEl) {
    boardEl.removeEventListener('click', onClickHandler);
    boardEl.removeEventListener('mousedown', onMouseDown);
    boardEl.removeEventListener('touchstart', onTouchStart);
  }
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);
  document.removeEventListener('touchmove', onTouchMove);
  document.removeEventListener('touchend', onTouchEnd);
  document.removeEventListener('touchcancel', onTouchCancel);
}

// ── State update handlers ────────────────────────────────

onStateUpdate(() => {
  if (mode > 0) {
    if (dragging && dragPiece) {
      dragging = false;
      dragPiece = null;
    }
    dragTouchId = null;
    dragCandidate = null;
    removeDragGhost();
    // Clear stale selection so old highlights can't execute after a turn change
    selectedSquare = null;
    validMoves = [];
    renderBoard();
  }
});

onRestart(() => {
  selectedSquare = null;
  validMoves = [];
  dragging = false;
  dragCandidate = null;
  dragPiece = null;
  dragCompleted = false;
  dragTouchId = null;
  removeDragGhost();
  if (mode > 0) renderBoard();
});

// ── Mode management ──────────────────────────────────────

function applyMode() {
  boardEl = document.getElementById('board-2d-overlay');
  if (!boardEl) return;

  if (mode === 0) {
    boardEl.classList.remove('visible', 'fullscreen');
    unbindEvents();
    selectedSquare = null;
    validMoves = [];
  } else {
    boardEl.classList.add('visible');
    if (mode === 2) {
      boardEl.classList.add('fullscreen');
    } else {
      boardEl.classList.remove('fullscreen');
    }
    renderBoard();
    bindEvents();
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
