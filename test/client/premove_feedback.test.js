// ═══════════════════════════════════════════════════════════
//  PREMOVE FEEDBACK — owner-only toasts + sound wiring
//  Real network.js + real ui/premove.js; toast and sound are
//  mocked so we can assert exactly what feedback is produced.
// ═══════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the feedback sinks so we can assert on them precisely.
vi.mock('../../client/ui/toast.js', () => ({
  showError: vi.fn(),
  showInfo: vi.fn(),
  showWarning: vi.fn(),
}));
vi.mock('../../client/sound.js', () => ({
  playMove: vi.fn(),
  setMute: vi.fn(),
  isMuted: vi.fn(() => false),
}));

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

describe('premove feedback — owner-only toasts + sound', () => {
  let network;
  let premove;
  let toast;
  let sound;
  let mockWs;

  function createMockWS(readyState) {
    mockWs = {
      readyState,
      send: vi.fn(),
    };
    return mockWs;
  }

  function sendMsg(obj) {
    mockWs.onmessage({ data: JSON.stringify(obj) });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    createMockWS(1); // OPEN

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
    toast = await import('../../client/ui/toast.js');
    sound = await import('../../client/sound.js');
    // Activate the feedback wiring (subscribes to network events).
    await import('../../client/ui/premove.js');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('premove set (private confirmation echo)', () => {
    it('shows a localized "Premove set" toast and plays the pickup sound once', () => {
      sendMsg(makeStateMsg({ role: 'white' }));
      sendMsg({
        type: 'premove',
        fromFile: 4,
        fromRank: 6,
        toFile: 4,
        toRank: 4,
        promotion: null,
      });

      expect(toast.showInfo).toHaveBeenCalledTimes(1);
      expect(toast.showInfo).toHaveBeenCalledWith('Premove set');
      expect(sound.playMove).toHaveBeenCalledTimes(1);
      // Local state is set as a side effect of the echo.
      expect(premove.getPremove()).not.toBeNull();
    });

    it('does not use the error/warning toast channels', () => {
      sendMsg(makeStateMsg({ role: 'white' }));
      sendMsg({ type: 'premove', fromFile: 4, fromRank: 6, toFile: 4, toRank: 4 });
      expect(toast.showError).not.toHaveBeenCalled();
      expect(toast.showWarning).not.toHaveBeenCalled();
    });
  });

  describe('premove played (public move with premove:true)', () => {
    it('owner (msg.color === myRole) gets a localized "Premove played" toast and no extra sound', () => {
      sendMsg(makeStateMsg({ role: 'white' }));
      sendMsg({
        type: 'move',
        fromFile: 4,
        fromRank: 6,
        toFile: 4,
        toRank: 4,
        color: 'white',
        premove: true,
      });

      expect(toast.showInfo).toHaveBeenCalledTimes(1);
      expect(toast.showInfo).toHaveBeenCalledWith('Premove played');
      // No additional sound: the ordinary move animation/sound plays exactly
      // once for all clients through the normal move path. Adding a sound here
      // would double the move sound for the owner.
      expect(sound.playMove).not.toHaveBeenCalled();
    });

    it('opponent (msg.color !== myRole) gets no premove-specific feedback', () => {
      sendMsg(makeStateMsg({ role: 'white' }));
      sendMsg({
        type: 'move',
        fromFile: 4,
        fromRank: 1,
        toFile: 4,
        toRank: 3,
        color: 'black',
        premove: true,
      });

      expect(toast.showInfo).not.toHaveBeenCalled();
      expect(toast.showError).not.toHaveBeenCalled();
      expect(sound.playMove).not.toHaveBeenCalled();
    });

    it('spectator gets no premove-specific feedback', () => {
      sendMsg(makeStateMsg({ role: 'spectator' }));
      sendMsg({
        type: 'move',
        fromFile: 4,
        fromRank: 6,
        toFile: 4,
        toRank: 4,
        color: 'white',
        premove: true,
      });

      expect(toast.showInfo).not.toHaveBeenCalled();
      expect(sound.playMove).not.toHaveBeenCalled();
    });

    it('ordinary move (premove:false) produces no premove feedback', () => {
      sendMsg(makeStateMsg({ role: 'white' }));
      sendMsg({
        type: 'move',
        fromFile: 4,
        fromRank: 6,
        toFile: 4,
        toRank: 4,
        color: 'white',
        premove: false,
      });

      expect(toast.showInfo).not.toHaveBeenCalled();
      expect(sound.playMove).not.toHaveBeenCalled();
    });
  });

  describe('silent discard / clear / cancel', () => {
    it('premoveDiscarded clears state silently (no toast, no sound)', () => {
      sendMsg(makeStateMsg({ role: 'white' }));
      sendMsg({ type: 'premove', fromFile: 4, fromRank: 6, toFile: 4, toRank: 4 });
      toast.showInfo.mockClear();
      sound.playMove.mockClear();

      sendMsg({ type: 'premoveDiscarded', reason: 'error.invalid_move' });

      expect(premove.getPremove()).toBeNull();
      expect(toast.showInfo).not.toHaveBeenCalled();
      expect(toast.showError).not.toHaveBeenCalled();
      expect(toast.showWarning).not.toHaveBeenCalled();
      expect(sound.playMove).not.toHaveBeenCalled();
    });

    it('premoveCleared clears state silently (no toast, no sound)', () => {
      sendMsg(makeStateMsg({ role: 'white' }));
      sendMsg({ type: 'premove', fromFile: 4, fromRank: 6, toFile: 4, toRank: 4 });
      toast.showInfo.mockClear();
      sound.playMove.mockClear();

      sendMsg({ type: 'premoveCleared' });

      expect(premove.getPremove()).toBeNull();
      expect(toast.showInfo).not.toHaveBeenCalled();
      expect(sound.playMove).not.toHaveBeenCalled();
    });

    it('user-initiated cancel is silent (no toast, no sound) — the visual drop is the feedback', () => {
      sendMsg(makeStateMsg({ role: 'white' }));
      sendMsg({ type: 'premove', fromFile: 4, fromRank: 6, toFile: 4, toRank: 4 });
      toast.showInfo.mockClear();
      sound.playMove.mockClear();

      network.cancelPremove();

      expect(premove.getPremove()).toBeNull();
      expect(toast.showInfo).not.toHaveBeenCalled();
      expect(sound.playMove).not.toHaveBeenCalled();
    });
  });

  describe('no duplicate normal move sound', () => {
    it('a full set → execute sequence plays the pickup sound once (set) and no extra sound on execute', () => {
      sendMsg(makeStateMsg({ role: 'white' }));

      // 1) Owner sets a premove → one pickup sound.
      sendMsg({ type: 'premove', fromFile: 4, fromRank: 6, toFile: 4, toRank: 4 });
      expect(sound.playMove).toHaveBeenCalledTimes(1);

      // 2) Opponent moves, then the owner's premove executes (public move,
      //    premove:true, color === myRole). The feedback layer must add NO
      //    sound — the ordinary move animation/sound is the single move sound.
      sound.playMove.mockClear();
      sendMsg({
        type: 'move',
        fromFile: 4,
        fromRank: 1,
        toFile: 4,
        toRank: 3,
        color: 'black',
        premove: false,
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
      expect(sound.playMove).not.toHaveBeenCalled();
    });
  });
});

describe('premove feedback — locale keys present and interpolated', () => {
  const PREMOVE_KEYS = [
    'premove.set',
    'premove.played',
    'premove.discarded',
    'premove.cancelled',
    'premove.status',
  ];

  it('all five locales define every premove key', async () => {
    const { CATALOG } = await import('../../shared/i18n.mjs');
    for (const [code, dict] of Object.entries(CATALOG)) {
      for (const key of PREMOVE_KEYS) {
        expect(dict[key], `${code} missing ${key}`).toBeTypeOf('string');
        expect(dict[key].length, `${code} ${key} is empty`).toBeGreaterThan(0);
      }
    }
  });

  it('premove.status interpolates {move} in every locale', async () => {
    const { t, setLocale, LOCALES } = await import('../../shared/i18n.mjs');
    for (const code of Object.keys(LOCALES)) {
      setLocale(code);
      const out = t('premove.status', { move: 'e2–e4' });
      expect(out, `${code} did not interpolate`).not.toContain('{move}');
      expect(out).toContain('e2–e4');
    }
    setLocale('en-US');
  });

  it('set/played feedback strings are localized (differ from English in non-English locales)', async () => {
    const { t, setLocale } = await import('../../shared/i18n.mjs');
    for (const key of ['premove.set', 'premove.played']) {
      setLocale('en-US');
      const en = t(key);
      for (const code of ['de', 'es', 'fr', 'zh-CN']) {
        setLocale(code);
        expect(t(key), `${code} ${key} should differ from English`).not.toBe(en);
      }
    }
    setLocale('en-US');
  });
});
