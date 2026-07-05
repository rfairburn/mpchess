import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// -- Tests for computer-player network handling -----------
// Covers S3 client-side: computerPlayer state updates, callback
// registration/firing for computerActivated, computerThinking,
// computerSkillChanged, computerUnavailable, and send functions.

vi.mock('../../client/ui.js', () => ({
  menuOpen: false,
  showMenu: vi.fn(),
  hideMenu: vi.fn(),
  updateMouseModeDisplay: vi.fn(),
  hidePromotionPicker: vi.fn(),
  hideConcedeConfirm: vi.fn(),
  mouseSensitivity: 0.002,
  showError: vi.fn(),
  showInfo: vi.fn(),
}));

vi.mock('../../client/controls.js', () => ({
  setCameraForRole: vi.fn(),
}));

describe('network.js -- computer player state and callbacks', () => {
  let mockWsInstance;
  let network;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    class TrackableWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      constructor(url) {
        this.url = url;
        this.readyState = TrackableWebSocket.CONNECTING;
        this._onopen = null;
        this._onclose = null;
        this._onerror = null;
        this._onmessage = null;
        this.sentData = [];
        mockWsInstance = this;
      }

      set onopen(fn) {
        this._onopen = fn;
      }
      set onclose(fn) {
        this._onclose = fn;
      }
      set onerror(fn) {
        this._onerror = fn;
      }
      set onmessage(fn) {
        this._onmessage = fn;
      }

      send(data) {
        this.sentData.push(data);
      }
      close() {}
    }

    globalThis.WebSocket = TrackableWebSocket;

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

    vi.spyOn(console, 'error').mockImplementation(() => {});

    network = await import('../../client/network.js');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Helper: send a state message with optional computerPlayer field
  function sendState(opts = {}) {
    const board = opts.board || Array.from({ length: 8 }, () => Array(8).fill(0));
    mockWsInstance._onmessage?.({
      data: JSON.stringify({
        type: 'state',
        role: opts.role || 'white',
        board,
        turn: opts.turn || 'white',
        promotingPiece: null,
        gameOver: opts.gameOver || false,
        gameResult: null,
        moveHistory: [],
        castlingRights: { wK: true, wQ: true, bK: true, bQ: true },
        enPassantTarget: null,
        disconnectedPlayers: [],
        seats: opts.seats || {
          white: { status: 'connected' },
          black: { status: 'connected' },
        },
        computerPlayer: opts.computerPlayer ?? null,
        fen: '',
        halfmoveClock: 0,
        threefoldCount: 0,
      }),
    });
  }

  function sendMessage(msg) {
    mockWsInstance._onmessage?.({ data: JSON.stringify(msg) });
  }

  // -- computerPlayer state updates ----------------------

  describe('computerPlayer state', () => {
    it('updates computerPlayer when state includes it', () => {
      sendState({ computerPlayer: { color: 'black', skill: 'beginner' } });
      expect(network.computerPlayer).toEqual({ color: 'black', skill: 'beginner' });
    });

    it('clears computerPlayer when state has null', () => {
      // First set it
      sendState({ computerPlayer: { color: 'black', skill: 'beginner' } });
      expect(network.computerPlayer).toEqual({ color: 'black', skill: 'beginner' });

      // Then clear it
      sendState({ computerPlayer: null });
      expect(network.computerPlayer).toBeNull();
    });

    it('defaults computerPlayer to null when not in state', () => {
      sendState({});
      expect(network.computerPlayer).toBeNull();
    });
  });

  // -- computerActivated callback -------------------------

  describe('onComputerActivated', () => {
    it('fires callback with skill when computerActivated received', () => {
      const cb = vi.fn();
      network.onComputerActivated(cb);

      sendMessage({ type: 'computerActivated', color: 'black', skill: 'master' });

      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith({
        type: 'computerActivated',
        color: 'black',
        skill: 'master',
      });
    });

    it('supports multiple callbacks', () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      network.onComputerActivated(cb1);
      network.onComputerActivated(cb2);

      sendMessage({ type: 'computerActivated', color: 'black', skill: 'beginner' });

      expect(cb1).toHaveBeenCalledTimes(1);
      expect(cb2).toHaveBeenCalledTimes(1);
    });
  });

  // -- computerThinking callback -------------------------

  describe('onComputerThinking', () => {
    it('fires callback with color when computerThinking received', () => {
      const cb = vi.fn();
      network.onComputerThinking(cb);

      sendMessage({ type: 'computerThinking', color: 'black' });

      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith({ type: 'computerThinking', color: 'black' });
    });
  });

  // -- computerSkillChanged callback ----------------------

  describe('onComputerSkillChanged', () => {
    it('fires callback with new skill when computerSkillChanged received', () => {
      const cb = vi.fn();
      network.onComputerSkillChanged(cb);

      sendMessage({ type: 'computerSkillChanged', color: 'black', skill: 'grandmaster' });

      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith({
        type: 'computerSkillChanged',
        color: 'black',
        skill: 'grandmaster',
      });
    });
  });

  // -- computerUnavailable callback -----------------------

  describe('onComputerUnavailable', () => {
    it('fires callback with reason when computerUnavailable received', () => {
      const cb = vi.fn();
      network.onComputerUnavailable(cb);

      sendMessage({
        type: 'computerUnavailable',
        color: 'black',
        reason: 'Engine crashed',
      });

      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith({
        type: 'computerUnavailable',
        color: 'black',
        reason: 'Engine crashed',
      });
    });

    it('fires callback with reason when no legal move found', () => {
      const cb = vi.fn();
      network.onComputerUnavailable(cb);

      sendMessage({
        type: 'computerUnavailable',
        color: 'black',
        reason: 'Engine could not find a legal move',
      });

      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb.mock.calls[0][0].reason).toContain('could not find');
    });
  });

  // -- sendActivateComputer -------------------------------

  describe('sendActivateComputer', () => {
    it('sends activateComputer message with color and skill', () => {
      // Open the connection so send works
      mockWsInstance.readyState = 1;
      network.sendActivateComputer('black', 'beginner');

      expect(mockWsInstance.sentData).toHaveLength(1);
      const msg = JSON.parse(mockWsInstance.sentData[0]);
      expect(msg.type).toBe('activateComputer');
      expect(msg.color).toBe('black');
      expect(msg.skill).toBe('beginner');
    });

    it('does not throw when connection is not open', () => {
      mockWsInstance.readyState = 0;
      expect(() => network.sendActivateComputer('black', 'master')).not.toThrow();
    });
  });

  // -- sendChangeSkill ------------------------------------

  describe('sendChangeSkill', () => {
    it('sends changeSkill message with skill', () => {
      mockWsInstance.readyState = 1;
      network.sendChangeSkill('grandmaster');

      expect(mockWsInstance.sentData).toHaveLength(1);
      const msg = JSON.parse(mockWsInstance.sentData[0]);
      expect(msg.type).toBe('changeSkill');
      expect(msg.skill).toBe('grandmaster');
    });

    it('does not throw when connection is not open', () => {
      mockWsInstance.readyState = 0;
      expect(() => network.sendChangeSkill('master')).not.toThrow();
    });
  });
});
