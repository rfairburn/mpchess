import { describe, it, expect } from 'vitest';
import { diffBoardState } from '../../client/board_diff.js';

function makeDesired(entries) {
  // entries: [{file, rank, type, color}, ...]
  const m = new Map();
  for (const e of entries) {
    m.set(`${e.file},${e.rank}`, { type: e.type, color: e.color });
  }
  return m;
}

function pm(file, rank, type, color) {
  return { file, rank, type, color };
}

describe('diffBoardState', () => {
  it('returns empty diffs when state matches', () => {
    const desired = makeDesired([pm(0, 0, 'rook', 'white')]);
    const existing = [pm(0, 0, 'rook', 'white')];
    const result = diffBoardState(desired, existing, new Set(), false);

    expect(result.toRemove).toEqual([]);
    expect(result.toUpdate).toEqual([]);
    expect(result.toAdd).toEqual([]);
  });

  it('detects pieces to remove', () => {
    const desired = makeDesired([]);
    const existing = [pm(0, 0, 'rook', 'white'), pm(7, 0, 'rook', 'black')];
    const result = diffBoardState(desired, existing, new Set(), false);

    expect(result.toRemove).toHaveLength(2);
    expect(result.toUpdate).toEqual([]);
    expect(result.toAdd).toEqual([]);
  });

  it('detects pieces to add', () => {
    const desired = makeDesired([pm(0, 0, 'rook', 'white'), pm(7, 0, 'rook', 'black')]);
    const existing = [];
    const result = diffBoardState(desired, existing, new Set(), false);

    expect(result.toRemove).toEqual([]);
    expect(result.toUpdate).toEqual([]);
    expect(result.toAdd).toHaveLength(2);
    expect(result.toAdd).toContainEqual({ file: 0, rank: 0, type: 'rook', color: 'white' });
    expect(result.toAdd).toContainEqual({ file: 7, rank: 0, type: 'rook', color: 'black' });
  });

  it('detects type change (promotion)', () => {
    const existingPawn = pm(4, 7, 'pawn', 'white');
    const desired = makeDesired([pm(4, 7, 'queen', 'white')]);
    const existing = [existingPawn];
    const result = diffBoardState(desired, existing, new Set(), false);

    expect(result.toRemove).toEqual([]);
    expect(result.toUpdate).toHaveLength(1);
    expect(result.toUpdate[0].piece).toBe(existingPawn);
    expect(result.toUpdate[0].newType).toBe('queen');
    expect(result.toUpdate[0].newColor).toBe('white');
    expect(result.toAdd).toEqual([]);
  });

  it('detects color change', () => {
    const desired = makeDesired([pm(0, 0, 'rook', 'black')]);
    const existing = [pm(0, 0, 'rook', 'white')];
    const result = diffBoardState(desired, existing, new Set(), false);

    expect(result.toUpdate).toHaveLength(1);
    expect(result.toUpdate[0].newColor).toBe('black');
  });

  it('handles mixed changes: remove, update, add, keep', () => {
    const desired = makeDesired([
      pm(0, 0, 'rook', 'white'), // keep
      pm(1, 0, 'knight', 'white'), // update (was bishop)
      pm(7, 0, 'rook', 'black'), // add (not in existing)
    ]);
    const existing = [
      pm(0, 0, 'rook', 'white'), // keep
      pm(1, 0, 'bishop', 'white'), // update
      pm(2, 0, 'pawn', 'white'), // remove (not in desired)
    ];
    const result = diffBoardState(desired, existing, new Set(), false);

    expect(result.toRemove).toHaveLength(1);
    expect(result.toRemove[0].type).toBe('pawn');
    expect(result.toUpdate).toHaveLength(1);
    expect(result.toUpdate[0].newType).toBe('knight');
    expect(result.toAdd).toHaveLength(1);
    expect(result.toAdd[0].type).toBe('rook');
  });

  it('skips animating pieces when force=false', () => {
    const desired = makeDesired([pm(4, 7, 'queen', 'white')]);
    const animatingPawn = pm(4, 7, 'pawn', 'white');
    const existing = [animatingPawn];
    const animatingSet = new Set([animatingPawn]);

    const result = diffBoardState(desired, existing, new Set(), false, animatingSet);

    // Animating piece is kept (skipped), not updated or removed
    expect(result.toRemove).toEqual([]);
    expect(result.toUpdate).toEqual([]);
    expect(result.toAdd).toEqual([]);
  });

  it('processes animating pieces when force=true', () => {
    const desired = makeDesired([pm(4, 7, 'queen', 'white')]);
    const animatingPawn = pm(4, 7, 'pawn', 'white');
    const existing = [animatingPawn];
    const animatingSet = new Set([animatingPawn]);

    const result = diffBoardState(desired, existing, new Set(), true, animatingSet);

    // Force=true: animating piece is updated
    expect(result.toUpdate).toHaveLength(1);
    expect(result.toUpdate[0].newType).toBe('queen');
  });

  it('respects skipPositions for additions', () => {
    const desired = makeDesired([pm(3, 4, 'pawn', 'black')]);
    const existing = [];
    const skipPositions = new Set(['3,4']);

    const result = diffBoardState(desired, existing, skipPositions, false);

    // Position is skipped — no addition
    expect(result.toAdd).toEqual([]);
  });

  it('handles full starting position (32 pieces)', () => {
    const startingPieces = [
      pm(0, 0, 'rook', 'white'),
      pm(1, 0, 'knight', 'white'),
      pm(2, 0, 'bishop', 'white'),
      pm(3, 0, 'queen', 'white'),
      pm(4, 0, 'king', 'white'),
      pm(5, 0, 'bishop', 'white'),
      pm(6, 0, 'knight', 'white'),
      pm(7, 0, 'rook', 'white'),
      pm(0, 1, 'pawn', 'white'),
      pm(1, 1, 'pawn', 'white'),
      pm(2, 1, 'pawn', 'white'),
      pm(3, 1, 'pawn', 'white'),
      pm(4, 1, 'pawn', 'white'),
      pm(5, 1, 'pawn', 'white'),
      pm(6, 1, 'pawn', 'white'),
      pm(7, 1, 'pawn', 'white'),
      pm(0, 6, 'pawn', 'black'),
      pm(1, 6, 'pawn', 'black'),
      pm(2, 6, 'pawn', 'black'),
      pm(3, 6, 'pawn', 'black'),
      pm(4, 6, 'pawn', 'black'),
      pm(5, 6, 'pawn', 'black'),
      pm(6, 6, 'pawn', 'black'),
      pm(7, 6, 'pawn', 'black'),
      pm(0, 7, 'rook', 'black'),
      pm(1, 7, 'knight', 'black'),
      pm(2, 7, 'bishop', 'black'),
      pm(3, 7, 'queen', 'black'),
      pm(4, 7, 'king', 'black'),
      pm(5, 7, 'bishop', 'black'),
      pm(6, 7, 'knight', 'black'),
      pm(7, 7, 'rook', 'black'),
    ];
    const desired = makeDesired(startingPieces);
    const result = diffBoardState(desired, [], new Set(), false);

    expect(result.toAdd).toHaveLength(32);
    expect(result.toRemove).toEqual([]);
    expect(result.toUpdate).toEqual([]);
  });

  it('handles empty board', () => {
    const desired = makeDesired([]);
    const result = diffBoardState(desired, [], new Set(), false);

    expect(result.toRemove).toEqual([]);
    expect(result.toUpdate).toEqual([]);
    expect(result.toAdd).toEqual([]);
  });

  it('handles multiple pieces at same position (duplicate existing)', () => {
    // Two pieces at same position, only one in desired — the diff should
    // keep one (matches desired) and mark the other for removal
    const desired = makeDesired([pm(7, 0, 'rook', 'white')]);
    const existing = [pm(7, 0, 'rook', 'white'), pm(7, 0, 'rook', 'black')];
    const result = diffBoardState(desired, existing, new Set(), false);

    // First match is kept, second is removed (no desired entry left for it)
    expect(result.toRemove).toHaveLength(1);
    expect(result.toRemove[0].color).toBe('black');
    expect(result.toAdd).toEqual([]);
    expect(result.toUpdate).toEqual([]);
  });

  it('updates the correct piece when an animating duplicate of the same type exists', () => {
    // Scenario: a white pawn at e7 is animating (mid-capture), and a second
    // white pawn at e7 needs to be promoted to a queen.
    // The diff must update the non-animating pawn, not the animating one.
    const desired = makeDesired([pm(4, 7, 'queen', 'white')]);
    const animatingPawn = pm(4, 7, 'pawn', 'white');
    const stalePawn = pm(4, 7, 'pawn', 'white');
    const existing = [animatingPawn, stalePawn];
    const animatingSet = new Set([animatingPawn]);

    const result = diffBoardState(desired, existing, new Set(), false, animatingSet);

    // Animating pawn is skipped (kept). Stale pawn is updated.
    expect(result.toRemove).toEqual([]);
    expect(result.toUpdate).toHaveLength(1);
    // Critical: the update must reference the stale pawn, NOT the animating one
    expect(result.toUpdate[0].piece).toBe(stalePawn);
    expect(result.toUpdate[0].piece).not.toBe(animatingPawn);
    expect(result.toUpdate[0].newType).toBe('queen');
    expect(result.toAdd).toEqual([]);
  });
});
