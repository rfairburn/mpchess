// ═══════════════════════════════════════════════════════════
//  HIGHLIGHT ORCHESTRATION — renderer-agnostic select/deselect/update
// ═══════════════════════════════════════════════════════════

import {
  clearSelection,
  getSelectedSquare,
  getValidMovesList,
  getSelectionMode,
  onSelectionChange,
} from './selection.js';

/**
 * Create a highlight orchestrator that wraps renderer-specific callbacks.
 * Both 2D (DOM classes) and 3D (Three.js materials) share the same
 * orchestration logic; only the rendering functions differ.
 *
 * @param {Object} renderers
 * @param {Function} renderers.clearHighlights — clear all square highlights
 * @param {Function} renderers.highlightPreviousMove — highlight previous move squares
 * @param {Function} renderers.highlightSelected(file, rank) — highlight selected square
 * @param {Function} renderers.highlightValidMoves(moves) — highlight valid move squares
 * @param {Function} renderers.highlightCheck — highlight king in check
 * @param {Function} [renderers.highlightPremoveSelected(file, rank)] — highlight a
 *   premove-selected square (falls back to highlightSelected when absent)
 * @param {Function} [renderers.highlightPremoveMoves(moves)] — highlight premove
 *   candidate squares (falls back to highlightValidMoves when absent)
 * @returns {{ deselect: Function, selectPiece: Function, selectPremove: Function, updateHighlights: Function }}
 */
export function createHighlightOrchestrator(renderers) {
  const {
    clearHighlights,
    highlightPreviousMove,
    highlightSelected,
    highlightValidMoves,
    highlightCheck,
    highlightPremoveSelected,
    highlightPremoveMoves,
  } = renderers;

  /**
   * Deselect the current piece and restore default highlights.
   */
  function deselect() {
    clearSelection();
    clearHighlights();
    highlightPreviousMove();
    highlightCheck();
  }

  /**
   * Select a piece and show its valid moves.
   * @param {number} file
   * @param {number} rank
   * @param {Array} moves
   */
  function selectPiece(file, rank, moves) {
    clearHighlights();
    highlightPreviousMove();
    highlightSelected(file, rank);
    highlightValidMoves(moves);
    // An active check persists during selection: clearHighlights() resets the
    // checked king to base, and check outranks selection in the square-state
    // precedence, so re-apply it after the redraw.
    highlightCheck();
  }

  /**
   * Select a piece in premove mode (off-turn) and show its premove candidates.
   * Uses the premove-specific highlight callbacks when the renderer provides
   * them, so premove selection/candidates are visually distinguishable from a
   * normal legal selection.
   * @param {number} file
   * @param {number} rank
   * @param {Array} moves
   */
  function selectPremove(file, rank, moves) {
    clearHighlights();
    highlightPreviousMove();
    (highlightPremoveSelected || highlightSelected)(file, rank);
    (highlightPremoveMoves || highlightValidMoves)(moves);
    // An active check persists during selection (see selectPiece).
    highlightCheck();
  }

  /**
   * Re-render highlights to match the current selection state.
   * Used by onSelectionChange callbacks and re-render loops.
   */
  function updateHighlights() {
    const sel = getSelectedSquare();
    clearHighlights();
    if (sel) {
      highlightPreviousMove();
      if (getSelectionMode() === 'premove') {
        (highlightPremoveSelected || highlightSelected)(sel.file, sel.rank);
        (highlightPremoveMoves || highlightValidMoves)(getValidMovesList());
      } else {
        highlightSelected(sel.file, sel.rank);
        highlightValidMoves(getValidMovesList());
      }
      // An active check persists during selection (see selectPiece).
      highlightCheck();
    } else {
      highlightPreviousMove();
      highlightCheck();
    }
  }

  return { deselect, selectPiece, selectPremove, updateHighlights };
}

/**
 * Register an onSelectionChange callback that updates highlights via the orchestrator.
 * @param {Object} orchestrator — return value of createHighlightOrchestrator
 * @param {Function} [isReady] — optional readiness predicate; updates are skipped when it returns false
 */
export function bindSelectionChange(orchestrator, isReady) {
  onSelectionChange(() => {
    if (isReady && !isReady()) return;
    orchestrator.updateHighlights();
  });
}
