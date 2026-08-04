// ═══════════════════════════════════════════════════════════
//  HIGHLIGHT ORCHESTRATION — renderer-agnostic select/deselect/update
// ═══════════════════════════════════════════════════════════

import {
  clearSelection,
  getSelectedSquare,
  getValidMovesList,
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
 * @returns {{ deselect: Function, selectPiece: Function, updateHighlights: Function }}
 */
export function createHighlightOrchestrator(renderers) {
  const {
    clearHighlights,
    highlightPreviousMove,
    highlightSelected,
    highlightValidMoves,
    highlightCheck,
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
      highlightSelected(sel.file, sel.rank);
      highlightValidMoves(getValidMovesList());
    } else {
      highlightPreviousMove();
      highlightCheck();
    }
  }

  return { deselect, selectPiece, updateHighlights };
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
