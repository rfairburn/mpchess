// ═══════════════════════════════════════════════════════════
//  BOARD DIFF — pure diff algorithm for piece state changes
// ═══════════════════════════════════════════════════════════

/**
 * Compare desired board state against existing piece meshes and return
 * the minimal set of changes needed to sync them.
 *
 * @param {Map<string, {type: string, color: string}>} desired
 *   Map of "file,rank" -> {type, color} representing the authoritative state.
 * @param {Array<{file: number, rank: number, type: string, color: string}>} existing
 *   Current piece meshes on the board.
 * @param {Set<string>} skipPositions
 *   Positions occupied by animating pieces — do not create new pieces here.
 * @param {boolean} force
 *   If true, process animating pieces normally (for promotions / restarts).
 * @param {Set<Object>} [animatingSet]
 *   Set of animating piece objects. Used with `force=false` to skip them.
 *   Defaults to an empty Set.
 * @returns {{
 *   toRemove: Array<{file: number, rank: number, type: string, color: string}>,
 *   toUpdate: Array<{file: number, rank: number, type: string, color: string, newType: string, newColor: string}>,
 *   toAdd: Array<{file: number, rank: number, type: string, color: string}>
 * }}
 */
export function diffBoardState(desired, existing, skipPositions, force, animatingSet = new Set()) {
  const toRemove = [];
  const toUpdate = [];
  const toKeep = new Set();

  // Track which desired positions have already been claimed by an existing piece.
  // If two existing pieces occupy the same square, only the first match is kept;
  // the duplicate is marked for removal.
  const claimed = new Set();

  for (const pm of existing) {
    const isAnimating = animatingSet.has(pm);
    const key = `${pm.file},${pm.rank}`;

    // Skip animating pieces unless force=true
    if (isAnimating && !force) {
      toKeep.add(key);
      continue;
    }

    const desiredPiece = desired.get(key);
    if (!desiredPiece) {
      // Piece no longer exists on the board
      toRemove.push(pm);
    } else if (claimed.has(key)) {
      // Desired position already claimed by another piece at this square — duplicate
      toRemove.push(pm);
    } else if (desiredPiece.type !== pm.type || desiredPiece.color !== pm.color) {
      // Piece changed type or color (e.g., promotion)
      toUpdate.push({
        piece: pm,
        file: pm.file,
        rank: pm.rank,
        type: pm.type,
        color: pm.color,
        newType: desiredPiece.type,
        newColor: desiredPiece.color,
      });
      toKeep.add(key);
      claimed.add(key);
    } else {
      // Unchanged
      toKeep.add(key);
      claimed.add(key);
    }
  }

  // Pieces in desired state that have no mesh yet
  const toAdd = [];
  for (const [key, desiredPiece] of desired) {
    if (!toKeep.has(key) && !skipPositions.has(key)) {
      const [f, r] = key.split(',').map(Number);
      toAdd.push({
        file: f,
        rank: r,
        type: desiredPiece.type,
        color: desiredPiece.color,
      });
    }
  }

  return { toRemove, toUpdate, toAdd };
}
