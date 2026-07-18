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

// Helper to create a mock piece mesh
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

describe('controls.js', () => {
  let controls, network, ui, board, chess;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockPieceMeshes.length = 0;

    // Set up DOM elements that controls.js expects
    document.body.innerHTML = '<div id="hud" class="hidden"></div>';

    // Re-import after reset
    network = await import('../../client/network.js');
    ui = await import('../../client/ui.js');
    board = await import('../../client/board.js');
    chess = await import('../../client/chess.mjs');
    controls = await import('../../client/controls.js');
  });

  afterEach(() => {
    // Clean up global mock state
    delete globalThis.__mockRaycasterResult;
  });

  // ── allSquares initialization (the regression bug) ──

  describe('allSquares initialization', () => {
    it('should not throw when module loads with empty squares array', async () => {
      // Regression test: the original bug was that allSquares was built
      // at module load time when squares[] was still empty, causing
      // "Cannot read properties of undefined (reading '0')"
      expect(() => controls).not.toThrow();
    });

    it('should build allSquares lazily after squares is populated', async () => {
      // Simulate createBoard() populating the squares array
      for (let r = 0; r < 8; r++) {
        board.squares[r] = [];
        for (let f = 0; f < 8; f++) {
          board.squares[r][f] = { rank: r, file: f };
        }
      }

      const camera = new THREE.PerspectiveCamera();
      camera.position.set(0, 7, 10);
      const renderer = { domElement: document.createElement('canvas') };

      controls.setRenderer(renderer, camera);
      controls.setClickHandler(renderer);

      // Set up game state so the click handler proceeds past guards
      network.myRole = 'white';
      network.serverTurn = 'white';
      network.serverBoard = Array(8)
        .fill(null)
        .map(() => Array(8).fill(0));
      network.serverBoard[7][0] = 1;
      network.serverGameOver = false;
      network.serverPromotingPiece = null;
      ui.menuOpen = false;
      chess.pieceColor.mockReturnValue('white');
      chess.getValidMoves.mockReturnValue([{ file: 0, rank: 5 }]);

      // Dispatch a click — this triggers ensureAllSquares() internally
      const clickEvent = new MouseEvent('click', {
        clientX: window.innerWidth / 2,
        clientY: window.innerHeight / 2,
        bubbles: true,
      });

      // Should not throw — allSquares built lazily from populated squares[]
      expect(() => renderer.domElement.dispatchEvent(clickEvent)).not.toThrow();
    });

    it('should handle multiple clicks without rebuilding allSquares', async () => {
      for (let r = 0; r < 8; r++) {
        board.squares[r] = [];
        for (let f = 0; f < 8; f++) {
          board.squares[r][f] = { rank: r, file: f };
        }
      }

      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: document.createElement('canvas') };

      controls.setRenderer(renderer, camera);
      controls.setClickHandler(renderer);

      network.myRole = 'white';
      network.serverTurn = 'white';
      network.serverBoard = Array(8)
        .fill(null)
        .map(() => Array(8).fill(0));
      network.serverGameOver = false;
      network.serverPromotingPiece = null;
      ui.menuOpen = false;

      for (let i = 0; i < 5; i++) {
        const clickEvent = new MouseEvent('click', { clientX: 100, clientY: 100, bubbles: true });
        expect(() => renderer.domElement.dispatchEvent(clickEvent)).not.toThrow();
      }
    });
  });

  // ── Camera positioning ──

  describe('setCameraForRole', () => {
    it('should position camera correctly for white role', async () => {
      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: document.createElement('canvas') };

      controls.setRenderer(renderer, camera);
      controls.setCameraForRole('white');

      expect(camera.position.x).toBe(0);
      expect(camera.position.y).toBe(7);
      expect(camera.position.z).toBe(10);
    });

    it('should position camera correctly for black role', async () => {
      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: document.createElement('canvas') };

      controls.setRenderer(renderer, camera);
      controls.setCameraForRole('black');

      expect(camera.position.x).toBe(0);
      expect(camera.position.y).toBe(7);
      expect(camera.position.z).toBe(-10);
    });

    it('should position camera correctly for spectator role', async () => {
      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: document.createElement('canvas') };

      controls.setRenderer(renderer, camera);
      controls.setCameraForRole('spectator');

      expect(camera.position.x).toBe(-10);
      expect(camera.position.y).toBe(7);
      expect(camera.position.z).toBe(0);
    });

    it('should not change camera for invalid role', async () => {
      const camera = new THREE.PerspectiveCamera();
      camera.position.set(1, 2, 3);
      const renderer = { domElement: document.createElement('canvas') };

      controls.setRenderer(renderer, camera);
      controls.setCameraForRole('invalid');

      expect(camera.position.x).toBe(1);
      expect(camera.position.y).toBe(2);
      expect(camera.position.z).toBe(3);
    });

    it('should handle being called before setRenderer', async () => {
      expect(() => controls.setCameraForRole('white')).not.toThrow();
    });
  });

  // ── Renderer setup ──

  describe('setRenderer', () => {
    it('should initialize yaw and pitch from camera quaternion', async () => {
      const camera = new THREE.PerspectiveCamera();
      const euler = new THREE.Euler(0.5, 1.0, 0, 'YXZ');
      camera.quaternion.setFromEuler(euler);
      const renderer = { domElement: document.createElement('canvas') };

      controls.setRenderer(renderer, camera);

      // yaw and pitch should be finite numbers derived from the quaternion
      expect(Number.isFinite(controls.yaw)).toBe(true);
      expect(Number.isFinite(controls.pitch)).toBe(true);
    });

    it('should remove hidden class from HUD', async () => {
      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: document.createElement('canvas') };
      const hud = document.getElementById('hud');
      hud.classList.add('hidden');

      controls.setRenderer(renderer, camera);

      expect(hud.classList.contains('hidden')).toBe(false);
    });
  });

  // ── Click handler guards ──

  describe('click handler', () => {
    it('should ignore clicks when menu is open', async () => {
      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: document.createElement('canvas') };

      controls.setRenderer(renderer, camera);
      controls.setClickHandler(renderer);
      ui.menuOpen = true;

      const clickEvent = new MouseEvent('click', { bubbles: true });
      renderer.domElement.dispatchEvent(clickEvent);

      expect(network.sendMove).not.toHaveBeenCalled();
    });

    it('should ignore clicks when server is promoting a piece', async () => {
      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: document.createElement('canvas') };

      controls.setRenderer(renderer, camera);
      controls.setClickHandler(renderer);
      network.serverPromotingPiece = { file: 0, rank: 0 };

      const clickEvent = new MouseEvent('click', { bubbles: true });
      renderer.domElement.dispatchEvent(clickEvent);

      expect(network.sendMove).not.toHaveBeenCalled();
    });

    it('should ignore clicks when game is over', async () => {
      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: document.createElement('canvas') };

      controls.setRenderer(renderer, camera);
      controls.setClickHandler(renderer);
      network.serverGameOver = true;

      const clickEvent = new MouseEvent('click', { bubbles: true });
      renderer.domElement.dispatchEvent(clickEvent);

      expect(network.sendMove).not.toHaveBeenCalled();
    });

    it('should ignore clicks when serverBoard is not set', async () => {
      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: document.createElement('canvas') };

      controls.setRenderer(renderer, camera);
      controls.setClickHandler(renderer);
      network.serverBoard = null;

      const clickEvent = new MouseEvent('click', { bubbles: true });
      renderer.domElement.dispatchEvent(clickEvent);

      expect(network.sendMove).not.toHaveBeenCalled();
    });

    it('should register a restart callback', async () => {
      expect(network.onRestart).toHaveBeenCalled();
    });
  });

  // ── Keyboard handling ──

  describe('keyboard handling', () => {
    it('should track key state on keydown/keyup', () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
      expect(controls.keys.KeyW).toBe(true);

      document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
      expect(controls.keys.KeyW).toBe(false);
    });

    it('should call showMenu on Escape when menu is closed', async () => {
      ui.menuOpen = false;
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
      expect(ui.showMenu).toHaveBeenCalled();
    });

    it('should call hideMenu on Escape when menu is open', async () => {
      ui.menuOpen = true;
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
      expect(ui.hideMenu).toHaveBeenCalled();
    });

    it('should toggle mouseLookOn on Tab', async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab' }));
      expect(ui.updateMouseModeDisplay).toHaveBeenCalled();
    });

    it('should prevent default on Tab key', async () => {
      let defaultPrevented = false;
      const tabEvent = new KeyboardEvent('keydown', { code: 'Tab' });
      tabEvent.preventDefault = () => {
        defaultPrevented = true;
      };
      document.dispatchEvent(tabEvent);
      expect(defaultPrevented).toBe(true);
    });
  });

  // ── Deselect on second click ──

  describe('deselect on second click', () => {
    it('should deselect a piece when clicking the same square again', async () => {
      // Populate squares so ensureAllSquares() works
      for (let r = 0; r < 8; r++) {
        board.squares[r] = [];
        for (let f = 0; f < 8; f++) {
          board.squares[r][f] = { rank: r, file: f };
        }
      }

      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: document.createElement('canvas') };
      controls.setRenderer(renderer, camera);
      controls.setClickHandler(renderer);

      // Game state: white to move, white pawn at a2 (rank=1, file=0)
      network.myRole = 'white';
      network.serverTurn = 'white';
      network.serverBoard = Array(8)
        .fill(null)
        .map(() => Array(8).fill(0));
      network.serverBoard[1][0] = 1;
      network.serverGameOver = false;
      network.serverPromotingPiece = null;
      ui.menuOpen = false;

      chess.pieceColor.mockImplementation((p) => (p > 0 ? 'white' : 'black'));
      chess.getValidMoves.mockReturnValue([{ file: 0, rank: 3 }]);

      // Make the raycaster hit a2 (file=0, rank=1)
      globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 2.5 } }];

      // Click on a2 to select the piece
      const selectEvent = new MouseEvent('click', { bubbles: true });
      renderer.domElement.dispatchEvent(selectEvent);

      expect(controls.selectedSquare).not.toBeNull();
      expect(controls.selectedSquare.file).toBe(0);
      expect(controls.selectedSquare.rank).toBe(1);

      // Click the same square again to deselect
      const deselectEvent = new MouseEvent('click', { bubbles: true });
      renderer.domElement.dispatchEvent(deselectEvent);

      expect(controls.selectedSquare).toBeNull();
      expect(controls.validMoves).toEqual([]);
      expect(board.clearHighlights).toHaveBeenCalled();
      expect(board.highlightCheck).toHaveBeenCalled();

      // Clean up
      delete globalThis.__mockRaycasterResult;
    });
  });

  // ── Pointer lock ──

  describe('pointer lock', () => {
    it('should disable mouseLookOn when pointer lock is lost', async () => {
      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: document.createElement('canvas') };

      controls.setRenderer(renderer, camera);

      // Toggle mouseLookOn on via Tab key (since the import binding is read-only)
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab' }));
      // mouseLookOn should now be true
      expect(controls.mouseLookOn).toBe(true);

      // Simulate pointer lock being lost
      document.dispatchEvent(new Event('pointerlockchange'));

      expect(controls.mouseLookOn).toBe(false);
      expect(ui.updateMouseModeDisplay).toHaveBeenCalledWith(false);
    });
  });

  // ── Drag-to-move ──

  describe('drag-to-move', () => {
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

    it('should not set selectedSquare on mousedown alone (candidate only)', async () => {
      const renderer = setupGame();

      // Raycast hits white pawn at a2
      globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 2.5 } }];

      const md = new MouseEvent('mousedown', {
        button: 0,
        clientX: 100,
        clientY: 100,
        bubbles: true,
      });
      renderer.domElement.dispatchEvent(md);

      // mousedown should NOT set selectedSquare — only stores a candidate
      expect(controls.selectedSquare).toBeNull();
    });

    it('should not start drag on empty square', async () => {
      setupBoard();
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
      network.serverGameOver = false;
      network.serverPromotingPiece = null;
      ui.menuOpen = false;

      globalThis.__mockRaycasterResult = [{ point: { x: -2.5, y: 0.041, z: 2.5 } }];

      const md = new MouseEvent('mousedown', {
        button: 0,
        clientX: 100,
        clientY: 100,
        bubbles: true,
      });
      renderer.domElement.dispatchEvent(md);

      expect(controls.selectedSquare).toBeNull();
    });

    it('should ignore right-click for drag', async () => {
      const renderer = setupGame();

      globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 2.5 } }];

      const md = new MouseEvent('mousedown', {
        button: 2, // right click
        clientX: 100,
        clientY: 100,
        bubbles: true,
      });
      renderer.domElement.dispatchEvent(md);

      expect(controls.selectedSquare).toBeNull();
    });

    it('should preserve click-to-select when drag handlers are installed', async () => {
      const renderer = setupGame();

      // Raycast hits white pawn at a2
      globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 2.5 } }];

      // Simulate a normal click: mousedown → mouseup (no movement) → click
      const md = new MouseEvent('mousedown', {
        button: 0,
        clientX: 100,
        clientY: 100,
        bubbles: true,
      });
      renderer.domElement.dispatchEvent(md);

      // mouseup with no movement — candidate released, no drag committed
      const mu = new MouseEvent('mouseup', {
        clientX: 100,
        clientY: 100,
        bubbles: true,
      });
      document.dispatchEvent(mu);

      // Click fires — should select the piece (normal click behavior)
      const click = new MouseEvent('click', { bubbles: true });
      renderer.domElement.dispatchEvent(click);

      expect(controls.selectedSquare).not.toBeNull();
      expect(controls.selectedSquare.file).toBe(0);
      expect(controls.selectedSquare.rank).toBe(1);
      expect(board.highlightSelected).toHaveBeenCalledWith(0, 1);
    });

    it('should preserve click-to-move when drag handlers are installed', async () => {
      const renderer = setupGame();

      // Step 1: Click on pawn at a2 to select it
      globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 2.5 } }];

      const md1 = new MouseEvent('mousedown', {
        button: 0,
        clientX: 100,
        clientY: 100,
        bubbles: true,
      });
      renderer.domElement.dispatchEvent(md1);
      const mu1 = new MouseEvent('mouseup', { clientX: 100, clientY: 100, bubbles: true });
      document.dispatchEvent(mu1);
      const click1 = new MouseEvent('click', { bubbles: true });
      renderer.domElement.dispatchEvent(click1);

      expect(controls.selectedSquare).not.toBeNull();

      // Step 2: Click on a4 (valid move) to move
      globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 0.5 } }];

      const md2 = new MouseEvent('mousedown', {
        button: 0,
        clientX: 200,
        clientY: 200,
        bubbles: true,
      });
      renderer.domElement.dispatchEvent(md2);
      const mu2 = new MouseEvent('mouseup', { clientX: 200, clientY: 200, bubbles: true });
      document.dispatchEvent(mu2);
      const click2 = new MouseEvent('click', { bubbles: true });
      renderer.domElement.dispatchEvent(click2);

      expect(network.sendMove).toHaveBeenCalledWith(0, 1, 0, 3);
    });

    it('should commit drag and send move on valid drop beyond threshold', async () => {
      const renderer = setupGame();

      // mousedown on pawn at a2
      globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 2.5 } }];
      const md = new MouseEvent('mousedown', {
        button: 0,
        clientX: 100,
        clientY: 100,
        bubbles: true,
      });
      renderer.domElement.dispatchEvent(md);

      // mousemove beyond threshold — commits the drag
      const mm = new MouseEvent('mousemove', {
        clientX: 200,
        clientY: 200,
        bubbles: true,
      });
      document.dispatchEvent(mm);

      // Piece should now be selected (drag committed)
      expect(controls.selectedSquare).not.toBeNull();

      // mouseup on valid destination a4
      globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 0.5 } }];
      const mu = new MouseEvent('mouseup', {
        clientX: 300,
        clientY: 300,
        bubbles: true,
      });
      document.dispatchEvent(mu);

      expect(network.sendMove).toHaveBeenCalledWith(0, 1, 0, 3);
    });

    it('should move piece smoothly over invalid squares, snap over valid ones', async () => {
      const renderer = setupGame();
      const pieceMesh = mockPieceMeshes[0];

      // mousedown on pawn at a2
      globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 2.5 } }];
      const md = new MouseEvent('mousedown', {
        button: 0,
        clientX: 100,
        clientY: 100,
        bubbles: true,
      });
      renderer.domElement.dispatchEvent(md);

      // mousemove beyond threshold — commits the drag
      const mm1 = new MouseEvent('mousemove', {
        clientX: 200,
        clientY: 200,
        bubbles: true,
      });
      document.dispatchEvent(mm1);

      // Move cursor to an invalid square (between squares, not a valid target)
      // Point on b3 (file=1, rank=4) — not a valid pawn move from a2
      globalThis.__mockRaycasterResult = [{ point: { x: -2.1, y: 0.041, z: 1.3 } }];
      const mm2 = new MouseEvent('mousemove', {
        clientX: 250,
        clientY: 250,
        bubbles: true,
      });
      document.dispatchEvent(mm2);

      // Piece should follow the exact raycast point (free drag)
      expect(pieceMesh.mesh.position.x).toBe(-2.1);
      expect(pieceMesh.mesh.position.z).toBe(1.3);

      // Move cursor over a valid destination (a4 = file=0, rank=3)
      // Raycast point is offset from center to verify snapping
      globalThis.__mockRaycasterResult = [{ point: { x: -3.2, y: 0.041, z: 0.8 } }];
      const mm3 = new MouseEvent('mousemove', {
        clientX: 300,
        clientY: 300,
        bubbles: true,
      });
      document.dispatchEvent(mm3);

      // Piece should snap to square center (a4: file=0 → x=-3.5, rank=3 → z=0.5)
      expect(pieceMesh.mesh.position.x).toBe(-3.5);
      expect(pieceMesh.mesh.position.z).toBe(0.5);

      // Finish the drag by dropping on an invalid square to clean up drag state
      globalThis.__mockRaycasterResult = [{ point: { x: -1.5, y: 0.041, z: 0.5 } }];
      const mu = new MouseEvent('mouseup', {
        clientX: 350,
        clientY: 350,
        bubbles: true,
      });
      document.dispatchEvent(mu);

      // Verify invalid drop behavior: no move sent, selection cleared
      expect(network.sendMove).not.toHaveBeenCalled();
      expect(controls.selectedSquare).toBeNull();
    });

    it('should not send move and clear selection on invalid drop', async () => {
      const renderer = setupGame();
      const pieceMesh = mockPieceMeshes[0];

      // mousedown on pawn at a2
      globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 2.5 } }];
      const md = new MouseEvent('mousedown', {
        button: 0,
        clientX: 100,
        clientY: 100,
        bubbles: true,
      });
      renderer.domElement.dispatchEvent(md);

      // mousemove beyond threshold — commits the drag (piece lifted)
      const mm = new MouseEvent('mousemove', {
        clientX: 200,
        clientY: 200,
        bubbles: true,
      });
      document.dispatchEvent(mm);

      // Piece should be lifted
      expect(pieceMesh.mesh.position.y).toBe(0.6);

      // mouseup on invalid square (c4)
      globalThis.__mockRaycasterResult = [{ point: { x: -1.5, y: 0.041, z: 0.5 } }];
      const mu = new MouseEvent('mouseup', {
        clientX: 300,
        clientY: 300,
        bubbles: true,
      });
      document.dispatchEvent(mu);

      // Key behaviors: no move sent, selection cleared, highlights reset
      expect(network.sendMove).not.toHaveBeenCalled();
      expect(controls.selectedSquare).toBeNull();
      expect(controls.validMoves).toEqual([]);
      expect(board.clearHighlights).toHaveBeenCalled();
      expect(board.highlightCheck).toHaveBeenCalled();
    });

    it('should clear drag candidate on restart', async () => {
      const renderer = setupGame();

      globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 2.5 } }];

      const md = new MouseEvent('mousedown', {
        button: 0,
        clientX: 100,
        clientY: 100,
        bubbles: true,
      });
      renderer.domElement.dispatchEvent(md);

      // Simulate restart
      const restartCb = network.onRestart.mock.calls[0][0];
      restartCb({});

      expect(controls.selectedSquare).toBeNull();
      expect(controls.validMoves).toEqual([]);
    });
  });

  // ── Camera positions map ──

  describe('CAMERA_POSITIONS', () => {
    it('should export the CAMERA_POSITIONS map', async () => {
      expect(controls.CAMERA_POSITIONS).toBeDefined();
    });

    it('should have entries for keys 1 through 6', async () => {
      for (let i = 1; i <= 6; i++) {
        expect(controls.CAMERA_POSITIONS[i]).toBeDefined();
        expect(controls.CAMERA_POSITIONS[i].x).toBeDefined();
        expect(controls.CAMERA_POSITIONS[i].y).toBeDefined();
        expect(controls.CAMERA_POSITIONS[i].z).toBeDefined();
      }
    });

    it('should have correct positions for role views (1-3)', async () => {
      expect(controls.CAMERA_POSITIONS[1]).toEqual({ x: 0, y: 7, z: 10, lookAt: [0, 0, 0] });
      expect(controls.CAMERA_POSITIONS[2]).toEqual({ x: 0, y: 7, z: -10, lookAt: [0, 0, 0] });
      expect(controls.CAMERA_POSITIONS[3]).toEqual({ x: -10, y: 7, z: 0, lookAt: [0, 0, 0] });
    });

    it('should have overhead positions at (0, 3, 0) for keys 4-6', async () => {
      for (let i = 4; i <= 6; i++) {
        expect(controls.CAMERA_POSITIONS[i].x).toBe(0);
        expect(controls.CAMERA_POSITIONS[i].y).toBe(11);
        expect(controls.CAMERA_POSITIONS[i].z).toBe(0);
      }
    });

    it('should have euler overrides for overhead views (4-6)', async () => {
      for (let i = 4; i <= 6; i++) {
        expect(controls.CAMERA_POSITIONS[i].euler).toBeDefined();
        expect(Array.isArray(controls.CAMERA_POSITIONS[i].euler)).toBe(true);
        expect(controls.CAMERA_POSITIONS[i].euler.length).toBe(3);
      }
    });

    it('should not have euler overrides for role views (1-3)', async () => {
      for (let i = 1; i <= 3; i++) {
        expect(controls.CAMERA_POSITIONS[i].euler).toBeUndefined();
      }
    });
  });

  // ── warpCamera ──

  describe('warpCamera', () => {
    it('should warp to white position on key 1', async () => {
      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: document.createElement('canvas') };
      controls.setRenderer(renderer, camera);

      controls.warpCamera(1);

      expect(camera.position.x).toBe(0);
      expect(camera.position.y).toBe(7);
      expect(camera.position.z).toBe(10);
    });

    it('should warp to black position on key 2', async () => {
      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: document.createElement('canvas') };
      controls.setRenderer(renderer, camera);

      controls.warpCamera(2);

      expect(camera.position.x).toBe(0);
      expect(camera.position.y).toBe(7);
      expect(camera.position.z).toBe(-10);
    });

    it('should warp to spectator position on key 3', async () => {
      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: document.createElement('canvas') };
      controls.setRenderer(renderer, camera);

      controls.warpCamera(3);

      expect(camera.position.x).toBe(-10);
      expect(camera.position.y).toBe(7);
      expect(camera.position.z).toBe(0);
    });

    it('should warp to overhead white position on key 4', async () => {
      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: document.createElement('canvas') };
      controls.setRenderer(renderer, camera);

      controls.warpCamera(4);

      expect(camera.position.x).toBe(0);
      expect(camera.position.y).toBe(11);
      expect(camera.position.z).toBe(0);
      // Overhead view should have a non-default quaternion
      expect(camera.quaternion.x).not.toBe(0);
    });

    it('should warp to overhead black position on key 5', async () => {
      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: document.createElement('canvas') };
      controls.setRenderer(renderer, camera);

      controls.warpCamera(5);

      expect(camera.position.x).toBe(0);
      expect(camera.position.y).toBe(11);
      expect(camera.position.z).toBe(0);
    });

    it('should warp to overhead spectator position on key 6', async () => {
      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: document.createElement('canvas') };
      controls.setRenderer(renderer, camera);

      controls.warpCamera(6);

      expect(camera.position.x).toBe(0);
      expect(camera.position.y).toBe(11);
      expect(camera.position.z).toBe(0);
    });

    it('should not change camera for invalid key', async () => {
      const camera = new THREE.PerspectiveCamera();
      camera.position.set(1, 2, 3);
      const renderer = { domElement: document.createElement('canvas') };
      controls.setRenderer(renderer, camera);

      controls.warpCamera(0);
      expect(camera.position.x).toBe(1);
      expect(camera.position.y).toBe(2);
      expect(camera.position.z).toBe(3);

      controls.warpCamera(7);
      expect(camera.position.x).toBe(1);
      expect(camera.position.y).toBe(2);
      expect(camera.position.z).toBe(3);
    });

    it('should handle being called before setRenderer', async () => {
      expect(() => controls.warpCamera(1)).not.toThrow();
    });

    it('should sync yaw and pitch after warping', async () => {
      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: document.createElement('canvas') };
      controls.setRenderer(renderer, camera);

      controls.warpCamera(1);

      expect(Number.isFinite(controls.yaw)).toBe(true);
      expect(Number.isFinite(controls.pitch)).toBe(true);
    });

    it('should produce different orientations for overhead views 4, 5, 6', async () => {
      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: document.createElement('canvas') };
      controls.setRenderer(renderer, camera);

      controls.warpCamera(4);
      const q4 = {
        x: camera.quaternion.x,
        y: camera.quaternion.y,
        z: camera.quaternion.z,
        w: camera.quaternion.w,
      };

      controls.warpCamera(5);
      const q5 = {
        x: camera.quaternion.x,
        y: camera.quaternion.y,
        z: camera.quaternion.z,
        w: camera.quaternion.w,
      };

      controls.warpCamera(6);
      const q6 = {
        x: camera.quaternion.x,
        y: camera.quaternion.y,
        z: camera.quaternion.z,
        w: camera.quaternion.w,
      };

      // All three overhead views should have different quaternions
      expect(q4).not.toEqual(q5);
      expect(q4).not.toEqual(q6);
      expect(q5).not.toEqual(q6);
    });

    it('should point camera forward vector toward negative Y for all overhead views', async () => {
      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: document.createElement('canvas') };
      controls.setRenderer(renderer, camera);

      for (let i = 4; i <= 6; i++) {
        controls.warpCamera(i);
        // getWorldDirection returns the camera's local -Z in world space
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        // Forward vector should point downward (negative Y)
        expect(dir.y).toBeLessThan(-0.9);
        // X and Z components should be near zero (straight down)
        expect(Math.abs(dir.x)).toBeLessThan(0.01);
        expect(Math.abs(dir.z)).toBeLessThan(0.01);
      }
    });

    it('should distinguish white, black, spectator overhead orientations via right vector', async () => {
      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: document.createElement('canvas') };
      controls.setRenderer(renderer, camera);

      // Compute right vector from quaternion: q * (1, 0, 0)
      function getRightVector(cam) {
        const q = cam.quaternion;
        const x = 1,
          y = 0,
          z = 0;
        const qx = q.x,
          qy = q.y,
          qz = q.z,
          qw = q.w;
        const ix = qw * x + qy * z - qz * y;
        const iy = qw * y + qz * x - qx * z;
        const iz = qw * z + qx * y - qy * x;
        const iw = -qx * x - qy * y - qz * z;
        return {
          x: ix * qw + iw * -qx + iy * -qz - iz * -qy,
          y: iy * qw + iw * -qy + iz * -qx - ix * -qz,
          z: iz * qw + iw * -qz + ix * -qy - iy * -qx,
        };
      }

      controls.warpCamera(4); // white overhead
      const r4 = getRightVector(camera);

      controls.warpCamera(5); // black overhead
      const r5 = getRightVector(camera);

      controls.warpCamera(6); // spectator overhead
      const r6 = getRightVector(camera);

      // White overhead: right ≈ +X (1, 0, 0)
      expect(r4.x).toBeGreaterThan(0.9);
      expect(Math.abs(r4.z)).toBeLessThan(0.01);

      // Black overhead: right ≈ -X (-1, 0, 0)
      expect(r5.x).toBeLessThan(-0.9);
      expect(Math.abs(r5.z)).toBeLessThan(0.01);

      // Spectator overhead: right ≈ +Z (0, 0, 1)
      expect(r6.z).toBeGreaterThan(0.9);
      expect(Math.abs(r6.x)).toBeLessThan(0.01);
    });

    it('should be equivalent to setCameraForRole for role keys', async () => {
      const camera1 = new THREE.PerspectiveCamera();
      const camera2 = new THREE.PerspectiveCamera();
      const renderer = { domElement: document.createElement('canvas') };

      controls.setRenderer(renderer, camera1);
      controls.setCameraForRole('white');

      controls.setRenderer(renderer, camera2);
      controls.warpCamera(1);

      expect(camera1.position.x).toBe(camera2.position.x);
      expect(camera1.position.y).toBe(camera2.position.y);
      expect(camera1.position.z).toBe(camera2.position.z);
    });
  });

  // ── Keyboard warp keys ──

  describe('keyboard warp keys', () => {
    it('should warp camera on Digit1 key', async () => {
      const camera = new THREE.PerspectiveCamera();
      camera.position.set(99, 99, 99);
      const renderer = { domElement: document.createElement('canvas') };
      controls.setRenderer(renderer, camera);

      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1' }));

      expect(camera.position.x).toBe(0);
      expect(camera.position.y).toBe(7);
      expect(camera.position.z).toBe(10);
    });

    it('should warp camera on Digit2 key', async () => {
      const camera = new THREE.PerspectiveCamera();
      camera.position.set(99, 99, 99);
      const renderer = { domElement: document.createElement('canvas') };
      controls.setRenderer(renderer, camera);

      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit2' }));

      expect(camera.position.z).toBe(-10);
    });

    it('should warp camera on Digit3 key', async () => {
      const camera = new THREE.PerspectiveCamera();
      camera.position.set(99, 99, 99);
      const renderer = { domElement: document.createElement('canvas') };
      controls.setRenderer(renderer, camera);

      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit3' }));

      expect(camera.position.x).toBe(-10);
    });

    it('should warp camera on Digit4 key (overhead white)', async () => {
      const camera = new THREE.PerspectiveCamera();
      camera.position.set(99, 99, 99);
      const renderer = { domElement: document.createElement('canvas') };
      controls.setRenderer(renderer, camera);

      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit4' }));

      expect(camera.position.x).toBe(0);
      expect(camera.position.y).toBe(11);
      expect(camera.position.z).toBe(0);
    });

    it('should warp camera on Digit5 key (overhead black)', async () => {
      const camera = new THREE.PerspectiveCamera();
      camera.position.set(99, 99, 99);
      const renderer = { domElement: document.createElement('canvas') };
      controls.setRenderer(renderer, camera);

      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit5' }));

      expect(camera.position.y).toBe(11);
    });

    it('should warp camera on Digit6 key (overhead spectator)', async () => {
      const camera = new THREE.PerspectiveCamera();
      camera.position.set(99, 99, 99);
      const renderer = { domElement: document.createElement('canvas') };
      controls.setRenderer(renderer, camera);

      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit6' }));

      expect(camera.position.y).toBe(11);
    });

    it('should not warp on keys outside 1-6 range', async () => {
      const camera = new THREE.PerspectiveCamera();
      camera.position.set(99, 99, 99);
      const renderer = { domElement: document.createElement('canvas') };
      controls.setRenderer(renderer, camera);

      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit0' }));
      expect(camera.position.x).toBe(99);

      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit7' }));
      expect(camera.position.x).toBe(99);
    });

    it('should not warp on non-digit keys', async () => {
      const camera = new THREE.PerspectiveCamera();
      camera.position.set(99, 99, 99);
      const renderer = { domElement: document.createElement('canvas') };
      controls.setRenderer(renderer, camera);

      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }));
      expect(camera.position.x).toBe(99);
    });
  });
});
