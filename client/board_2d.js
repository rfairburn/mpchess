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
  sendPremove,
  cancelPremove,
  previousMove,
} from './network.js';
import { getPremove, onPremoveChange, isPremoveEnabled } from './premove.js';
import { isMobileLayout } from './capabilities.js';
import {
  pieceColor,
  pieceType,
  getValidMoves,
  getPremoveMoves,
  findKing,
  isInCheck,
} from '../shared/chess.mjs';
import { getPieceSvgUrl } from './pieces.js';
import { playMove } from './sound.js';
import { showError, showPromotionPicker } from './ui.js';
import { t } from '../shared/i18n.mjs';
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
  getSelectionMode,
} from './selection.js';
import { createHighlightOrchestrator, bindSelectionChange } from './highlight-orchestration.js';

let boardEl = null;
let gridEl = null;
// 0 = off, 1 = small (top-right), 2 = fullscreen (centered)
let mode = 0;

// ── Arrow state (2D) ────────────────────────────────────

let arrowSvg = null;
let arrowStart = null; // { file, rank } — right-click start square

const ARROW_STROKE_RATIO = 0.25; // stroke as fraction of square size (2x)
const ARROW_HEAD_LENGTH_RATIO = 0.25; // head length as fraction of square
const ARROW_HEAD_WIDTH_RATIO = 0.36; // head base width matches thick line * 1.5

// Confirmed-premove arrow — deep royal blue, dashed. Rendered as an
// independent system overlay derived from premove.js, never from the
// mutable annotation arrows list.
const PREMOVE_ARROW_COLOR = 'rgba(30, 90, 200, 0.9)';

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
    sq.classList.remove(
      'selected',
      'valid-move',
      'capture-move',
      'in-check',
      'previous-move',
      'premove-selected',
      'premove-move',
      'premove-capture'
    );
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
 * Highlight a premove-selected square (off-turn own-piece selection).
 */
function highlightPremoveSelected(file, rank) {
  highlightSquare(file, rank, 'premove-selected');
}

/**
 * Highlight premove candidate destinations for the selected piece.
 */
function highlightPremoveMoves(moves) {
  for (const m of moves) {
    if (serverBoard && (serverBoard[m.rank][m.file] !== 0 || m.enPassant)) {
      highlightSquare(m.file, m.rank, 'premove-capture');
    } else {
      highlightSquare(m.file, m.rank, 'premove-move');
    }
  }
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
 * Render the confirmed-premove square fills (premove-from / premove-to).
 * These are driven solely by the premove state (premove.js) and are
 * independent of the selection highlights: they persist while the premove
 * is confirmed and are removed when it is cleared, executed, or replaced.
 */
function renderPremoveSquares() {
  if (!gridEl) return;
  for (const sq of gridEl.children) {
    sq.classList.remove('premove-from', 'premove-to');
  }
  const pre = getPremove();
  if (!pre) return;
  highlightSquare(pre.fromFile, pre.fromRank, 'premove-from');
  highlightSquare(pre.toFile, pre.toRank, 'premove-to');
}

// ── Confirmed premove ghost (2D) ─────────────────────────
// A semi-transparent clone of the premoved piece at the destination
// square. Non-interactive (pointer-events: none via CSS), ~0.5 opacity,
// and drawn above any piece already on the destination (captures and
// friendly-occupied recapture squares) so it stays readable. Sourced
// from premove.js + serverBoard and re-emitted on every board render
// and premove state change — never from a mutable list, so no
// duplicates can accumulate. The real origin piece is never moved or
// hidden.

let premoveGhost = null; // <img> inside the destination square

function renderPremoveGhost() {
  if (premoveGhost) {
    premoveGhost.remove();
    premoveGhost = null;
  }
  if (!gridEl) return;
  const pre = getPremove();
  if (!pre) return;
  const piece = serverBoard?.[pre.fromRank]?.[pre.fromFile];
  // The origin must still hold OUR piece. After an opponent capture the
  // source square holds the opponent's capturing piece (not 0) during the
  // state update that precedes premoveDiscarded — never ghost that.
  if (!piece || piece === 0 || pieceColor(piece) !== myRole) return;
  const orientation = getOrientation();
  const displayRank = orientation === 'flipped' ? pre.toRank : 7 - pre.toRank;
  const displayFile = orientation === 'flipped' ? 7 - pre.toFile : pre.toFile;
  const sq = gridEl.children[displayRank * 8 + displayFile];
  if (!sq) return;
  const ghost = document.createElement('img');
  ghost.className = 'board2d-piece board2d-premove-ghost';
  ghost.src = getPieceSvgUrl(piece);
  ghost.alt = '';
  ghost.draggable = false;
  ghost.dataset.premoveGhost = 'true';
  sq.appendChild(ghost);
  premoveGhost = ghost;
}

// ── Highlight orchestrator (2D) ──────────────────────────

const orchestrator = createHighlightOrchestrator({
  clearHighlights,
  highlightPreviousMove,
  highlightSelected,
  highlightValidMoves,
  highlightCheck,
  highlightPremoveSelected,
  highlightPremoveMoves,
});
bindSelectionChange(orchestrator, () => mode > 0);

/**
 * Deselect the current piece and clear all highlights.
 */
function deselect() {
  orchestrator.deselect();
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
  orchestrator.selectPiece(file, rank, moves);
}

/**
 * Select an own piece off-turn and show its premove candidate moves.
 * Candidates use the permissive getPremoveMoves() on a cloned board —
 * getValidMoves() is too restrictive for premoves (it rejects recaptures
 * onto currently friendly-occupied squares, pinned pieces, and pawn
 * destinations the opponent will vacate).
 */
function selectPremovePiece(file, rank) {
  const moves = getPremoveMoves(
    serverBoard.map((r) => [...r]),
    file,
    rank,
    castlingRights,
    enPassantTarget
  );
  setSelectedSquare({ file, rank }, moves, 'premove');
  orchestrator.selectPremove(file, rank, moves);
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

/**
 * Complete a premove: sends `premove` (the server decides execute-now vs
 * store, so a late turn flip between click and send is safe). A pawn
 * promotion destination opens the promotion picker in premove mode instead
 * of sending immediately — the chosen piece is then sent atomically with
 * the premove.
 */
function executePremove(fromFile, fromRank, toFile, toRank) {
  const piece = serverBoard[fromRank][fromFile];
  if (pieceType(piece) === 'pawn' && (toRank === 0 || toRank === 7)) {
    deselect();
    showPromotionPicker(toFile, toRank, pieceColor(piece), {
      mode: 'premove',
      fromFile,
      fromRank,
      toFile,
      toRank,
    });
    return;
  }
  sendPremove(fromFile, fromRank, toFile, toRank);
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
        const img = document.createElement('img');
        img.className = 'board2d-piece';
        img.src = getPieceSvgUrl(piece);
        img.alt = '';
        img.draggable = false;
        square.appendChild(img);
      }

      gridEl.appendChild(square);
    }
  }

  // Build wrapper with coordinate labels
  const wrapper = document.createElement('div');
  wrapper.className = 'board2d-wrapper';

  // Rank labels (left column)
  const rankLabels = document.createElement('div');
  rankLabels.className = 'board2d-rank-labels';
  for (let displayRank = 0; displayRank < 8; displayRank++) {
    const actualRank = orientation === 'flipped' ? displayRank : 7 - displayRank;
    const label = document.createElement('div');
    label.className = 'board2d-rank-label';
    label.textContent = String(actualRank + 1);
    rankLabels.appendChild(label);
  }

  // File labels (top row)
  const fileLabelsTop = document.createElement('div');
  fileLabelsTop.className = 'board2d-file-labels-top';
  const spacerTopL = document.createElement('div');
  spacerTopL.className = 'board2d-file-label';
  fileLabelsTop.appendChild(spacerTopL);
  for (let file = 0; file < 8; file++) {
    const actualFile = orientation === 'flipped' ? 7 - file : file;
    const label = document.createElement('div');
    label.className = 'board2d-file-label';
    label.textContent = String.fromCharCode(97 + actualFile);
    fileLabelsTop.appendChild(label);
  }
  const spacerTopR = document.createElement('div');
  spacerTopR.className = 'board2d-file-label';
  fileLabelsTop.appendChild(spacerTopR);

  // File labels (bottom row) — spacers on both sides, 8 labels in between
  const fileLabels = document.createElement('div');
  fileLabels.className = 'board2d-file-labels';
  const spacerBL = document.createElement('div');
  spacerBL.className = 'board2d-file-label';
  fileLabels.appendChild(spacerBL);
  for (let file = 0; file < 8; file++) {
    const actualFile = orientation === 'flipped' ? 7 - file : file;
    const label = document.createElement('div');
    label.className = 'board2d-file-label';
    label.textContent = String.fromCharCode(97 + actualFile); // a-h
    fileLabels.appendChild(label);
  }
  const spacerBR = document.createElement('div');
  spacerBR.className = 'board2d-file-label';
  fileLabels.appendChild(spacerBR);

  // Rank labels (right column)
  const rankLabelsRight = document.createElement('div');
  rankLabelsRight.className = 'board2d-rank-labels-right';
  for (let displayRank = 0; displayRank < 8; displayRank++) {
    const actualRank = orientation === 'flipped' ? displayRank : 7 - displayRank;
    const label = document.createElement('div');
    label.className = 'board2d-rank-label';
    label.textContent = String(actualRank + 1);
    rankLabelsRight.appendChild(label);
  }

  // Corner spacer (top-left)
  const corner = document.createElement('div');
  corner.className = 'board2d-corner';
  corner.style.gridRow = '1';
  corner.style.gridColumn = '1';

  wrapper.appendChild(fileLabelsTop);
  wrapper.appendChild(rankLabels);
  wrapper.appendChild(gridEl);
  wrapper.appendChild(rankLabelsRight);
  wrapper.appendChild(fileLabels);
  wrapper.appendChild(corner);
  container.appendChild(wrapper);
  boardEl.appendChild(container);

  // Re-apply highlights if something is selected
  orchestrator.updateHighlights();

  // Create or update the arrow SVG overlay
  ensureArrowLayer2D();
  scheduleArrowRender2D();

  // Render square highlights
  renderHighlights2D();

  // Render confirmed-premove square fills (independent of selection)
  renderPremoveSquares();

  // Render the confirmed-premove destination ghost (independent of selection)
  renderPremoveGhost();
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
  const hasLayout = Boolean(containerRect.width && containerRect.height && firstSquareRect);

  arrowSvg.setAttribute('viewBox', `0 0 ${containerRect.width || 0} ${containerRect.height || 0}`);
  arrowSvg.setAttribute('preserveAspectRatio', 'none');
  arrowSvg.replaceChildren();

  const squareSize = hasLayout ? Math.min(firstSquareRect.width, firstSquareRect.height) : 0;
  const strokeWidth = squareSize * ARROW_STROKE_RATIO;
  const headLength = squareSize * ARROW_HEAD_LENGTH_RATIO;
  const headHalfWidth = (squareSize * ARROW_HEAD_WIDTH_RATIO) / 2;

  if (hasLayout) {
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

  // Confirmed-premove arrow — independent system overlay derived from
  // premove.js. It is re-rendered here on every pass (after the annotation
  // loop) so annotation add/remove/clear can never hide or replace it, and a
  // full board re-render can never lose it: it is always re-emitted from the
  // premove state, even before the container has a layout (degenerate
  // geometry is invisible and self-corrects on the next layout pass).
  renderPremoveArrow2D(strokeWidth, headLength, headHalfWidth);
}

/**
 * Render the confirmed-premove dashed arrow (origin → destination) into the
 * shared arrow SVG. This is a system overlay sourced from premove.js, NOT
 * from the mutable annotation arrows list: addArrow/removeArrow/clearArrows
 * and ordinary left-clicks (which call clearArrows) only affect the
 * annotation loop above, so they cannot clear, replace, or hide this arrow.
 * An annotation with identical endpoints coexists alongside it.
 */
function renderPremoveArrow2D(strokeWidth, headLength, headHalfWidth) {
  const pre = getPremove();
  if (!pre) return;

  const path = getArrowPath(
    { file: pre.fromFile, rank: pre.fromRank },
    { file: pre.toFile, rank: pre.toRank }
  );
  const points = path.map((p) => getSquareCenter(p.file, p.rank));
  if (points.length < 2 || points.some((p) => p === null)) return;

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

  // Dashed line body: from origin to arrowhead base
  const bodyPoints = [...points.slice(0, -1), base];
  const body = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  body.setAttribute(
    'd',
    bodyPoints.map((p, index) => `${index === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  );
  body.setAttribute('fill', 'none');
  body.setAttribute('stroke', PREMOVE_ARROW_COLOR);
  body.setAttribute('stroke-width', strokeWidth);
  body.setAttribute('stroke-linecap', 'butt');
  body.setAttribute('stroke-linejoin', 'round');
  body.setAttribute('stroke-dasharray', `${strokeWidth * 2} ${strokeWidth}`);

  // Solid arrowhead at the destination
  const head = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  head.setAttribute(
    'points',
    [
      `${base.x + px * headHalfWidth},${base.y + py * headHalfWidth}`,
      `${base.x - px * headHalfWidth},${base.y - py * headHalfWidth}`,
      `${tip.x},${tip.y}`,
    ].join(' ')
  );
  head.setAttribute('fill', PREMOVE_ARROW_COLOR);

  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.setAttribute('data-premove-arrow', 'true');
  group.append(body, head);
  arrowSvg.appendChild(group);
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
 *
 * Turn guard: off-turn, only the player's own pieces may be selected —
 * they enter premove mode (candidates from getPremoveMoves, completion
 * sends `premove`). Clicking an enemy piece off-turn keeps the
 * "not your turn" toast; empty/non-candidate squares just deselect.
 */
function handleSquareClick(sq) {
  if (!serverBoard || serverPromotingPiece || serverGameOver) return;

  const coords = getSquareCoords(sq);
  if (!coords) return;
  const { file, rank } = coords;
  const piece = serverBoard[rank][file];

  // Re-clicking the confirmed premove's origin cancels it (sends
  // premoveCancel + clears local state optimistically). This takes priority
  // over selection: the origin is always the user's own piece, and clicking
  // it while a premove is confirmed is the cancel gesture.
  const pre = getPremove();
  if (pre && pre.fromFile === file && pre.fromRank === rank) {
    cancelPremove();
    return;
  }

  const offTurn = myRole && myRole !== serverTurn;
  const premoveAllowed = !offTurn || isPremoveEnabled();
  const sel = getSelectedSquare();

  if (sel) {
    // Clicking the same piece again deselects it
    if (sel.file === file && sel.rank === rank) {
      deselect();
      return;
    }

    if (isValidMove(file, rank)) {
      // The message type follows the selection mode, not the turn at send
      // time: a premove selection always sends `premove`, so a late turn
      // flip between click and send still sends `premove` (the server
      // decides execute-now vs store).
      if (getSelectionMode() === 'premove') {
        executePremove(sel.file, sel.rank, file, rank);
      } else {
        executeMove(sel.file, sel.rank, file, rank);
      }
      return;
    }

    // Clicked a non-candidate square — if it's one of our pieces, select it
    // instead (premove mode off-turn, normal mode on-turn)
    if (piece !== 0 && pieceColor(piece) === myRole) {
      if (offTurn && !premoveAllowed) {
        showError(t('error.not_your_turn'));
        deselect();
      } else if (offTurn) selectPremovePiece(file, rank);
      else selectPiece(file, rank);
      return;
    }
    deselect();
    return;
  }

  // No selection — try to select a piece
  if (piece !== 0 && pieceColor(piece) === myRole) {
    if (offTurn && !premoveAllowed) {
      showError(t('error.not_your_turn'));
      deselect();
    } else if (offTurn) selectPremovePiece(file, rank);
    else selectPiece(file, rank);
    return;
  }

  if (offTurn) {
    // Nonsense off-turn click (enemy piece or empty square): keep the toast
    // for enemy pieces, plain deselect for empty squares.
    if (piece !== 0) showError(t('error.not_your_turn'));
    deselect();
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

  // Own pieces are draggable on-turn, and off-turn only when premoves are
  // enabled; enemy pieces and empty squares are ignored.
  if (piece === 0 || pieceColor(piece) !== myRole) return;
  if (myRole !== serverTurn && !isPremoveEnabled()) return;

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
      if (getSelectionMode() === 'premove') {
        executePremove(dragPiece.file, dragPiece.rank, coords.file, coords.rank);
      } else {
        executeMove(dragPiece.file, dragPiece.rank, coords.file, coords.rank);
      }
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
  // Off-turn drags select in premove mode (permissive candidates) when
  // enabled; on-turn drags keep the normal legal selection.
  if (myRole && myRole !== serverTurn) {
    if (!isPremoveEnabled()) {
      dragCandidate = null;
      deselect();
      return;
    }
    selectPremovePiece(file, rank);
  } else selectPiece(file, rank);
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
    // Preserve the computed size so the ghost matches the original
    const computedW = getComputedStyle(pieceEl).width;
    const computedH = getComputedStyle(pieceEl).height;
    dragGhost.style.width = computedW;
    dragGhost.style.height = computedH;
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

  // Own pieces are touch-draggable on- and off-turn (off-turn drags
  // complete as premoves); enemy pieces and empty squares are ignored.
  if (piece === 0 || pieceColor(piece) !== myRole) return;

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
        if (getSelectionMode() === 'premove') {
          executePremove(dragPiece.file, dragPiece.rank, coords.file, coords.rank);
        } else {
          executeMove(dragPiece.file, dragPiece.rank, coords.file, coords.rank);
        }
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
}

function onRightMouseUp(event) {
  if (event.button !== 2) return;
  if (!arrowStart) return;

  // Resolve the release square — off-board release cancels the annotation
  const coords = getSquareFromPointer(event);
  if (!coords) {
    arrowStart = null;
    return;
  }

  // If release square differs from start, always draw an arrow regardless of pixel distance.
  // A drag (press ≠ release) NEVER cancels the premove — including a drag that
  // ends on the premove origin — it always draws its annotation arrow.
  if (coords.file !== arrowStart.file || coords.rank !== arrowStart.rank) {
    const color = getArrowColor(event);
    addArrow(arrowStart, coords, color);
  } else {
    // Same square (press === release). The ONLY right-click that cancels: a
    // same-square right-click whose press AND release are both the confirmed
    // premove's origin. It takes priority over the highlight gesture.
    const pre = getPremove();
    if (
      pre &&
      arrowStart.file === pre.fromFile &&
      arrowStart.rank === pre.fromRank &&
      coords.file === pre.fromFile &&
      coords.rank === pre.fromRank
    ) {
      cancelPremove();
    } else {
      // Same square — highlight it
      const color = getHighlightColor(event);
      addHighlight(arrowStart.file, arrowStart.rank, color);
    }
  }
  arrowStart = null;
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

// Re-render premove visuals (confirmed square fills + dashed arrow +
// destination ghost) when the premove state changes: server confirmation
// echo, state restore/clear on reconnect, premoveCleared, or a local
// optimistic cancel. The arrow SVG is reused (ensureArrowLayer2D), so no
// duplicate overlays or listeners accrue across re-renders.
onPremoveChange(() => {
  if (mode > 0) {
    renderPremoveSquares();
    renderPremoveGhost();
    scheduleArrowRender2D();
  }
});

// Re-render board when selection changes (e.g. from 3D board)
// Handled by bindSelectionChange(orchestrator) below — no duplicate callback needed.

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
  const maxMode = isMobileLayout() ? 2 : 3;
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

/**
 * Re-render the 2D board with current piece set.
 * Call this when the SVG piece set changes.
 */
export function renderBoard2D() {
  if (mode > 0) renderBoard();
}
