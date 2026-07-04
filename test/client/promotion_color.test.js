import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Regression test for: computer promotion rendered wrong color because
// the client inferred color from a stale serverBoard square.
// The fix adds an explicit `color` field to the server's promotion broadcast,
// and the client uses it when present.
//
// These tests drive the real client/network.js WebSocket handler to verify
// the production code path uses msg.color correctly.

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

describe('promotion color — regression via real network handler', () => {
  let mockWsInstance;
  let network;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // TrackableWebSocket captures the instance so tests can trigger messages
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

      send() {}
      close() {}
    }

    globalThis.WebSocket = TrackableWebSocket;

    const store = {};
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
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

  function sendState(board) {
    mockWsInstance._onmessage?.({
      data: JSON.stringify({
        type: 'state',
        role: 'white',
        board,
        turn: 'white',
        promotingPiece: null,
        gameOver: false,
        gameResult: null,
        moveHistory: [],
        castlingRights: { wK: true, wQ: true, bK: true, bQ: true },
        enPassantTarget: null,
        disconnectedPlayers: [],
        seats: { white: { status: 'connected' }, black: { status: 'connected' } },
        fen: '',
        halfmoveClock: 0,
        threefoldCount: 0,
      }),
    });
  }

  function sendPromotion(msg) {
    mockWsInstance._onmessage?.({ data: JSON.stringify({ type: 'promotion', ...msg }) });
  }

  it('uses explicit color for black computer promotion when board square is empty', () => {
    // Establish a stale board where the promotion square is empty (0).
    // Without the color field, the handler would infer white from 0 < 7.
    const board = Array.from({ length: 8 }, () => Array(8).fill(0));
    board[0][4] = 0; // e1 is empty
    sendState(board);

    // Send a black computer promotion message with explicit color
    sendPromotion({ pieceType: 'queen', color: 'black', file: 4, rank: 0 });

    // B_QUEEN = 11 (base 5 + 6 for black)
    expect(network.serverBoard[0][4]).toBe(11);
  });

  it('uses explicit color for white promotion when board square has black piece', () => {
    // Establish a board where the promotion square has a black pawn (7).
    // Without the color field, the handler would infer black and render wrong.
    const board = Array.from({ length: 8 }, () => Array(8).fill(0));
    board[7][0] = 7; // a8 has black pawn
    sendState(board);

    // Send a white human promotion message with explicit color
    sendPromotion({ pieceType: 'knight', color: 'white', file: 0, rank: 7 });

    // W_KNIGHT = 2 (base 2 for white)
    expect(network.serverBoard[7][0]).toBe(2);
  });

  it('falls back to board inference when color is not provided', () => {
    // Legacy behavior: no color field, infer from board
    const board = Array.from({ length: 8 }, () => Array(8).fill(0));
    board[0][4] = 1; // white pawn at e1
    sendState(board);

    sendPromotion({ pieceType: 'queen', file: 4, rank: 0 });

    // W_QUEEN = 5 (inferred white from pawn value 1 < 7)
    expect(network.serverBoard[0][4]).toBe(5);
  });

  it('falls back to board inference for black pawn when color is not provided', () => {
    const board = Array.from({ length: 8 }, () => Array(8).fill(0));
    board[7][4] = 7; // black pawn at e8
    sendState(board);

    sendPromotion({ pieceType: 'rook', file: 4, rank: 7 });

    // B_ROOK = 10 (inferred black from pawn value 7 >= 7)
    expect(network.serverBoard[7][4]).toBe(10);
  });
});
