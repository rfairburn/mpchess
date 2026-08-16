// ═══════════════════════════════════════════════════════════
//  3D PREMOVE — read-only E2E hook snapshot guarantee
//  The __testPremove3D hook must return SNAPSHOTS of the internal
//  premove / confirmed-square objects, never the live references.
//  Hostile page code (or a test) mutating a returned result must not
//  corrupt the internal premove/renderer state.
// ═══════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../client/network.js', () => ({
  onEvaluation: vi.fn(),
  serverEvaluation: null,
  serverBoard: null,
  serverTurn: 'white',
  previousMove: null,
}));
vi.mock('../../shared/chess.mjs', () => ({
  findKing: vi.fn(),
  isInCheck: vi.fn(),
}));

describe('3D premove — __testPremove3D returns snapshots (read-only hook)', () => {
  let board, premove;

  // e2–e4 premove
  const PRE = { fromFile: 4, fromRank: 1, toFile: 4, toRank: 3 };

  beforeEach(async () => {
    vi.resetModules();
    board = await import('../../client/board.js');
    premove = await import('../../client/premove.js');
  });

  afterEach(() => {
    premove.clearPremove();
  });

  it('mutating a returned result does not corrupt the internal premove state', () => {
    premove.setPremove(PRE);
    const snap1 = window.__testPremove3D();
    expect(snap1.premove).toMatchObject(PRE);
    expect(snap1.confirmedSquares).toMatchObject(PRE);

    // Mutate the returned snapshots (as hostile page code could)
    snap1.premove.toFile = 999;
    snap1.premove.toRank = 999;
    snap1.confirmedSquares.toFile = 999;
    snap1.confirmedSquares.toRank = 999;

    // A subsequent call must reflect the UNCHANGED internal state
    const snap2 = window.__testPremove3D();
    expect(snap2.premove).toMatchObject(PRE);
    expect(snap2.confirmedSquares).toMatchObject(PRE);

    // The live internal state is intact
    expect(premove.getPremove()).toMatchObject(PRE);
    expect(board.getPremoveConfirmedSquares()).toMatchObject(PRE);
  });

  it('returns null (not a live object) when no premove is pending', () => {
    expect(window.__testPremove3D().premove).toBeNull();
    expect(window.__testPremove3D().confirmedSquares).toBeNull();
  });
});
