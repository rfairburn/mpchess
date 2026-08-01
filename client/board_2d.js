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
  previousMove,
} from './network.js';
import { isTouchDevice } from './capabilities.js';
import { pieceColor, getValidMoves, findKing, isInCheck } from './chess.mjs';
import { playMove } from './sound.js';
import { showError } from './ui.js';
import {
  getArrows,
  onArrowChange,
  addArrow,
  clearArrows,
  getArrowPath,
  getArrowColor,
} from './arrows.js';
import {
  getHighlights,
  onHighlightChange,
  addHighlight,
  clearHighlights as clearSquareHighlights,
  getHighlightColor,
} from './highlights.js';
import {
  setSelectedSquare,
  clearSelection,
  getSelectedSquare,
  getValidMovesList,
  onSelectionChange,
} from './selection.js';

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

// ── Arrow state (2D) ────────────────────────────────────

let arrowSvg = null;
let arrowStart = null; // { file, rank } — right-click start square
let arrowStartClient = null; // { x, y } — client coords at right-click mousedown

const ARROW_STROKE_RATIO = 0.25; // stroke as fraction of square size (2x)
const ARROW_HEAD_LENGTH_RATIO = 0.25; // head length as fraction of square
const ARROW_HEAD_WIDTH_RATIO = 0.36; // head base width matches thick line * 1.5

// ── Selection state is now in selection.js ───────────────

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
    sq.classList.remove('selected', 'valid-move', 'capture-move', 'in-check', 'previous-move');
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
 * Highlight the squares of the previous move.
 */
function highlightPreviousMove() {
  if (!previousMove) return;
  const { fromFile, fromRank, toFile, toRank } = previousMove;
  highlightSquare(fromFile, fromRank, 'previous-move');
  highlightSquare(toFile, toRank, 'previous-move');
}

/**
 * Deselect the current piece and clear all highlights.
 */
function deselect() {
  clearSelection();
  clearHighlights();
  highlightPreviousMove();
  highlightCheck();
}

/**
 * Select a piece and show its valid moves.
 */
function selectPiece(file, rank) {
  const moves = getValidMoves(
    serverBoard.map((r) => [...r]),
    file,
    rank,
    castlingRights,
    enPassantTarget
  );
  setSelectedSquare({ file, rank }, moves);
  clearHighlights();
  highlightPreviousMove();
  highlightSelected(file, rank);
  highlightValidMoves(moves);
}

/**
 * Check if a move is valid for the current selection.
 */
function isValidMove(file, rank) {
  return getValidMovesList().some((m) => m.file === file && m.rank === rank);
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
  arrowSvg = null; // old SVG destroyed by innerHTML reset below
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
  const sel = getSelectedSquare();
  if (sel) {
    highlightPreviousMove();
    highlightSelected(sel.file, sel.rank);
    highlightValidMoves(getValidMovesList());
  } else {
    highlightPreviousMove();
    highlightCheck();
  }

  // Create or update the arrow SVG overlay
  ensureArrowLayer2D();
  scheduleArrowRender2D();

  // Render square highlights
  renderHighlights2D();
}

// ── Arrow rendering (2D) ────────────────────────────────

let observedArrowContainer = null;
let arrowResizeObserver = null;
let arrowRenderFrame = 0;
let arrowInputContainer = null;

function scheduleArrowRender2D() {
  cancelAnimationFrame(arrowRenderFrame);
  arrowRenderFrame = requestAnimationFrame(renderArrows2D);
}

function ensureArrowLayer2D() {
  const container = gridEl?.closest('#board-2d-container');
  if (!container) return null;

  if (!arrowSvg) {
    arrowSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    arrowSvg.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:10;overflow:visible;';
  }

  container.style.position = 'relative';
  if (arrowSvg.parentElement !== container) container.appendChild(arrowSvg);

  if (observedArrowContainer !== container) {
    arrowResizeObserver?.disconnect();
    observedArrowContainer = container;
    arrowResizeObserver = new window.ResizeObserver(scheduleArrowRender2D);
    arrowResizeObserver.observe(container);
  }

  bindArrowInput2D(container);
  return container;
}

function bindArrowInput2D(container) {
  if (arrowInputContainer === container) return;
  arrowInputContainer?.removeEventListener('contextmenu', onContextMenu);
  arrowInputContainer = container;
  arrowInputContainer.addEventListener('contextmenu', onContextMenu);
}

function getSquareCenter(file, rank) {
  if (!gridEl || !arrowSvg?.parentElement) return null;

  const containerRect = arrowSvg.parentElement.getBoundingClientRect();
  const orientation = getOrientation();
  const displayRank = orientation === 'flipped' ? rank : 7 - rank;
  const displayFile = orientation === 'flipped' ? 7 - file : file;
  const square = gridEl.children[displayRank * 8 + displayFile];
  if (!square) return null;

  const rect = square.getBoundingClientRect();
  return {
    x: rect.left - containerRect.left + rect.width / 2,
    y: rect.top - containerRect.top + rect.height / 2,
  };
}

function renderArrows2D() {
  const container = ensureArrowLayer2D();
  if (!container || !gridEl || !arrowSvg) return;

  const containerRect = container.getBoundingClientRect();
  const firstSquareRect = gridEl.children[0]?.getBoundingClientRect();
  if (!containerRect.width || !containerRect.height || !firstSquareRect) return;

  arrowSvg.setAttribute('viewBox', `0 0 ${containerRect.width} ${containerRect.height}`);
  arrowSvg.setAttribute('preserveAspectRatio', 'none');
  arrowSvg.replaceChildren();

  const squareSize = Math.min(firstSquareRect.width, firstSquareRect.height);
  const strokeWidth = squareSize * ARROW_STROKE_RATIO;
  const headLength = squareSize * ARROW_HEAD_LENGTH_RATIO;
  const headHalfWidth = (squareSize * ARROW_HEAD_WIDTH_RATIO) / 2;

  for (const arrow of getArrows()) {
    const path = getArrowPath(arrow.from, arrow.to);
    const points = path.map((p) => getSquareCenter(p.file, p.rank));
    if (points.length < 2 || points.some((p) => p === null)) continue;

    const tip = points.at(-1);
    const previous = points.at(-2);
    const dx = tip.x - previous.x;
    const dy = tip.y - previous.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const fx = dx / len;
    const fy = dy / len;
    const px = -fy;
    const py = fx;
    const base = {
      x: tip.x - fx * headLength,
      y: tip.y - fy * headLength,
    };

    // Line body: from start to arrowhead base
    const bodyPoints = [...points.slice(0, -1), base];
    const body = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    body.setAttribute(
      'd',
      bodyPoints.map((p, index) => `${index === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
    );
    body.setAttribute('fill', 'none');
    body.setAttribute('stroke', arrow.color);
    body.setAttribute('stroke-width', strokeWidth);
    body.setAttribute('stroke-linecap', 'butt');
    body.setAttribute('stroke-linejoin', 'round');

    // Arrowhead: filled triangle
    const head = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    head.setAttribute(
      'points',
      [
        `${base.x + px * headHalfWidth},${base.y + py * headHalfWidth}`,
        `${base.x - px * headHalfWidth},${base.y - py * headHalfWidth}`,
        `${tip.x},${tip.y}`,
      ].join(' ')
    );
    head.setAttribute('fill', arrow.color);

    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.append(body, head);
    arrowSvg.appendChild(group);
  }
}

// ── Highlight rendering (2D) ─────────────────────────────

function renderHighlights2D() {
  if (!gridEl) return;
  const orientation = getOrientation();

  // Remove all existing highlight overlays
  for (const overlay of gridEl.querySelectorAll('.board2d-highlight')) {
    overlay.remove();
  }

  // Add highlight overlays
  for (const h of getHighlights()) {
    const displayRank = orientation === 'flipped' ? h.rank : 7 - h.rank;
    const displayFile = orientation === 'flipped' ? 7 - h.file : h.file;
    const square = gridEl.children[displayRank * 8 + displayFile];
    if (!square) continue;

    const overlay = document.createElement('div');
    overlay.className = 'board2d-highlight';
    overlay.style.cssText = `
      position: absolute;
      inset: 0;
      background-color: ${h.color};
      opacity: 0.55;
      pointer-events: none;
      z-index: 5;
    `;
    square.appendChild(overlay);
  }
}

// Re-render highlights when they change
onHighlightChange(() => {
  renderHighlights2D();
});

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

  const sel = getSelectedSquare();
  if (sel) {
    // Clicking the same piece again deselects it
    if (sel.file === file && sel.rank === rank) {
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

    executeMove(sel.file, sel.rank, file, rank);
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
  if (sq) {
    clearArrows();
    clearSquareHighlights();
    handleSquareClick(sq);
  }
}

function getSquareFromPointer(event) {
  const rect = gridEl?.getBoundingClientRect();
  if (
    !rect ||
    event.clientX < rect.left ||
    event.clientX >= rect.right ||
    event.clientY < rect.top ||
    event.clientY >= rect.bottom
  ) {
    return null;
  }

  const displayFile = Math.min(7, Math.floor(((event.clientX - rect.left) / rect.width) * 8));
  const displayRank = Math.min(7, Math.floor(((event.clientY - rect.top) / rect.height) * 8));
  const flipped = getOrientation() === 'flipped';
  return {
    file: flipped ? 7 - displayFile : displayFile,
    rank: flipped ? displayRank : 7 - displayRank,
  };
}

function onRightMouseDown(event) {
  if (event.button !== 2) return;
  const coords = getSquareFromPointer(event);
  if (!coords) return;
  arrowStart = coords;
  arrowStartClient = { x: event.clientX, y: event.clientY };
}

function onRightMouseUp(event) {
  if (event.button !== 2) return;
  if (!arrowStart) return;

  // Detect drag vs click: if mouse moved more than threshold, it's a drag (arrow)
  const dx = event.clientX - arrowStartClient.x;
  const dy = event.clientY - arrowStartClient.y;
  const moved = Math.sqrt(dx * dx + dy * dy);

  if (moved > DRAG_THRESHOLD) {
    // Drag detected — draw arrow (need valid end square)
    const coords = getSquareFromPointer(event);
    if (coords) {
      const color = getArrowColor(event);
      addArrow(arrowStart, coords, color);
    }
  } else {
    // Single click — highlight the square where mousedown occurred
    const color = getHighlightColor(event);
    addHighlight(arrowStart.file, arrowStart.rank, color);
  }
  arrowStart = null;
  arrowStartClient = null;
}

function onContextMenu(event) {
  event.preventDefault();
}

function bindEvents() {
  if (!boardEl || eventsBound) return;
  eventsBound = true;

  boardEl.addEventListener('click', onClickHandler);
  boardEl.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  // Right-click arrow drawing
  boardEl.addEventListener('contextmenu', onContextMenu);
  boardEl.addEventListener('mousedown', onRightMouseDown);
  document.addEventListener('mouseup', onRightMouseUp);

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
    boardEl.removeEventListener('contextmenu', onContextMenu);
    boardEl.removeEventListener('mousedown', onRightMouseDown);
    boardEl.removeEventListener('touchstart', onTouchStart);
  }
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);
  document.removeEventListener('mouseup', onRightMouseUp);
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
    clearSelection();
    renderBoard();
  }
});

onRestart(() => {
  clearSelection();
  dragging = false;
  dragCandidate = null;
  dragPiece = null;
  dragCompleted = false;
  dragTouchId = null;
  removeDragGhost();
  clearArrows();
  clearSquareHighlights();
  if (mode > 0) renderBoard();
});

// Re-render arrows when they change
onArrowChange(() => {
  scheduleArrowRender2D();
});

// Re-render board when selection changes (e.g. from 3D board)
onSelectionChange(() => {
  if (mode > 0) {
    clearHighlights();
    const sel = getSelectedSquare();
    if (sel) {
      highlightPreviousMove();
      highlightSelected(sel.file, sel.rank);
      highlightValidMoves(getValidMovesList());
    } else {
      highlightPreviousMove();
      highlightCheck();
    }
  }
});

// ── Mode management ──────────────────────────────────────

function applyMode() {
  boardEl = document.getElementById('board-2d-overlay');
  if (!boardEl) return;

  if (mode === 0) {
    boardEl.classList.remove('visible', 'fullscreen');
    unbindEvents();
    arrowSvg = null; // allow recreation on next show
    arrowResizeObserver?.disconnect();
    arrowResizeObserver = null;
    observedArrowContainer = null;
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
