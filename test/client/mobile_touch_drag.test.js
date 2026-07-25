import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';

// ── Module mocks ──────────────────────────────────────────

vi.mock('../../client/network.js', () => ({
  myRole: null,
  serverBoard: null,
  serverTurn: 'white',
  serverPromotingPiece: null,
  serverGameOver: false,
  castlingRights: { wK: true, wQ: true, bK: true, bQ: true },
  enPassantTarget: null,
  sendMove: vi.fn(),
  onRestart: vi.fn(),
  onStateUpdate: vi.fn(),
  onMove: vi.fn(),
  onError: vi.fn(),
  onInfo: vi.fn(),
  onReconnecting: vi.fn(),
  onReconnected: vi.fn(),
  onPlayerDisconnected: vi.fn(),
  onPlayerDropped: vi.fn(),
  onGameAvailable: vi.fn(),
  onReconnectFailed: vi.fn(),
  onConnected: vi.fn(),
}));

vi.mock('../../client/ui.js', () => ({
  menuOpen: false,
  showMenu: vi.fn(),
  hideMenu: vi.fn(),
  updateMouseModeDisplay: vi.fn(),
  hidePromotionPicker: vi.fn(),
  hideConcedeConfirm: vi.fn(),
  mouseSensitivity: 0.002,
  showError: vi.fn(),
}));

vi.mock('../../client/board.js', () => ({
  squares: [],
  clearHighlights: vi.fn(),
  highlightSelected: vi.fn(),
  highlightValidMoves: vi.fn(),
  highlightCheck: vi.fn(),
}));

vi.mock('../../client/chess.mjs', () => ({
  pieceColor: vi.fn((piece) => (piece > 0 ? 'white' : 'black')),
  getValidMoves: vi.fn(() => []),
  findKing: vi.fn(() => null),
  isInCheck: vi.fn(() => false),
}));

const mockPieceMeshes = [];
vi.mock('../../client/pieces.js', () => ({
  pieceMeshes: mockPieceMeshes,
}));

function mockPieceMesh(file, rank) {
  return {
    file,
    rank,
    mesh: {
      position: new THREE.Vector3(file - 3.5, 0.01, 3.5 - rank),
    },
  };
}

// ── Tests ─────────────────────────────────────────────────

describe('mobile touch drag-to-move', () => {
  let controls, network, ui, board, chess;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockPieceMeshes.length = 0;

    document.body.innerHTML = '<div id="hud" class="hidden"></div>';

    network = await import('../../client/network.js');
    ui = await import('../../client/ui.js');
    board = await import('../../client/board.js');
    chess = await import('../../client/chess.mjs');
    controls = await import('../../client/controls.js');
  });

  afterEach(() => {
    delete globalThis.__mockRaycasterResult;
  });

  function setupBoard() {
    for (let r = 0; r < 8; r++) {
      board.squares[r] = [];
      for (let f = 0; f < 8; f++) {
        board.squares[r][f] = { rank: r, file: f };
      }
    }
  }

  function setupGame(pawnFile = 0, pawnRank = 1) {
    setupBoard();
    mockPieceMeshes.length = 0;
    mockPieceMeshes.push(mockPieceMesh(pawnFile, pawnRank));

    const camera = new THREE.PerspectiveCamera();
    const renderer = { domElement: document.createElement('canvas') };
    controls.setRenderer(renderer, camera);
    controls.setClickHandler(renderer);
    controls.setDragHandlers(renderer);

    network.myRole = 'white';
    network.serverTurn = 'white';
    network.serverBoard = Array(8)
      .fill(null)
      .map(() => Array(8).fill(0));
    network.serverBoard[pawnRank][pawnFile] = 1;
    network.serverGameOver = false;
    network.serverPromotingPiece = null;
    ui.menuOpen = false;

    chess.pieceColor.mockImplementation((p) => (p > 0 ? 'white' : 'black'));
    chess.getValidMoves.mockReturnValue([{ file: 0, rank: 3 }]);

    return renderer;
  }

  function createTouchStart(clientX, clientY) {
    const touch = { identifier: 1, clientX, clientY, pageX: clientX, pageY: clientY };
    const event = new Event('touchstart');
    event.touches = [touch];
    event.changedTouches = [touch];
    event.targetTouches = [touch];
    event.preventDefault = vi.fn();
    return event;
  }

  function createTouchMove(clientX, clientY) {
    const touch = { identifier: 1, clientX, clientY, pageX: clientX, pageY: clientY };
    const event = new Event('touchmove');
    event.touches = [touch];
    event.changedTouches = [touch];
    event.targetTouches = [touch];
    event.preventDefault = vi.fn();
    return event;
  }

  function createTouchEnd(clientX, clientY) {
    const touch = { identifier: 1, clientX, clientY, pageX: clientX, pageY: clientY };
    const event = new Event('touchend');
    event.touches = [];
    event.changedTouches = [touch];
    event.targetTouches = [];
    event.preventDefault = vi.fn();
    return event;
  }

  it('should register touch handlers on the canvas', async () => {
    const renderer = setupGame();
    const canvas = renderer.domElement;

    // Dispatch a touchstart — should not throw
    const ts = createTouchStart(100, 100);
    expect(() => canvas.dispatchEvent(ts)).not.toThrow();
  });

  it('should NOT prevent default on touchstart so compatibility click fires for taps', async () => {
    const renderer = setupGame();

    globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 2.5 } }];

    const ts = createTouchStart(100, 100);
    renderer.domElement.dispatchEvent(ts);

    // preventDefault must NOT be called on touchstart — otherwise the
    // compatibility click after a tap is suppressed and tap-to-select breaks.
    expect(ts.preventDefault).not.toHaveBeenCalled();
  });

  it('should prevent default on touchmove during drag', async () => {
    const renderer = setupGame();

    globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 2.5 } }];
    const ts = createTouchStart(100, 100);
    renderer.domElement.dispatchEvent(ts);

    const tm = createTouchMove(200, 200);
    document.dispatchEvent(tm);

    expect(tm.preventDefault).toHaveBeenCalled();
  });

  it('should skip touchstart when menu is open', async () => {
    const renderer = setupGame();
    ui.menuOpen = true;

    globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 2.5 } }];
    const ts = createTouchStart(100, 100);
    renderer.domElement.dispatchEvent(ts);

    // Should not have set up any drag state
    expect(controls.selectedSquare).toBeNull();
  });

  it('should skip touchstart when in camera mode', async () => {
    const renderer = setupGame();
    controls.toggleMouseMode(); // enables mouseLookOn

    globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 2.5 } }];
    const ts = createTouchStart(100, 100);
    renderer.domElement.dispatchEvent(ts);

    expect(controls.selectedSquare).toBeNull();
  });

  it('should skip touchstart when game is over', async () => {
    const renderer = setupGame();
    network.serverGameOver = true;

    globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 2.5 } }];
    const ts = createTouchStart(100, 100);
    renderer.domElement.dispatchEvent(ts);

    expect(controls.selectedSquare).toBeNull();
  });

  it('should skip touchstart on empty square', async () => {
    const renderer = setupGame();

    // Raycast hits empty square
    globalThis.__mockRaycasterResult = [{ point: { x: -2.5, y: 0.041, z: 2.5 } }];
    const ts = createTouchStart(100, 100);
    renderer.domElement.dispatchEvent(ts);

    expect(controls.selectedSquare).toBeNull();
  });

  it('should skip touchstart on opponent piece', async () => {
    const renderer = setupGame();

    // Set up a black piece at the raycast target
    network.serverBoard[1][1] = -1; // black piece at b2
    chess.pieceColor.mockImplementation((p) => (p > 0 ? 'white' : 'black'));

    globalThis.__mockRaycasterResult = [{ point: { x: -2.5, y: 0.041, z: 2.5 } }];
    const ts = createTouchStart(100, 100);
    renderer.domElement.dispatchEvent(ts);

    expect(controls.selectedSquare).toBeNull();
  });

  it('should create drag candidate on touchstart over own piece', async () => {
    const renderer = setupGame();

    globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 2.5 } }];
    const ts = createTouchStart(100, 100);
    renderer.domElement.dispatchEvent(ts);

    // selectedSquare should still be null (candidate only, not committed)
    expect(controls.selectedSquare).toBeNull();
  });

  it('should commit drag when touchmove exceeds threshold', async () => {
    const renderer = setupGame();

    // touchstart on pawn
    globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 2.5 } }];
    const ts = createTouchStart(100, 100);
    renderer.domElement.dispatchEvent(ts);

    // touchmove beyond threshold
    globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 2.5 } }];
    const tm = createTouchMove(200, 200);
    document.dispatchEvent(tm);

    // Drag should be committed — piece selected and lifted
    expect(controls.selectedSquare).not.toBeNull();
    expect(mockPieceMeshes[0].mesh.position.y).toBe(0.6);
  });

  it('should send move on valid touch drop', async () => {
    const renderer = setupGame();

    // touchstart on pawn at a2
    globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 2.5 } }];
    const ts = createTouchStart(100, 100);
    renderer.domElement.dispatchEvent(ts);

    // touchmove beyond threshold — commits drag
    const tm = createTouchMove(200, 200);
    document.dispatchEvent(tm);

    // touchend on valid destination a4
    globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 0.5 } }];
    const te = createTouchEnd(300, 300);
    document.dispatchEvent(te);

    expect(network.sendMove).toHaveBeenCalledWith(0, 1, 0, 3);
  });

  it('should return piece to original position on invalid touch drop', async () => {
    const renderer = setupGame();
    const pieceMesh = mockPieceMeshes[0];
    const origY = pieceMesh.mesh.position.y;

    // touchstart on pawn
    globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 2.5 } }];
    const ts = createTouchStart(100, 100);
    renderer.domElement.dispatchEvent(ts);

    // touchmove beyond threshold
    const tm = createTouchMove(200, 200);
    document.dispatchEvent(tm);

    // touchend on invalid square
    globalThis.__mockRaycasterResult = [{ point: { x: -1.5, y: 0.041, z: 0.5 } }];
    const te = createTouchEnd(300, 300);
    document.dispatchEvent(te);

    expect(network.sendMove).not.toHaveBeenCalled();
    expect(pieceMesh.mesh.position.y).toBe(origY);
    expect(controls.selectedSquare).toBeNull();
  });

  it('should clean up drag state on touchcancel', async () => {
    const renderer = setupGame();

    // touchstart on pawn
    globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 2.5 } }];
    const ts = createTouchStart(100, 100);
    renderer.domElement.dispatchEvent(ts);

    // touchmove beyond threshold
    const tm = createTouchMove(200, 200);
    document.dispatchEvent(tm);

    // touchcancel
    const tc = new Event('touchcancel');
    document.dispatchEvent(tc);

    // Drag state should be cleaned up
    expect(controls.selectedSquare).toBeNull();
    expect(mockPieceMeshes[0].mesh.position.y).toBe(0.01);
  });

  it('should extract coordinates from touches[0] for touchmove', async () => {
    const renderer = setupGame();

    // touchstart on pawn
    globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 2.5 } }];
    const ts = createTouchStart(100, 100);
    renderer.domElement.dispatchEvent(ts);

    // touchmove with specific coordinates
    globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 2.5 } }];
    const tm = createTouchMove(500, 600);
    document.dispatchEvent(tm);

    // Drag should be committed (distance from 100,100 to 500,600 is well beyond threshold)
    expect(controls.selectedSquare).not.toBeNull();
  });

  it('should extract coordinates from changedTouches[0] for touchend', async () => {
    const renderer = setupGame();

    // touchstart on pawn
    globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 2.5 } }];
    const ts = createTouchStart(100, 100);
    renderer.domElement.dispatchEvent(ts);

    // touchmove beyond threshold
    const tm = createTouchMove(200, 200);
    document.dispatchEvent(tm);

    // touchend with specific coordinates in changedTouches
    globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 0.5 } }];
    const te = createTouchEnd(400, 500);
    document.dispatchEvent(te);

    expect(network.sendMove).toHaveBeenCalledWith(0, 1, 0, 3);
  });

  it('should allow tap-to-select via compatibility click (touchstart → touchend, no drag)', async () => {
    const renderer = setupGame();

    // Simulate a tap: touchstart → touchend with no movement
    globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 2.5 } }];
    const ts = createTouchStart(100, 100);
    renderer.domElement.dispatchEvent(ts);

    // touchend at same position — candidate released, no drag committed
    const te = createTouchEnd(100, 100);
    document.dispatchEvent(te);

    // The compatibility click fires after touchend — simulate it
    const click = new MouseEvent('click', { bubbles: true });
    renderer.domElement.dispatchEvent(click);

    // Piece should be selected
    expect(controls.selectedSquare).not.toBeNull();
    expect(controls.selectedSquare.file).toBe(0);
    expect(controls.selectedSquare.rank).toBe(1);
  });

  it('should allow tap-to-move via compatibility click (select then tap destination)', async () => {
    const renderer = setupGame();

    // Step 1: Tap on pawn at a2 to select it
    globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 2.5 } }];
    const ts1 = createTouchStart(100, 100);
    renderer.domElement.dispatchEvent(ts1);
    const te1 = createTouchEnd(100, 100);
    document.dispatchEvent(te1);
    const click1 = new MouseEvent('click', { bubbles: true });
    renderer.domElement.dispatchEvent(click1);

    expect(controls.selectedSquare).not.toBeNull();

    // Step 2: Tap on a4 (valid move) to move
    globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 0.5 } }];
    const ts2 = createTouchStart(200, 200);
    renderer.domElement.dispatchEvent(ts2);
    const te2 = createTouchEnd(200, 200);
    document.dispatchEvent(te2);
    const click2 = new MouseEvent('click', { bubbles: true });
    renderer.domElement.dispatchEvent(click2);

    expect(network.sendMove).toHaveBeenCalledWith(0, 1, 0, 3);
  });

  it('should allow tap immediately after a completed drag (dragCompleted cleared)', async () => {
    // Regression: after a committed touch drag, preventDefault() was called
    // during touchmove, suppressing the compatibility click that would reset
    // dragCompleted. Without the fix, the next tap's click is discarded.
    const renderer = setupGame();

    // Step 1: Complete a drag (touchstart → touchmove beyond threshold → touchend)
    globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 2.5 } }];
    const ts1 = createTouchStart(100, 100);
    renderer.domElement.dispatchEvent(ts1);

    const tm1 = createTouchMove(200, 200);
    document.dispatchEvent(tm1);

    // Drop on invalid square — no move sent, but drag is committed
    globalThis.__mockRaycasterResult = [{ point: { x: -1.5, y: 0.041, z: 0.5 } }];
    const te1 = createTouchEnd(300, 300);
    document.dispatchEvent(te1);

    // Committed touchend should have preventDefault called to suppress
    // the compatibility click (which would wrongly consume dragCompleted)
    expect(te1.preventDefault).toHaveBeenCalled();

    // Step 2: Tap on the pawn to select it — must work on first attempt
    globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 2.5 } }];
    const ts2 = createTouchStart(100, 100);
    renderer.domElement.dispatchEvent(ts2);
    const te2 = createTouchEnd(100, 100);
    document.dispatchEvent(te2);

    // Below-threshold touchend should NOT call preventDefault
    expect(te2.preventDefault).not.toHaveBeenCalled();

    // Compatibility click fires — should select the piece
    const click = new MouseEvent('click', { bubbles: true });
    renderer.domElement.dispatchEvent(click);

    expect(controls.selectedSquare).not.toBeNull();
    expect(controls.selectedSquare.file).toBe(0);
    expect(controls.selectedSquare.rank).toBe(1);
  });
});
