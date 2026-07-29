import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('network previousMove synchronization', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('sets previousMove from a state message', async () => {
    const network = await import('../../client/network.js');
    const lastMove = {
      fromFile: 4,
      fromRank: 1,
      toFile: 4,
      toRank: 3,
    };

    network.handleServerMessage({
      data: JSON.stringify({
        type: 'state',
        role: 'white',
        board: Array.from({ length: 8 }, () => Array(8).fill(0)),
        turn: 'black',
        promotingPiece: null,
        gameOver: false,
        gameResult: null,
        moveHistory: ['e4'],
        castlingRights: { wK: true, wQ: true, bK: true, bQ: true },
        enPassantTarget: null,
        lastMove,
        fen: '',
      }),
    });

    expect(network.previousMove).toEqual(lastMove);
  });

  it('clears previousMove through the restart handler', async () => {
    const network = await import('../../client/network.js');
    const lastMove = {
      fromFile: 4,
      fromRank: 1,
      toFile: 4,
      toRank: 3,
    };

    network.handleServerMessage({
      data: JSON.stringify({
        type: 'state',
        role: 'white',
        board: Array.from({ length: 8 }, () => Array(8).fill(0)),
        turn: 'black',
        promotingPiece: null,
        gameOver: false,
        gameResult: null,
        moveHistory: ['e4'],
        castlingRights: { wK: true, wQ: true, bK: true, bQ: true },
        enPassantTarget: null,
        lastMove,
        fen: '',
      }),
    });
    expect(network.previousMove).toEqual(lastMove);

    network.handleServerMessage({
      data: JSON.stringify({ type: 'restart' }),
    });

    expect(network.previousMove).toBeNull();
  });
});
