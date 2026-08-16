// ═══════════════════════════════════════════════════════════
//  PREMOVE — client state module + network protocol tests
// ═══════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ── premove.js — state module ─────────────────────────────

describe('premove.js — state module', () => {
  let premove;

  beforeEach(async () => {
    vi.resetModules();
    localStorage.removeItem('premoveEnabled');
    localStorage.removeItem('premoveNotifyDiscarded');
    premove = await import('../../client/premove.js');
  });

  it('starts with no premove', () => {
    expect(premove.getPremove()).toBeNull();
  });

  it('setPremove stores the canonical shape', () => {
    premove.setPremove({ fromFile: 4, fromRank: 6, toFile: 4, toRank: 4, promotion: null });
    expect(premove.getPremove()).toEqual({
      fromFile: 4,
      fromRank: 6,
      toFile: 4,
      toRank: 4,
      promotion: null,
    });
  });

  it('normalizes: drops extra fields and defaults promotion to null', () => {
    premove.setPremove({
      fromFile: 0,
      fromRank: 7,
      toFile: 1,
      toRank: 5,
      extra: 'x',
      promotion: undefined,
    });
    expect(premove.getPremove()).toEqual({
      fromFile: 0,
      fromRank: 7,
      toFile: 1,
      toRank: 5,
      promotion: null,
    });
  });

  it('normalizes: non-string promotion becomes null', () => {
    premove.setPremove({ fromFile: 0, fromRank: 7, toFile: 1, toRank: 5, promotion: 42 });
    expect(premove.getPremove().promotion).toBeNull();
  });

  it('normalizes: malformed coordinates become null', () => {
    premove.setPremove({ fromFile: 'a', fromRank: 7, toFile: 1, toRank: 5 });
    expect(premove.getPremove()).toBeNull();
    premove.setPremove({ fromFile: 0, toFile: 1, toRank: 5 });
    expect(premove.getPremove()).toBeNull();
  });

  it('normalizes: out-of-range coordinates (any of the four) become null', () => {
    // Valid origin, out-of-range destination — the case that would otherwise
    // let a renderer place a ghost off-board / on a wrapped square
    premove.setPremove({ fromFile: 4, fromRank: 1, toFile: 9, toRank: 3 });
    expect(premove.getPremove()).toBeNull();
    premove.setPremove({ fromFile: 4, fromRank: 1, toFile: 4, toRank: -1 });
    expect(premove.getPremove()).toBeNull();
    // Out-of-range origin
    premove.setPremove({ fromFile: 8, fromRank: 1, toFile: 4, toRank: 3 });
    expect(premove.getPremove()).toBeNull();
    premove.setPremove({ fromFile: 4, fromRank: 8, toFile: 4, toRank: 3 });
    expect(premove.getPremove()).toBeNull();
    // Boundary values 0 and 7 are valid
    premove.setPremove({ fromFile: 0, fromRank: 0, toFile: 7, toRank: 7 });
    expect(premove.getPremove()).toEqual({
      fromFile: 0,
      fromRank: 0,
      toFile: 7,
      toRank: 7,
      promotion: null,
    });
  });

  it('setPremove(null) clears an existing premove', () => {
    premove.setPremove({ fromFile: 0, fromRank: 7, toFile: 1, toRank: 5 });
    premove.setPremove(null);
    expect(premove.getPremove()).toBeNull();
  });

  it('notifies subscribers on set and on clear', () => {
    const cb = vi.fn();
    premove.onPremoveChange(cb);
    premove.setPremove({ fromFile: 0, fromRank: 7, toFile: 1, toRank: 5 });
    expect(cb).toHaveBeenCalledTimes(1);
    premove.clearPremove();
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('does not notify when setting the same value', () => {
    const cb = vi.fn();
    premove.onPremoveChange(cb);
    const p = { fromFile: 0, fromRank: 7, toFile: 1, toRank: 5, promotion: null };
    premove.setPremove(p);
    premove.setPremove({ ...p });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('does not notify when clearing with nothing set', () => {
    const cb = vi.fn();
    premove.onPremoveChange(cb);
    premove.clearPremove();
    premove.setPremove(null);
    expect(cb).not.toHaveBeenCalled();
  });

  it('notifies multiple subscribers', () => {
    const a = vi.fn();
    const b = vi.fn();
    premove.onPremoveChange(a);
    premove.onPremoveChange(b);
    premove.setPremove({ fromFile: 0, fromRank: 7, toFile: 1, toRank: 5 });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('notifies when a new premove replaces the old one', () => {
    const cb = vi.fn();
    premove.onPremoveChange(cb);
    premove.setPremove({ fromFile: 0, fromRank: 7, toFile: 1, toRank: 5 });
    premove.setPremove({ fromFile: 4, fromRank: 6, toFile: 4, toRank: 4 });
    expect(cb).toHaveBeenCalledTimes(2);
    expect(premove.getPremove().fromFile).toBe(4);
  });

  it('defaults premoves on and discard notifications off', () => {
    expect(premove.isPremoveEnabled()).toBe(true);
    expect(premove.shouldNotifyPremoveDiscarded()).toBe(false);
  });

  it('persists premove preferences across module reloads', async () => {
    premove.setPremoveEnabled(false);
    premove.setNotifyPremoveDiscarded(true);
    expect(localStorage.getItem('premoveEnabled')).toBe('false');
    expect(localStorage.getItem('premoveNotifyDiscarded')).toBe('true');

    vi.resetModules();
    premove = await import('../../client/premove.js');
    expect(premove.isPremoveEnabled()).toBe(false);
    expect(premove.shouldNotifyPremoveDiscarded()).toBe(true);
  });
});

// ── network.js — premove protocol ─────────────────────────

function makeStateMsg(overrides = {}) {
  return {
    type: 'state',
    role: 'white',
    board: Array.from({ length: 8 }, () => Array(8).fill(0)),
    turn: 'white',
    promotingPiece: null,
    gameOver: false,
    gameResult: null,
    moveHistory: [],
    castlingRights: { wK: true, wQ: true, bK: true, bQ: true },
    enPassantTarget: null,
    disconnectedPlayers: [],
    seats: { white: { status: 'connected' }, black: { status: 'unknown' } },
    fen: '',
    ...overrides,
  };
}

describe('network.js — premove protocol', () => {
  let network;
  let premove;
  let mockWs;
  let sentMessages = [];

  function createMockWS(readyState) {
    sentMessages = [];
    mockWs = {
      readyState,
      send: vi.fn((data) => sentMessages.push(JSON.parse(data))),
    };
    return mockWs;
  }

  function sendMsg(obj) {
    mockWs.onmessage({ data: JSON.stringify(obj) });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    createMockWS(1); // OPEN by default

    const store = {};
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (key) => store[key] ?? null,
        setItem: (key, val) => {
          store[key] = val;
        },
        removeItem: (key) => {
          delete store[key];
        },
      },
      writable: true,
    });

    Object.defineProperty(globalThis, 'location', {
      value: { protocol: 'http:', host: 'localhost:3000' },
      writable: true,
    });

    globalThis.WebSocket = class {
      static CONNECTING = 0;
      static OPEN = 1;
      constructor() {
        return mockWs;
      }
    };

    network = await import('../../client/network.js');
    premove = await import('../../client/premove.js');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('senders', () => {
    it('sendPremove serializes without promotion when not supplied', () => {
      network.sendPremove(4, 6, 4, 4);
      expect(sentMessages).toEqual([
        { type: 'premove', fromFile: 4, fromRank: 6, toFile: 4, toRank: 4 },
      ]);
    });

    it('sendPremove serializes with promotion when supplied', () => {
      network.sendPremove(4, 6, 4, 0, 'queen');
      expect(sentMessages).toEqual([
        { type: 'premove', fromFile: 4, fromRank: 6, toFile: 4, toRank: 0, promotion: 'queen' },
      ]);
    });

    it('sendPremoveCancel serializes', () => {
      network.sendPremoveCancel();
      expect(sentMessages).toEqual([{ type: 'premoveCancel' }]);
    });

    it('cancelPremove sends exactly one premoveCancel and clears local state optimistically', () => {
      // A pending premove is set (e.g. via the server confirmation echo)
      premove.setPremove({ fromFile: 4, fromRank: 6, toFile: 4, toRank: 4 });
      expect(premove.getPremove()).not.toBeNull();

      network.cancelPremove();

      // Exactly one protocol send
      expect(sentMessages).toEqual([{ type: 'premoveCancel' }]);
      // Optimistic local clear — the visual drops immediately, before any
      // server echo arrives
      expect(premove.getPremove()).toBeNull();
    });

    it('cancelPremove with no pending premove still sends the cancel (idempotent server-side)', () => {
      expect(premove.getPremove()).toBeNull();
      network.cancelPremove();
      expect(sentMessages).toEqual([{ type: 'premoveCancel' }]);
      expect(premove.getPremove()).toBeNull();
    });

    it('does not send premove messages when socket is CONNECTING', async () => {
      vi.resetModules();
      createMockWS(0);
      globalThis.WebSocket = class {
        static CONNECTING = 0;
        static OPEN = 1;
        constructor() {
          return mockWs;
        }
      };
      network = await import('../../client/network.js');
      network.sendPremove(4, 6, 4, 4);
      network.sendPremoveCancel();
      expect(sentMessages).toEqual([]);
    });

    it('does not send premove messages when socket is CLOSED', async () => {
      vi.resetModules();
      createMockWS(3);
      globalThis.WebSocket = class {
        static CONNECTING = 0;
        static OPEN = 1;
        constructor() {
          return mockWs;
        }
      };
      network = await import('../../client/network.js');
      network.sendPremove(4, 6, 4, 4);
      network.sendPremoveCancel();
      expect(sentMessages).toEqual([]);
    });
  });

  describe('server message handling', () => {
    it('premove confirmation echo sets local state', () => {
      sendMsg(makeStateMsg());
      sendMsg({
        type: 'premove',
        fromFile: 4,
        fromRank: 6,
        toFile: 4,
        toRank: 4,
        promotion: null,
      });
      expect(premove.getPremove()).toEqual({
        fromFile: 4,
        fromRank: 6,
        toFile: 4,
        toRank: 4,
        promotion: null,
      });
    });

    it('premoveDiscarded clears local state silently', () => {
      sendMsg(makeStateMsg());
      sendMsg({
        type: 'premove',
        fromFile: 4,
        fromRank: 6,
        toFile: 4,
        toRank: 4,
        promotion: null,
      });
      const onMove = vi.fn();
      const onError = vi.fn();
      network.onMove(onMove);
      network.onError(onError);
      sendMsg({ type: 'premoveDiscarded', reason: 'error.invalid_move' });
      expect(premove.getPremove()).toBeNull();
      expect(onMove).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    });

    it('premoveCleared clears local state silently', () => {
      sendMsg(makeStateMsg());
      sendMsg({
        type: 'premove',
        fromFile: 4,
        fromRank: 6,
        toFile: 4,
        toRank: 4,
        promotion: null,
      });
      sendMsg({ type: 'premoveCleared' });
      expect(premove.getPremove()).toBeNull();
    });

    it('move with premove:true and matching color clears local state', () => {
      sendMsg(makeStateMsg({ role: 'white' }));
      sendMsg({
        type: 'premove',
        fromFile: 4,
        fromRank: 6,
        toFile: 4,
        toRank: 4,
        promotion: null,
      });
      sendMsg({
        type: 'move',
        fromFile: 4,
        fromRank: 6,
        toFile: 4,
        toRank: 4,
        color: 'white',
        premove: true,
      });
      expect(premove.getPremove()).toBeNull();
    });

    it('move with premove:true from the OTHER color does not clear local state', () => {
      sendMsg(makeStateMsg({ role: 'white' }));
      sendMsg({
        type: 'premove',
        fromFile: 4,
        fromRank: 1,
        toFile: 4,
        toRank: 3,
        promotion: null,
      });
      // Black's premove executes — white's pending premove must survive
      sendMsg({
        type: 'move',
        fromFile: 4,
        fromRank: 6,
        toFile: 4,
        toRank: 4,
        color: 'black',
        premove: true,
      });
      expect(premove.getPremove()).toEqual({
        fromFile: 4,
        fromRank: 1,
        toFile: 4,
        toRank: 3,
        promotion: null,
      });
    });

    it('move with premove:true does not clear state for a spectator', () => {
      sendMsg(makeStateMsg({ role: 'spectator' }));
      // Stale local state must survive: a spectator's myRole never matches
      // the mover color, so premove:true alone cannot clear it.
      premove.setPremove({ fromFile: 4, fromRank: 1, toFile: 4, toRank: 3 });
      sendMsg({
        type: 'move',
        fromFile: 4,
        fromRank: 6,
        toFile: 4,
        toRank: 4,
        color: 'white',
        premove: true,
      });
      expect(premove.getPremove()).not.toBeNull();
    });

    it('ordinary move (premove:false) does not clear local state', () => {
      sendMsg(makeStateMsg({ role: 'white' }));
      sendMsg({
        type: 'premove',
        fromFile: 4,
        fromRank: 1,
        toFile: 4,
        toRank: 3,
        promotion: null,
      });
      sendMsg({
        type: 'move',
        fromFile: 4,
        fromRank: 6,
        toFile: 4,
        toRank: 4,
        color: 'white',
        premove: false,
      });
      expect(premove.getPremove()).toEqual({
        fromFile: 4,
        fromRank: 1,
        toFile: 4,
        toRank: 3,
        promotion: null,
      });
    });

    it('move without a premove field does not clear local state', () => {
      sendMsg(makeStateMsg({ role: 'white' }));
      sendMsg({
        type: 'premove',
        fromFile: 4,
        fromRank: 1,
        toFile: 4,
        toRank: 3,
        promotion: null,
      });
      sendMsg({ type: 'move', fromFile: 4, fromRank: 6, toFile: 4, toRank: 4 });
      expect(premove.getPremove()).not.toBeNull();
    });

    it('state restores the owner premove on reconnect', () => {
      // First session: premove set via confirmation echo
      sendMsg(makeStateMsg({ role: 'white', premove: null }));
      sendMsg({
        type: 'premove',
        fromFile: 4,
        fromRank: 6,
        toFile: 4,
        toRank: 4,
        promotion: null,
      });
      // Reconnect: fresh state message carries the stored premove
      sendMsg(
        makeStateMsg({
          role: 'white',
          premove: { fromFile: 4, fromRank: 6, toFile: 4, toRank: 4, promotion: null },
        })
      );
      expect(premove.getPremove()).toEqual({
        fromFile: 4,
        fromRank: 6,
        toFile: 4,
        toRank: 4,
        promotion: null,
      });
    });

    it('state clears and cancels a restored premove when premoves are disabled', () => {
      premove.setPremoveEnabled(false);
      sendMsg(
        makeStateMsg({
          role: 'white',
          premove: { fromFile: 4, fromRank: 6, toFile: 4, toRank: 4, promotion: null },
        })
      );

      expect(premove.getPremove()).toBeNull();
      expect(sentMessages).toContainEqual({ type: 'premoveCancel' });
    });

    it('state with explicit premove:null clears local state', () => {
      sendMsg(makeStateMsg({ role: 'white' }));
      sendMsg({
        type: 'premove',
        fromFile: 4,
        fromRank: 6,
        toFile: 4,
        toRank: 4,
        promotion: null,
      });
      sendMsg(makeStateMsg({ role: 'white', premove: null }));
      expect(premove.getPremove()).toBeNull();
    });

    it('state without a premove field clears local state', () => {
      sendMsg(makeStateMsg({ role: 'white' }));
      sendMsg({
        type: 'premove',
        fromFile: 4,
        fromRank: 6,
        toFile: 4,
        toRank: 4,
        promotion: null,
      });
      const msg = makeStateMsg({ role: 'white' });
      delete msg.premove;
      sendMsg(msg);
      expect(premove.getPremove()).toBeNull();
    });

    it('restart clears local state', () => {
      sendMsg(makeStateMsg({ role: 'white' }));
      sendMsg({
        type: 'premove',
        fromFile: 4,
        fromRank: 6,
        toFile: 4,
        toRank: 4,
        promotion: null,
      });
      sendMsg({ type: 'restart' });
      expect(premove.getPremove()).toBeNull();
    });

    it('left clears local state', () => {
      sendMsg(makeStateMsg({ role: 'white' }));
      sendMsg({
        type: 'premove',
        fromFile: 4,
        fromRank: 6,
        toFile: 4,
        toRank: 4,
        promotion: null,
      });
      sendMsg({ type: 'left' });
      expect(premove.getPremove()).toBeNull();
    });

    it('reconnectFailed clears local state', () => {
      sendMsg(makeStateMsg({ role: 'white' }));
      sendMsg({
        type: 'premove',
        fromFile: 4,
        fromRank: 6,
        toFile: 4,
        toRank: 4,
        promotion: null,
      });
      sendMsg({ type: 'reconnectFailed' });
      expect(premove.getPremove()).toBeNull();
    });

    it('game-over state (premove:null) clears local state', () => {
      sendMsg(makeStateMsg({ role: 'white' }));
      sendMsg({
        type: 'premove',
        fromFile: 4,
        fromRank: 6,
        toFile: 4,
        toRank: 4,
        promotion: null,
      });
      sendMsg(
        makeStateMsg({
          role: 'white',
          gameOver: true,
          gameResult: 'checkmate',
          premove: null,
        })
      );
      expect(premove.getPremove()).toBeNull();
    });
  });

  describe('no regression to normal message processing', () => {
    it('onMove still fires with the full message for a premove move', () => {
      sendMsg(makeStateMsg({ role: 'white' }));
      const onMove = vi.fn();
      network.onMove(onMove);
      const msg = {
        type: 'move',
        fromFile: 4,
        fromRank: 6,
        toFile: 4,
        toRank: 4,
        color: 'white',
        premove: true,
      };
      sendMsg(msg);
      expect(onMove).toHaveBeenCalledWith(msg);
    });

    it('onMove still fires for ordinary moves', () => {
      const onMove = vi.fn();
      network.onMove(onMove);
      const msg = {
        type: 'move',
        fromFile: 0,
        fromRank: 7,
        toFile: 2,
        toRank: 5,
        color: 'white',
        premove: false,
      };
      sendMsg(msg);
      expect(onMove).toHaveBeenCalledWith(msg);
    });

    it('onStateUpdate still fires and state fields still sync', () => {
      const onStateUpdate = vi.fn();
      network.onStateUpdate(onStateUpdate);
      const msg = makeStateMsg({ role: 'black', premove: null });
      sendMsg(msg);
      expect(onStateUpdate).toHaveBeenCalledWith(msg);
      expect(network.myRole).toBe('black');
    });

    it('onRestart still fires', () => {
      const onRestart = vi.fn();
      network.onRestart(onRestart);
      sendMsg({ type: 'restart' });
      expect(onRestart).toHaveBeenCalled();
    });
  });

  describe('premove feedback events (owner-only)', () => {
    it('premoveSet fires on the private confirmation echo', () => {
      sendMsg(makeStateMsg({ role: 'white' }));
      const onPremoveSet = vi.fn();
      network.onPremoveSet(onPremoveSet);
      const echo = {
        type: 'premove',
        fromFile: 4,
        fromRank: 6,
        toFile: 4,
        toRank: 4,
        promotion: null,
      };
      sendMsg(echo);
      expect(onPremoveSet).toHaveBeenCalledTimes(1);
      expect(onPremoveSet).toHaveBeenCalledWith(echo);
    });

    it('premovePlayed fires for the owner when their premove executes', () => {
      sendMsg(makeStateMsg({ role: 'white' }));
      const onPremovePlayed = vi.fn();
      network.onPremovePlayed(onPremovePlayed);
      const msg = {
        type: 'move',
        fromFile: 4,
        fromRank: 6,
        toFile: 4,
        toRank: 4,
        color: 'white',
        premove: true,
      };
      sendMsg(msg);
      expect(onPremovePlayed).toHaveBeenCalledTimes(1);
      expect(onPremovePlayed).toHaveBeenCalledWith(msg);
    });

    it("premovePlayed does NOT fire for the opponent's premove", () => {
      sendMsg(makeStateMsg({ role: 'white' }));
      const onPremovePlayed = vi.fn();
      network.onPremovePlayed(onPremovePlayed);
      sendMsg({
        type: 'move',
        fromFile: 4,
        fromRank: 1,
        toFile: 4,
        toRank: 3,
        color: 'black',
        premove: true,
      });
      expect(onPremovePlayed).not.toHaveBeenCalled();
    });

    it('premovePlayed does NOT fire for a spectator', () => {
      sendMsg(makeStateMsg({ role: 'spectator' }));
      const onPremovePlayed = vi.fn();
      network.onPremovePlayed(onPremovePlayed);
      sendMsg({
        type: 'move',
        fromFile: 4,
        fromRank: 6,
        toFile: 4,
        toRank: 4,
        color: 'white',
        premove: true,
      });
      expect(onPremovePlayed).not.toHaveBeenCalled();
    });

    it('premovePlayed does NOT fire for an ordinary (non-premove) move', () => {
      sendMsg(makeStateMsg({ role: 'white' }));
      const onPremovePlayed = vi.fn();
      network.onPremovePlayed(onPremovePlayed);
      sendMsg({
        type: 'move',
        fromFile: 4,
        fromRank: 6,
        toFile: 4,
        toRank: 4,
        color: 'white',
        premove: false,
      });
      expect(onPremovePlayed).not.toHaveBeenCalled();
    });

    it('emits premoveDiscarded but keeps premoveCleared silent', () => {
      sendMsg(makeStateMsg({ role: 'white' }));
      const onPremoveSet = vi.fn();
      const onPremovePlayed = vi.fn();
      const onPremoveDiscarded = vi.fn();
      network.onPremoveSet(onPremoveSet);
      network.onPremovePlayed(onPremovePlayed);
      network.onPremoveDiscarded(onPremoveDiscarded);
      const discarded = { type: 'premoveDiscarded', reason: 'error.invalid_move' };
      sendMsg(discarded);
      sendMsg({ type: 'premoveCleared' });
      expect(onPremoveSet).not.toHaveBeenCalled();
      expect(onPremovePlayed).not.toHaveBeenCalled();
      expect(onPremoveDiscarded).toHaveBeenCalledOnce();
      expect(onPremoveDiscarded).toHaveBeenCalledWith(discarded);
    });
  });
});
