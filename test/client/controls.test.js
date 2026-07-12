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

    it('should restore piece and clear selection on invalid drop', async () => {
      const renderer = setupGame();
      const pieceMesh = mockPieceMeshes[0];
      const origY = pieceMesh.mesh.position.y;

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

      // Piece should be restored to original position
      expect(pieceMesh.mesh.position.y).toBe(origY);
      // Selection cleared
      expect(controls.selectedSquare).toBeNull();
      expect(network.sendMove).not.toHaveBeenCalled();
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
});
