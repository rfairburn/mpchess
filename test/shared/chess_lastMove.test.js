// ═══════════════════════════════════════════════════════════
//  Game.lastMove — regression tests for server-side tracking
// ═══════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from 'vitest';
import { Game } from '../../shared/chess.js';

describe('Game.lastMove', () => {
  let game;

  beforeEach(() => {
    game = new Game();
  });

  it('is null at game start', () => {
    expect(game.lastMove).toBeNull();
  });

  it('is set after a successful move', () => {
    const ws = { _test: true };
    game.players.set(ws, 'white');

    const result = game.tryMove(ws, 4, 1, 4, 3); // e2-e4
    expect(result.ok).toBe(true);
    expect(game.lastMove).toEqual({
      fromFile: 4,
      fromRank: 1,
      toFile: 4,
      toRank: 3,
    });
  });

  it('is included in getState()', () => {
    const ws = { _test: true };
    game.players.set(ws, 'white');

    game.tryMove(ws, 4, 1, 4, 3);
    const state = game.getState();

    expect(state.lastMove).toEqual({
      fromFile: 4,
      fromRank: 1,
      toFile: 4,
      toRank: 3,
    });
  });

  it('is cleared by reset()', () => {
    const ws = { _test: true };
    game.players.set(ws, 'white');

    game.tryMove(ws, 4, 1, 4, 3);
    expect(game.lastMove).not.toBeNull();

    game.reset();
    expect(game.lastMove).toBeNull();
  });

  it('is cleared by loadFromFen()', () => {
    const ws = { _test: true };
    game.players.set(ws, 'white');

    // Make a move so lastMove is set
    game.tryMove(ws, 4, 1, 4, 3);
    expect(game.lastMove).toEqual({
      fromFile: 4,
      fromRank: 1,
      toFile: 4,
      toRank: 3,
    });

    // Import a completely different position
    game.loadFromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');

    expect(game.lastMove).toBeNull();
    expect(game.getState().lastMove).toBeNull();
  });

  it('updates correctly across multiple moves', () => {
    const wsWhite = { _test: 'white' };
    const wsBlack = { _test: 'black' };
    game.players.set(wsWhite, 'white');
    game.players.set(wsBlack, 'black');

    game.tryMove(wsWhite, 4, 1, 4, 3); // e4
    expect(game.lastMove.toFile).toBe(4);
    expect(game.lastMove.toRank).toBe(3);

    game.tryMove(wsBlack, 3, 6, 3, 4); // e5
    expect(game.lastMove.toFile).toBe(3);
    expect(game.lastMove.toRank).toBe(4);
  });

  it('is not set for failed moves', () => {
    const ws = { _test: true };
    game.players.set(ws, 'white');

    // Try an invalid move
    const result = game.tryMove(ws, 0, 0, 7, 7);
    expect(result.ok).toBe(false);
    expect(game.lastMove).toBeNull();
  });
});
