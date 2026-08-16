import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';

// ── Module mocks ──────────────────────────────────────────

vi.mock('../../client/network.js', () => ({
  onEvaluation: vi.fn(),
  serverEvaluation: null,
  myRole: null,
  serverBoard: null,
  serverTurn: 'white',
  serverPromotingPiece: null,
  serverGameOver: false,
  castlingRights: { wK: true, wQ: true, bK: true, bQ: true },
  enPassantTarget: null,
  previousMove: null,
  sendMove: vi.fn(),
  sendPremove: vi.fn(),
  sendPremoveCancel: vi.fn(),
  cancelPremove: vi.fn(),
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
  onPromotion: vi.fn(),
}));

vi.mock('../../client/ui.js', () => ({
  menuOpen: false,
  helpOpen: false,
  settingsOpen: false,
  showMenu: vi.fn(),
  hideMenu: vi.fn(),
  hideHelp: vi.fn(),
  hideSettings: vi.fn(),
  openHelpFromMenu: vi.fn(),
  updateMouseModeDisplay: vi.fn(),
  hidePromotionPicker: vi.fn(),
  hideConcedeConfirm: vi.fn(),
  mouseSensitivity: 0.002,
  showError: vi.fn(),
  showPromotionPicker: vi.fn(),
  setThreeScene: vi.fn(),
}));

vi.mock('../../client/board.js', () => ({
  squares: [],
  clearHighlights: vi.fn(),
  highlightSelected: vi.fn(),
  highlightValidMoves: vi.fn(),
  highlightCheck: vi.fn(),
  highlightPreviousMove: vi.fn(),
  highlightPremoveSelected: vi.fn(),
  highlightPremoveMoves: vi.fn(),
}));

vi.mock('../../shared/chess.mjs', async () => {
  // Use the real permissive premove generator and pieceType so candidate
  // tests exercise the actual engine behavior; keep the mock legal-move
  // generator (returns [] by default) used by the pre-existing on-turn tests.
  const actual = await vi.importActual('../../shared/chess.mjs');
  return {
    pieceColor: vi.fn((piece) => (piece > 0 ? 'white' : 'black')),
    getValidMoves: vi.fn(() => []),
    getPremoveMoves: vi.fn(actual.getPremoveMoves),
    pieceType: actual.pieceType,
    findKing: vi.fn(() => null),
    isInCheck: vi.fn(() => false),
  };
});

const mockPieceMeshes = [];
vi.mock('../../client/pieces.js', () => ({
  setSvgPieceSet: vi.fn(),
  getModelSet: () => 'simple-classic',
  setModelSet: vi.fn(),
  SVG_PIECE_SETS: ['mpchess', 'maestro', 'dubrovny'],
  MODEL_SETS: ['simple-classic', 'low-poly', 'jeu'],
  pieceMeshes: mockPieceMeshes,
  getPieceSvgUrl(pieceId) {
    const files = {
      1: 'wP',
      2: 'wN',
      3: 'wB',
      4: 'wR',
      5: 'wQ',
      6: 'wK',
      7: 'bP',
      8: 'bN',
      9: 'bB',
      10: 'bR',
      11: 'bQ',
      12: 'bK',
    };
    return `files/pieces/2d/mpchess/${files[pieceId]}.svg`;
  },
}));

vi.mock('../../client/arrows.js', () => ({
  addArrow: vi.fn(),
  clearArrows: vi.fn(),
  getArrowColor: vi.fn(() => '#ffffff'),
  getArrows: vi.fn(() => []),
  onArrowChange: vi.fn(),
  getArrowPath: vi.fn((f, t) => [f, t]),
}));

vi.mock('../../client/highlights.js', () => ({
  addHighlight: vi.fn(),
  clearHighlights: vi.fn(),
  getHighlightColor: vi.fn(() => '#ffdd00'),
  getHighlights: vi.fn(() => []),
  onHighlightChange: vi.fn(),
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
    chess = await import('../../shared/chess.mjs');
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

    it('cancels a confirmed premove on Escape (instead of opening the menu)', async () => {
      const premove = await import('../../client/premove.js');
      premove.setPremove({ fromFile: 4, fromRank: 1, toFile: 4, toRank: 3 });
      ui.menuOpen = false;
      const showMenuCalls = ui.showMenu.mock.calls.length;

      controls.handleKeyDown(new KeyboardEvent('keydown', { code: 'Escape' }));

      expect(network.cancelPremove).toHaveBeenCalledTimes(1);
      expect(ui.showMenu).toHaveBeenCalledTimes(showMenuCalls);
      premove.clearPremove();
    });

    it('still opens the menu on Escape when no premove is pending', async () => {
      const premove = await import('../../client/premove.js');
      expect(premove.getPremove()).toBeNull();
      ui.menuOpen = false;
      const cancelCalls = network.cancelPremove.mock.calls.length;
      const showMenuCalls = ui.showMenu.mock.calls.length;

      controls.handleKeyDown(new KeyboardEvent('keydown', { code: 'Escape' }));

      expect(network.cancelPremove).toHaveBeenCalledTimes(cancelCalls);
      expect(ui.showMenu).toHaveBeenCalledTimes(showMenuCalls + 1);
    });

    it('closes the menu on Escape even when a premove is pending (menu takes priority)', async () => {
      const premove = await import('../../client/premove.js');
      premove.setPremove({ fromFile: 4, fromRank: 1, toFile: 4, toRank: 3 });
      ui.menuOpen = true;
      const cancelCalls = network.cancelPremove.mock.calls.length;

      controls.handleKeyDown(new KeyboardEvent('keydown', { code: 'Escape' }));

      expect(ui.hideMenu).toHaveBeenCalled();
      expect(network.cancelPremove).toHaveBeenCalledTimes(cancelCalls);
      premove.clearPremove();
    });

    it('closes Help on Escape even when a premove is pending (Help takes priority)', async () => {
      const premove = await import('../../client/premove.js');
      premove.setPremove({ fromFile: 4, fromRank: 1, toFile: 4, toRank: 3 });
      ui.helpOpen = true;
      ui.menuOpen = false;
      const cancelCalls = network.cancelPremove.mock.calls.length;
      const hideHelpCalls = ui.hideHelp.mock.calls.length;

      try {
        controls.handleKeyDown(new KeyboardEvent('keydown', { code: 'Escape' }));

        // Only the Help overlay closes — the premove is NOT cancelled
        expect(ui.hideHelp).toHaveBeenCalledTimes(hideHelpCalls + 1);
        expect(network.cancelPremove).toHaveBeenCalledTimes(cancelCalls);
        expect(premove.getPremove()).not.toBeNull(); // premove intact
      } finally {
        // Restore overlay state so later tests (e.g. drag handlers that guard
        // on helpOpen/settingsOpen) are not affected.
        ui.helpOpen = false;
        premove.clearPremove();
      }
    });

    it('closes Settings on Escape even when a premove is pending (Settings takes priority)', async () => {
      const premove = await import('../../client/premove.js');
      premove.setPremove({ fromFile: 4, fromRank: 1, toFile: 4, toRank: 3 });
      ui.settingsOpen = true;
      ui.menuOpen = false;
      const cancelCalls = network.cancelPremove.mock.calls.length;
      const hideSettingsCalls = ui.hideSettings.mock.calls.length;

      try {
        controls.handleKeyDown(new KeyboardEvent('keydown', { code: 'Escape' }));

        // Only the Settings overlay closes — the premove is NOT cancelled
        expect(ui.hideSettings).toHaveBeenCalledTimes(hideSettingsCalls + 1);
        expect(network.cancelPremove).toHaveBeenCalledTimes(cancelCalls);
        expect(premove.getPremove()).not.toBeNull(); // premove intact
      } finally {
        // Restore overlay state so later tests (e.g. drag handlers that guard
        // on helpOpen/settingsOpen) are not affected.
        ui.settingsOpen = false;
        premove.clearPremove();
      }
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
      const canvas = document.createElement('canvas');
      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: canvas };

      controls.setRenderer(renderer, camera);

      // Toggle mouseLookOn on via Tab key
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab' }));
      expect(controls.mouseLookOn).toBe(true);

      // Simulate pointer lock being acquired
      Object.defineProperty(globalThis.document, 'pointerLockElement', {
        value: canvas,
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('pointerlockchange'));

      // Simulate pointer lock being lost (e.g. ESC pressed)
      Object.defineProperty(globalThis.document, 'pointerLockElement', {
        value: null,
        writable: true,
        configurable: true,
      });
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

    it('adds a square highlight on stationary right-click', async () => {
      const renderer = setupGame();

      // Raycast hits a2 (file=0, rank=1)
      globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 2.5 } }];

      // Right-click mousedown at (100, 100)
      const md = new MouseEvent('mousedown', {
        button: 2,
        clientX: 100,
        clientY: 100,
        bubbles: true,
      });
      renderer.domElement.dispatchEvent(md);

      // Right-click mouseup at same position (no drag)
      const mu = new MouseEvent('mouseup', {
        button: 2,
        clientX: 100,
        clientY: 100,
        bubbles: true,
      });
      document.dispatchEvent(mu);

      const hl = await import('../../client/highlights.js');
      expect(hl.addHighlight).toHaveBeenCalledWith(0, 1, '#ffdd00');
    });

    it('does not add highlight on right-drag, only arrow', async () => {
      const renderer = setupGame();

      // Raycast hits a2 (file=0, rank=1)
      globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 2.5 } }];

      // Right-click mousedown at (100, 100)
      const md = new MouseEvent('mousedown', {
        button: 2,
        clientX: 100,
        clientY: 100,
        bubbles: true,
      });
      renderer.domElement.dispatchEvent(md);

      // Move beyond drag threshold (5px for 3D) and release at b2
      globalThis.__mockRaycasterResult = [{ point: { x: -2.5, y: 0.041, z: 2.5 } }];
      const mu = new MouseEvent('mouseup', {
        button: 2,
        clientX: 110,
        clientY: 100,
        bubbles: true,
      });
      document.dispatchEvent(mu);

      const hl = await import('../../client/highlights.js');
      expect(hl.addHighlight).not.toHaveBeenCalled();

      const arrows = await import('../../client/arrows.js');
      expect(arrows.addArrow).toHaveBeenCalled();
    });

    it('right-click on different squares draws arrow even within pixel threshold', async () => {
      const renderer = setupGame();

      // Raycast hits a2 (file=0, rank=1)
      globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 2.5 } }];

      // Right-click mousedown at (100, 100)
      const md = new MouseEvent('mousedown', {
        button: 2,
        clientX: 100,
        clientY: 100,
        bubbles: true,
      });
      renderer.domElement.dispatchEvent(md);

      // Release on adjacent square b2 — same pixel position (within threshold)
      globalThis.__mockRaycasterResult = [{ point: { x: -2.5, y: 0.041, z: 2.5 } }];
      const mu = new MouseEvent('mouseup', {
        button: 2,
        clientX: 100,
        clientY: 100,
        bubbles: true,
      });
      document.dispatchEvent(mu);

      const hl = await import('../../client/highlights.js');
      expect(hl.addHighlight).not.toHaveBeenCalled();

      const arrows = await import('../../client/arrows.js');
      expect(arrows.addArrow).toHaveBeenCalled();
    });

    it('right-click release off board creates no annotation', async () => {
      const renderer = setupGame();

      // Raycast hits a2 (file=0, rank=1)
      globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 2.5 } }];

      // Right-click mousedown
      const md = new MouseEvent('mousedown', {
        button: 2,
        clientX: 100,
        clientY: 100,
        bubbles: true,
      });
      renderer.domElement.dispatchEvent(md);

      // Release off board — raycast returns nothing
      globalThis.__mockRaycasterResult = [];
      const mu = new MouseEvent('mouseup', {
        button: 2,
        clientX: 9999,
        clientY: 9999,
        bubbles: true,
      });
      document.dispatchEvent(mu);

      const hl = await import('../../client/highlights.js');
      expect(hl.addHighlight).not.toHaveBeenCalled();

      const arrows = await import('../../client/arrows.js');
      expect(arrows.addArrow).not.toHaveBeenCalled();
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
      expect(board.highlightPreviousMove).toHaveBeenCalled();
      expect(board.highlightCheck).toHaveBeenCalled();
    });

    it('should call highlightPreviousMove on touch cancel', async () => {
      const renderer = setupGame();

      // Simulate a touchstart on a valid piece
      const touch = {
        identifier: 1,
        clientX: 100,
        clientY: 100,
      };
      globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 2.5 } }];

      const ts = new TouchEvent('touchstart', {
        bubbles: true,
        cancelable: true,
        changedTouches: [touch],
        touches: [touch],
      });
      renderer.domElement.dispatchEvent(ts);

      // Dispatch touchcancel
      const tc = new TouchEvent('touchcancel', {
        bubbles: true,
        cancelable: true,
        changedTouches: [touch],
      });
      document.dispatchEvent(tc);

      // highlightPreviousMove should be called to restore previous move
      expect(board.highlightPreviousMove).toHaveBeenCalled();
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

  // ── 3D premove interaction (Phase 3A) ──────────────────

  describe('3D premove interaction', () => {
    const W_PAWN = 1,
      W_KNIGHT = 2,
      W_BISHOP = 3,
      W_ROOK = 4,
      W_QUEEN = 5,
      W_KING = 6;
    const B_PAWN = 7,
      B_KNIGHT = 8,
      B_BISHOP = 9,
      B_ROOK = 10,
      B_QUEEN = 11,
      B_KING = 12;

    let premove, selection, highlights, arrows;

    function rayPoint(file, rank) {
      return { point: { x: file - 3.5, y: 0.041, z: 3.5 - rank } };
    }

    function setupBoard() {
      for (let r = 0; r < 8; r++) {
        board.squares[r] = [];
        for (let f = 0; f < 8; f++) {
          board.squares[r][f] = { rank: r, file: f };
        }
      }
    }

    function emptyBoard() {
      return Array(8)
        .fill(null)
        .map(() => Array(8).fill(0));
    }

    function setupGame({ turn = 'black', myRole = 'white', boardArr = null, meshAt = null } = {}) {
      setupBoard();
      mockPieceMeshes.length = 0;

      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: document.createElement('canvas') };
      controls.setRenderer(renderer, camera);
      controls.setClickHandler(renderer);
      controls.setDragHandlers(renderer);

      network.myRole = myRole;
      network.serverTurn = turn;
      network.serverBoard = boardArr || emptyBoard();
      network.serverGameOver = false;
      network.serverPromotingPiece = null;
      ui.menuOpen = false;

      chess.pieceColor.mockImplementation((p) => (p === 0 ? null : p >= 7 ? 'black' : 'white'));
      chess.getValidMoves.mockReturnValue([]);
      chess.getPremoveMoves.mockClear();
      network.sendMove.mockClear();
      network.sendPremove.mockClear();
      network.cancelPremove.mockClear();
      ui.showError.mockClear();
      ui.showPromotionPicker.mockClear();

      if (meshAt) mockPieceMeshes.push(mockPieceMesh(meshAt[0], meshAt[1]));

      return renderer;
    }

    function click(renderer, file, rank) {
      globalThis.__mockRaycasterResult = [rayPoint(file, rank)];
      renderer.domElement.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }

    function rightClick(renderer, file, rank) {
      globalThis.__mockRaycasterResult = [rayPoint(file, rank)];
      renderer.domElement.dispatchEvent(
        new MouseEvent('mousedown', { button: 2, clientX: 100, clientY: 100, bubbles: true })
      );
      document.dispatchEvent(
        new MouseEvent('mouseup', { button: 2, clientX: 100, clientY: 100, bubbles: true })
      );
    }

    beforeEach(async () => {
      premove = await import('../../client/premove.js');
      premove.setPremoveEnabled(true);
      selection = await import('../../client/selection.js');
      highlights = await import('../../client/highlights.js');
      arrows = await import('../../client/arrows.js');
    });

    afterEach(() => {
      premove.clearPremove();
      premove.setPremoveEnabled(true);
    });

    // ── Off-turn selection ────────────────────────────────

    it('off-turn own-piece click selects in premove mode (no toast, no send)', () => {
      const b = emptyBoard();
      b[1][0] = W_PAWN; // a2
      const renderer = setupGame({ boardArr: b, meshAt: [0, 1] });

      click(renderer, 0, 1); // a2

      expect(controls.selectedSquare).toEqual({ file: 0, rank: 1 });
      expect(selection.getSelectionMode()).toBe('premove');
      expect(ui.showError).not.toHaveBeenCalled();
      expect(network.sendMove).not.toHaveBeenCalled();
      expect(network.sendPremove).not.toHaveBeenCalled();
    });

    it('blocks off-turn premove interaction when premoves are disabled', () => {
      const b = emptyBoard();
      b[1][0] = W_PAWN;
      const renderer = setupGame({ boardArr: b, meshAt: [0, 1] });
      premove.setPremoveEnabled(false);

      click(renderer, 0, 1);

      expect(controls.selectedSquare).toBeNull();
      expect(selection.getSelectionMode()).not.toBe('premove');
      expect(chess.getPremoveMoves).not.toHaveBeenCalled();
      expect(network.sendPremove).not.toHaveBeenCalled();
      expect(ui.showError).toHaveBeenCalledWith('Not your turn');
    });

    it('off-turn selection invokes only premove-specific highlight APIs', () => {
      const b = emptyBoard();
      b[1][0] = W_PAWN; // a2
      const renderer = setupGame({ boardArr: b, meshAt: [0, 1] });
      controls.setScene({}); // enable the scene-gated moves-highlight wrappers

      board.highlightPremoveSelected.mockClear();
      board.highlightSelected.mockClear();
      board.highlightPremoveMoves.mockClear();
      board.highlightValidMoves.mockClear();

      click(renderer, 0, 1); // a2 (off-turn → premove mode)

      // Premove-specific highlight APIs are used
      expect(board.highlightPremoveSelected).toHaveBeenCalledWith(0, 1);
      expect(board.highlightPremoveMoves).toHaveBeenCalled();
      // Normal highlight APIs are NOT used
      expect(board.highlightSelected).not.toHaveBeenCalled();
      expect(board.highlightValidMoves).not.toHaveBeenCalled();
    });

    it('on-turn selection invokes only normal highlight APIs', () => {
      const b = emptyBoard();
      b[1][0] = W_PAWN; // a2
      const renderer = setupGame({ turn: 'white', boardArr: b, meshAt: [0, 1] });
      chess.getValidMoves.mockReturnValue([{ file: 0, rank: 3 }]);
      const mockScene = {};
      controls.setScene(mockScene); // enable the scene-gated moves-highlight wrappers

      board.highlightPremoveSelected.mockClear();
      board.highlightSelected.mockClear();
      board.highlightPremoveMoves.mockClear();
      board.highlightValidMoves.mockClear();

      click(renderer, 0, 1); // a2 (on-turn → legal mode)

      // Normal highlight APIs are used
      expect(board.highlightSelected).toHaveBeenCalledWith(0, 1);
      expect(board.highlightValidMoves).toHaveBeenCalledWith(
        mockScene,
        expect.arrayContaining([expect.objectContaining({ file: 0, rank: 3 })])
      );
      // Premove-specific highlight APIs are NOT used
      expect(board.highlightPremoveSelected).not.toHaveBeenCalled();
      expect(board.highlightPremoveMoves).not.toHaveBeenCalled();
    });

    it('off-turn selection computes candidates with getPremoveMoves on a cloned board', () => {
      const b = emptyBoard();
      b[1][0] = W_PAWN; // a2
      const renderer = setupGame({ boardArr: b, meshAt: [0, 1] });

      click(renderer, 0, 1); // a2

      // Permissive generator used, legal generator not
      expect(chess.getPremoveMoves).toHaveBeenCalledTimes(1);
      expect(chess.getValidMoves).not.toHaveBeenCalled();
      // The board passed is a defensive clone, not the live serverBoard
      const passedBoard = chess.getPremoveMoves.mock.calls[0][0];
      expect(passedBoard).not.toBe(network.serverBoard);
      expect(passedBoard).toEqual(network.serverBoard);
      // a2 pawn premove candidates include a3 and a4 (two-step from start rank)
      expect(controls.validMoves).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ file: 0, rank: 2 }),
          expect.objectContaining({ file: 0, rank: 3 }),
        ])
      );
    });

    it('off-turn premove candidates are permissive: a pinned piece still gets candidates', () => {
      // White Ke1 + Nd2, black Ba5 on the a5–e1 diagonal → knight is pinned
      const b = emptyBoard();
      b[0][4] = W_KING; // e1
      b[1][3] = W_KNIGHT; // d2
      b[4][0] = B_BISHOP; // a5
      b[7][4] = B_KING; // e8
      const renderer = setupGame({ boardArr: b, meshAt: [3, 1] });

      click(renderer, 3, 1); // d2

      expect(controls.selectedSquare).toEqual({ file: 3, rank: 1 });
      expect(selection.getSelectionMode()).toBe('premove');
      // The pinned knight has 0 legal moves but 6 premove candidates
      expect(controls.validMoves).toHaveLength(6);
    });

    it('off-turn enemy-piece click does not select and shows the not-your-turn toast', () => {
      const b = emptyBoard();
      b[1][0] = W_PAWN; // a2 (own)
      b[6][0] = B_PAWN; // a7 (enemy)
      const renderer = setupGame({ boardArr: b, meshAt: [0, 1] });

      click(renderer, 0, 6); // a7 (enemy)

      expect(controls.selectedSquare).toBeNull();
      expect(ui.showError).toHaveBeenCalledTimes(1);
      expect(network.sendPremove).not.toHaveBeenCalled();
      expect(network.sendMove).not.toHaveBeenCalled();
    });

    it('off-turn empty-square click does not select and shows no toast', () => {
      const b = emptyBoard();
      b[1][0] = W_PAWN; // a2
      const renderer = setupGame({ boardArr: b, meshAt: [0, 1] });

      click(renderer, 4, 4); // e5 (empty)

      expect(controls.selectedSquare).toBeNull();
      expect(ui.showError).not.toHaveBeenCalled();
      expect(network.sendPremove).not.toHaveBeenCalled();
    });

    it('spectator cannot premove (no own-piece selection, no send)', () => {
      const b = emptyBoard();
      b[1][0] = W_PAWN; // a2
      const renderer = setupGame({ myRole: 'spectator', boardArr: b, meshAt: [0, 1] });

      click(renderer, 0, 1); // a2

      expect(controls.selectedSquare).toBeNull();
      expect(network.sendPremove).not.toHaveBeenCalled();
      expect(network.sendMove).not.toHaveBeenCalled();
    });

    // ── Off-turn completion (click / drag / touch) ────────

    it('off-turn click on a candidate destination sends premove, not move', () => {
      const b = emptyBoard();
      b[1][0] = W_PAWN; // a2
      const renderer = setupGame({ boardArr: b, meshAt: [0, 1] });

      click(renderer, 0, 1); // select a2 (premove)
      expect(controls.selectedSquare).not.toBeNull();

      click(renderer, 0, 3); // a4 (candidate)

      expect(network.sendPremove).toHaveBeenCalledWith(0, 1, 0, 3);
      expect(network.sendMove).not.toHaveBeenCalled();
      // Selection cleared after completion
      expect(controls.selectedSquare).toBeNull();
    });

    it('off-turn click on a non-candidate own piece re-selects it (premove mode)', () => {
      const b = emptyBoard();
      b[1][0] = W_PAWN; // a2
      b[1][1] = W_PAWN; // b2
      const renderer = setupGame({ boardArr: b, meshAt: [0, 1] });

      click(renderer, 0, 1); // select a2 (premove)
      click(renderer, 1, 1); // b2 (not a candidate for a2)

      expect(controls.selectedSquare).toEqual({ file: 1, rank: 1 });
      expect(selection.getSelectionMode()).toBe('premove');
      expect(network.sendPremove).not.toHaveBeenCalled();
    });

    it('off-turn drag on own piece completes as premove (mesh returned to square)', () => {
      const b = emptyBoard();
      b[1][0] = W_PAWN; // a2
      const renderer = setupGame({ boardArr: b, meshAt: [0, 1] });
      const mesh = mockPieceMeshes[0];

      // mousedown on a2
      globalThis.__mockRaycasterResult = [rayPoint(0, 1)];
      renderer.domElement.dispatchEvent(
        new MouseEvent('mousedown', { button: 0, clientX: 100, clientY: 100, bubbles: true })
      );

      // mousemove beyond threshold — commits the drag (premove mode)
      document.dispatchEvent(
        new MouseEvent('mousemove', { clientX: 200, clientY: 200, bubbles: true })
      );
      expect(selection.getSelectionMode()).toBe('premove');
      expect(mesh.mesh.position.y).toBe(controls.CONTROLS_CONFIG.dragHeight);

      // mouseup on a4 (candidate)
      globalThis.__mockRaycasterResult = [rayPoint(0, 3)];
      document.dispatchEvent(
        new MouseEvent('mouseup', { clientX: 300, clientY: 300, bubbles: true })
      );

      expect(network.sendPremove).toHaveBeenCalledWith(0, 1, 0, 3);
      expect(network.sendMove).not.toHaveBeenCalled();
      // A stored premove never changes the board — mesh returned to its square
      expect(mesh.mesh.position.y).toBe(0.01);
      expect(controls.selectedSquare).toBeNull();
    });

    it('off-turn touch drag on own piece completes as premove', () => {
      const b = emptyBoard();
      b[1][0] = W_PAWN; // a2
      const renderer = setupGame({ boardArr: b, meshAt: [0, 1] });

      const touch = { identifier: 1, clientX: 100, clientY: 100 };
      globalThis.__mockRaycasterResult = [rayPoint(0, 1)];
      renderer.domElement.dispatchEvent(
        new TouchEvent('touchstart', {
          bubbles: true,
          cancelable: true,
          changedTouches: [touch],
          touches: [touch],
        })
      );

      const moveTouch = { identifier: 1, clientX: 200, clientY: 200 };
      document.dispatchEvent(
        new TouchEvent('touchmove', {
          bubbles: true,
          cancelable: true,
          changedTouches: [moveTouch],
          touches: [moveTouch],
        })
      );

      // Committed drag in premove mode
      expect(selection.getSelectionMode()).toBe('premove');

      const endTouch = { identifier: 1, clientX: 300, clientY: 300 };
      globalThis.__mockRaycasterResult = [rayPoint(0, 3)];
      document.dispatchEvent(
        new TouchEvent('touchend', {
          bubbles: true,
          cancelable: true,
          changedTouches: [endTouch],
        })
      );

      expect(network.sendPremove).toHaveBeenCalledWith(0, 1, 0, 3);
      expect(network.sendMove).not.toHaveBeenCalled();
    });

    it('off-turn touch tap (below threshold) selects in premove mode and a second tap completes the premove', () => {
      const b = emptyBoard();
      b[1][0] = W_PAWN; // a2
      const renderer = setupGame({ boardArr: b, meshAt: [0, 1] });

      // Tap a2: touchstart + touchend below the drag threshold — the browser
      // fires a compatibility click, which must select in premove mode. The
      // touch gesture state (dragCandidate/dragTouchId) must not interfere
      // with the click handler.
      const touch = { identifier: 1, clientX: 100, clientY: 100 };
      globalThis.__mockRaycasterResult = [rayPoint(0, 1)];
      renderer.domElement.dispatchEvent(
        new TouchEvent('touchstart', {
          bubbles: true,
          cancelable: true,
          changedTouches: [touch],
          touches: [touch],
        })
      );
      document.dispatchEvent(
        new TouchEvent('touchend', {
          bubbles: true,
          cancelable: true,
          changedTouches: [touch],
        })
      );
      click(renderer, 0, 1); // compatibility click

      expect(controls.selectedSquare).toEqual({ file: 0, rank: 1 });
      expect(selection.getSelectionMode()).toBe('premove');
      expect(network.sendPremove).not.toHaveBeenCalled();
      expect(network.sendMove).not.toHaveBeenCalled();

      // Tap a4 (a candidate): the second compatibility click completes the
      // premove — no stale touch state eats or misroutes it.
      const touch2 = { identifier: 2, clientX: 100, clientY: 100 };
      globalThis.__mockRaycasterResult = [rayPoint(0, 3)];
      renderer.domElement.dispatchEvent(
        new TouchEvent('touchstart', {
          bubbles: true,
          cancelable: true,
          changedTouches: [touch2],
          touches: [touch2],
        })
      );
      document.dispatchEvent(
        new TouchEvent('touchend', {
          bubbles: true,
          cancelable: true,
          changedTouches: [touch2],
        })
      );
      click(renderer, 0, 3); // compatibility click

      expect(network.sendPremove).toHaveBeenCalledWith(0, 1, 0, 3);
      expect(network.sendMove).not.toHaveBeenCalled();
    });

    it('late turn flip between selection and completion still sends premove', () => {
      const b = emptyBoard();
      b[1][0] = W_PAWN; // a2
      const renderer = setupGame({ boardArr: b, meshAt: [0, 1] });

      click(renderer, 0, 1); // select a2 off-turn (premove mode)
      expect(selection.getSelectionMode()).toBe('premove');

      // The turn has flipped on the server, but the client state is stale
      // (no state update processed yet) — the selection is still in premove
      // mode, so the completion must send `premove` (the server decides
      // execute-now vs store).
      network.serverTurn = 'white';

      click(renderer, 0, 3); // complete on a4
      expect(network.sendPremove).toHaveBeenCalledWith(0, 1, 0, 3);
      expect(network.sendMove).not.toHaveBeenCalled();
    });

    it('state update during a drag cancels it and suppresses the release click', () => {
      const b = emptyBoard();
      b[1][0] = W_PAWN; // a2
      const renderer = setupGame({ boardArr: b, meshAt: [0, 1] });
      const mesh = mockPieceMeshes[0];

      // mousedown on a2
      globalThis.__mockRaycasterResult = [rayPoint(0, 1)];
      renderer.domElement.dispatchEvent(
        new MouseEvent('mousedown', { button: 0, clientX: 100, clientY: 100, bubbles: true })
      );

      // mousemove beyond threshold — commits the drag (premove mode)
      document.dispatchEvent(
        new MouseEvent('mousemove', { clientX: 200, clientY: 200, bubbles: true })
      );
      expect(selection.getSelectionMode()).toBe('premove');
      expect(mesh.mesh.position.y).toBe(controls.CONTROLS_CONFIG.dragHeight);

      // A state update (e.g. a turn flip) interrupts the active drag
      const stateCb = network.onStateUpdate.mock.calls.at(-1)[0];
      stateCb({});

      // The mesh is restored to its canonical square position
      expect(mesh.mesh.position.x).toBe(-3.5);
      expect(mesh.mesh.position.y).toBe(0.01);
      expect(mesh.mesh.position.z).toBe(2.5);

      // Release on a4 (a valid premove candidate) — the drag was already
      // canceled, so the release itself sends nothing
      globalThis.__mockRaycasterResult = [rayPoint(0, 3)];
      document.dispatchEvent(
        new MouseEvent('mouseup', { clientX: 300, clientY: 300, bubbles: true })
      );

      // The compatibility click from the release is suppressed — the stale
      // selection must not execute a move or premove
      click(renderer, 0, 3);

      expect(network.sendMove).not.toHaveBeenCalled();
      expect(network.sendPremove).not.toHaveBeenCalled();
      // The mesh remains at its canonical position
      expect(mesh.mesh.position.x).toBe(-3.5);
      expect(mesh.mesh.position.y).toBe(0.01);
      expect(mesh.mesh.position.z).toBe(2.5);
    });

    it('state update during a committed touch drag does not swallow the next tap', () => {
      const b = emptyBoard();
      b[1][0] = W_PAWN; // a2
      const renderer = setupGame({ boardArr: b, meshAt: [0, 1] });
      const mesh = mockPieceMeshes[0];

      // Begin a committed touch drag on a2
      const touch = { identifier: 1, clientX: 100, clientY: 100 };
      globalThis.__mockRaycasterResult = [rayPoint(0, 1)];
      renderer.domElement.dispatchEvent(
        new TouchEvent('touchstart', {
          bubbles: true,
          cancelable: true,
          changedTouches: [touch],
          touches: [touch],
        })
      );

      // Move beyond threshold — commits the drag (premove mode)
      const moveTouch = { identifier: 1, clientX: 200, clientY: 200 };
      document.dispatchEvent(
        new TouchEvent('touchmove', {
          bubbles: true,
          cancelable: true,
          changedTouches: [moveTouch],
          touches: [moveTouch],
        })
      );
      expect(selection.getSelectionMode()).toBe('premove');
      expect(mesh.mesh.position.y).toBe(controls.CONTROLS_CONFIG.dragHeight);

      // A state update (e.g. a turn flip) interrupts the active drag
      const stateCb = network.onStateUpdate.mock.calls.at(-1)[0];
      stateCb({});

      // The mesh is restored to its canonical square position
      expect(mesh.mesh.position.x).toBe(-3.5);
      expect(mesh.mesh.position.y).toBe(0.01);
      expect(mesh.mesh.position.z).toBe(2.5);

      // End the touch — the release must not execute the stale selection
      const endTouch = { identifier: 1, clientX: 300, clientY: 300 };
      globalThis.__mockRaycasterResult = [rayPoint(0, 3)];
      document.dispatchEvent(
        new TouchEvent('touchend', {
          bubbles: true,
          cancelable: true,
          changedTouches: [endTouch],
        })
      );

      // The interrupted drag sends nothing
      expect(network.sendMove).not.toHaveBeenCalled();
      expect(network.sendPremove).not.toHaveBeenCalled();

      // The next legitimate tap is processed (not eaten by a stale
      // dragCompleted flag). With the stale a2 selection still active, tapping
      // a4 (a valid premove candidate) completes the premove.
      click(renderer, 0, 3);

      expect(network.sendPremove).toHaveBeenCalledWith(0, 1, 0, 3);
    });

    // ── On-turn regression ────────────────────────────────

    it('on-turn click-to-move still sends move (regression)', () => {
      const b = emptyBoard();
      b[1][0] = W_PAWN; // a2
      const renderer = setupGame({ turn: 'white', boardArr: b, meshAt: [0, 1] });
      // On-turn: getValidMoves provides the legal candidates
      chess.getValidMoves.mockReturnValue([{ file: 0, rank: 3 }]);

      click(renderer, 0, 1); // select a2 (legal mode)
      expect(selection.getSelectionMode()).toBe('legal');
      expect(chess.getValidMoves).toHaveBeenCalledTimes(1);
      expect(chess.getPremoveMoves).not.toHaveBeenCalled();

      click(renderer, 0, 3); // a4 (legal)
      expect(network.sendMove).toHaveBeenCalledWith(0, 1, 0, 3);
      expect(network.sendPremove).not.toHaveBeenCalled();
    });

    // ── Promotion premove ─────────────────────────────────

    it('off-turn pawn premove to a promotion rank opens the picker in premove mode', () => {
      const b = emptyBoard();
      b[6][4] = W_PAWN; // e7
      b[0][4] = W_KING; // e1
      b[7][3] = B_KING; // d8
      const renderer = setupGame({ boardArr: b, meshAt: [4, 6] });

      click(renderer, 4, 6); // select e7 (premove)
      expect(controls.selectedSquare).toEqual({ file: 4, rank: 6 });

      click(renderer, 4, 7); // e8 (promotion destination)

      expect(ui.showPromotionPicker).toHaveBeenCalledWith(4, 7, 'white', {
        mode: 'premove',
        fromFile: 4,
        fromRank: 6,
        toFile: 4,
        toRank: 7,
      });
      // Nothing is sent until the picker choice
      expect(network.sendPremove).not.toHaveBeenCalled();
      expect(network.sendMove).not.toHaveBeenCalled();
    });

    it('off-turn drag of a pawn to a promotion rank opens the picker and returns the mesh', () => {
      const b = emptyBoard();
      b[6][4] = W_PAWN; // e7
      b[0][4] = W_KING; // e1
      b[7][3] = B_KING; // d8
      const renderer = setupGame({ boardArr: b, meshAt: [4, 6] });
      const mesh = mockPieceMeshes[0];

      // mousedown on e7
      globalThis.__mockRaycasterResult = [rayPoint(4, 6)];
      renderer.domElement.dispatchEvent(
        new MouseEvent('mousedown', { button: 0, clientX: 100, clientY: 100, bubbles: true })
      );

      // mousemove beyond threshold — commits the drag (premove mode)
      document.dispatchEvent(
        new MouseEvent('mousemove', { clientX: 200, clientY: 200, bubbles: true })
      );
      expect(selection.getSelectionMode()).toBe('premove');
      expect(mesh.mesh.position.y).toBe(controls.CONTROLS_CONFIG.dragHeight);

      // mouseup on e8 (promotion destination)
      globalThis.__mockRaycasterResult = [rayPoint(4, 7)];
      document.dispatchEvent(
        new MouseEvent('mouseup', { clientX: 300, clientY: 300, bubbles: true })
      );

      // The picker opens in premove mode; nothing is sent until a piece is chosen
      expect(ui.showPromotionPicker).toHaveBeenCalledWith(4, 7, 'white', {
        mode: 'premove',
        fromFile: 4,
        fromRank: 6,
        toFile: 4,
        toRank: 7,
      });
      expect(network.sendPremove).not.toHaveBeenCalled();
      expect(network.sendMove).not.toHaveBeenCalled();
      // A stored premove never changes the board — mesh returned to its square
      expect(mesh.mesh.position.y).toBe(0.01);
      expect(controls.selectedSquare).toBeNull();
    });

    // ── Cancellation: origin re-click ─────────────────────

    it('re-clicking the confirmed premove origin cancels it', () => {
      const b = emptyBoard();
      b[1][4] = W_PAWN; // e2
      const renderer = setupGame({ boardArr: b, meshAt: [4, 1] });

      // A confirmed premove e2–e4
      premove.setPremove({ fromFile: 4, fromRank: 1, toFile: 4, toRank: 3 });

      click(renderer, 4, 1); // re-click the origin e2

      expect(network.cancelPremove).toHaveBeenCalledTimes(1);
      // No selection was made (cancel takes priority over selection)
      expect(controls.selectedSquare).toBeNull();
      expect(network.sendPremove).not.toHaveBeenCalled();
    });

    it('re-clicking a non-origin square does not cancel the premove', () => {
      const b = emptyBoard();
      b[1][4] = W_PAWN; // e2
      b[1][5] = W_PAWN; // f2
      const renderer = setupGame({ boardArr: b, meshAt: [4, 1] });

      premove.setPremove({ fromFile: 4, fromRank: 1, toFile: 4, toRank: 3 });

      click(renderer, 5, 1); // f2 (not the origin)

      expect(network.cancelPremove).not.toHaveBeenCalled();
      // f2 is an own piece off-turn → selected in premove mode
      expect(controls.selectedSquare).toEqual({ file: 5, rank: 1 });
      expect(premove.getPremove()).not.toBeNull(); // premove intact
    });

    // ── Cancellation: right-click priority ────────────────

    it('same-square right-click on the premove origin cancels (priority over highlight)', () => {
      const b = emptyBoard();
      b[1][4] = W_PAWN; // e2
      const renderer = setupGame({ boardArr: b, meshAt: [4, 1] });

      premove.setPremove({ fromFile: 4, fromRank: 1, toFile: 4, toRank: 3 });

      rightClick(renderer, 4, 1); // same-square right-click on the origin e2

      expect(network.cancelPremove).toHaveBeenCalledTimes(1);
      expect(highlights.addHighlight).not.toHaveBeenCalled();
    });

    it('same-square right-click on a NON-origin square still highlights (no cancel)', () => {
      const b = emptyBoard();
      b[1][4] = W_PAWN; // e2
      const renderer = setupGame({ boardArr: b, meshAt: [4, 1] });

      premove.setPremove({ fromFile: 4, fromRank: 1, toFile: 4, toRank: 3 });

      rightClick(renderer, 0, 1); // same-square right-click on a2 (not the origin)

      expect(network.cancelPremove).not.toHaveBeenCalled();
      expect(highlights.addHighlight).toHaveBeenCalledWith(0, 1, '#ffdd00');
    });

    it('right-click drag ending on the premove origin still draws an arrow (no cancel)', () => {
      const b = emptyBoard();
      b[1][4] = W_PAWN; // e2
      const renderer = setupGame({ boardArr: b, meshAt: [4, 1] });

      premove.setPremove({ fromFile: 4, fromRank: 1, toFile: 4, toRank: 3 });

      // Right-click mousedown on a2
      globalThis.__mockRaycasterResult = [rayPoint(0, 1)];
      renderer.domElement.dispatchEvent(
        new MouseEvent('mousedown', { button: 2, clientX: 100, clientY: 100, bubbles: true })
      );

      // Release on e2 (the premove origin) — a drag (press ≠ release)
      globalThis.__mockRaycasterResult = [rayPoint(4, 1)];
      document.dispatchEvent(
        new MouseEvent('mouseup', { button: 2, clientX: 200, clientY: 100, bubbles: true })
      );

      expect(arrows.addArrow).toHaveBeenCalled();
      expect(highlights.addHighlight).not.toHaveBeenCalled();
      expect(network.cancelPremove).not.toHaveBeenCalled();
      expect(premove.getPremove()).not.toBeNull(); // premove intact
    });

    it('right-click annotations are unchanged with no premove (regression)', () => {
      const b = emptyBoard();
      b[1][4] = W_PAWN; // e2
      const renderer = setupGame({ boardArr: b, meshAt: [4, 1] });

      // No premove set. Same-square right-click on a2 → highlight
      rightClick(renderer, 0, 1);

      expect(highlights.addHighlight).toHaveBeenCalledWith(0, 1, '#ffdd00');
      expect(network.cancelPremove).not.toHaveBeenCalled();
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

  // ── CONTROLS_CONFIG ──

  describe('CONTROLS_CONFIG', () => {
    it('should export CONTROLS_CONFIG', async () => {
      expect(controls.CONTROLS_CONFIG).toBeDefined();
      expect(typeof controls.CONTROLS_CONFIG).toBe('object');
    });

    it('should have dragThreshold set to 5', async () => {
      expect(controls.CONTROLS_CONFIG.dragThreshold).toBe(5);
    });

    it('should have dragHeight set to 0.6', async () => {
      expect(controls.CONTROLS_CONFIG.dragHeight).toBe(0.6);
    });

    it('should have pitchMin and pitchMax as symmetric values', async () => {
      expect(controls.CONTROLS_CONFIG.pitchMin).toBe(-Math.PI / 2.1);
      expect(controls.CONTROLS_CONFIG.pitchMax).toBe(Math.PI / 2.1);
      expect(controls.CONTROLS_CONFIG.pitchMin).toBe(-controls.CONTROLS_CONFIG.pitchMax);
    });

    it('should have cameraPositions with entries 1-6', async () => {
      const cp = controls.CONTROLS_CONFIG.cameraPositions;
      for (let i = 1; i <= 6; i++) {
        expect(cp[i]).toBeDefined();
        expect(cp[i].x).toBeDefined();
        expect(cp[i].y).toBeDefined();
        expect(cp[i].z).toBeDefined();
      }
    });

    it('should have roleKey mapping for white, black, spectator', async () => {
      expect(controls.CONTROLS_CONFIG.roleKey.white).toBe(1);
      expect(controls.CONTROLS_CONFIG.roleKey.black).toBe(2);
      expect(controls.CONTROLS_CONFIG.roleKey.spectator).toBe(3);
    });

    it('should have CAMERA_POSITIONS as a reference to cameraPositions', async () => {
      expect(controls.CAMERA_POSITIONS).toBe(controls.CONTROLS_CONFIG.cameraPositions);
    });

    it('should use config dragHeight for piece elevation during drag', async () => {
      // Populate squares
      for (let r = 0; r < 8; r++) {
        board.squares[r] = [];
        for (let f = 0; f < 8; f++) {
          board.squares[r][f] = { rank: r, file: f };
        }
      }

      mockPieceMeshes.length = 0;
      mockPieceMeshes.push(mockPieceMesh(0, 1));

      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: document.createElement('canvas') };
      controls.setRenderer(renderer, camera);
      controls.setDragHandlers(renderer);

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

      // mousedown on pawn
      globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 2.5 } }];
      const md = new MouseEvent('mousedown', {
        button: 0,
        clientX: 100,
        clientY: 100,
        bubbles: true,
      });
      renderer.domElement.dispatchEvent(md);

      // mousemove beyond threshold — commits drag
      const mm = new MouseEvent('mousemove', {
        clientX: 200,
        clientY: 200,
        bubbles: true,
      });
      document.dispatchEvent(mm);

      // Piece Y should equal config dragHeight
      expect(mockPieceMeshes[0].mesh.position.y).toBe(controls.CONTROLS_CONFIG.dragHeight);

      // Clean up drag state
      globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 2.5 } }];
      const mu = new MouseEvent('mouseup', { clientX: 200, clientY: 200, bubbles: true });
      document.dispatchEvent(mu);
    });

    it('should use config dragThreshold for click-vs-drag distinction', async () => {
      // Populate squares
      for (let r = 0; r < 8; r++) {
        board.squares[r] = [];
        for (let f = 0; f < 8; f++) {
          board.squares[r][f] = { rank: r, file: f };
        }
      }

      mockPieceMeshes.length = 0;
      mockPieceMeshes.push(mockPieceMesh(0, 1));

      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: document.createElement('canvas') };
      controls.setRenderer(renderer, camera);
      controls.setDragHandlers(renderer);

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

      // mousedown on pawn
      globalThis.__mockRaycasterResult = [{ point: { x: -3.5, y: 0.041, z: 2.5 } }];
      const md = new MouseEvent('mousedown', {
        button: 0,
        clientX: 100,
        clientY: 100,
        bubbles: true,
      });
      renderer.domElement.dispatchEvent(md);

      // mousemove just below threshold — should NOT commit drag
      const threshold = controls.CONTROLS_CONFIG.dragThreshold;
      const mm = new MouseEvent('mousemove', {
        clientX: 100 + threshold - 1,
        clientY: 100,
        bubbles: true,
      });
      document.dispatchEvent(mm);

      // Drag should not be committed — piece should not be lifted
      expect(mockPieceMeshes[0].mesh.position.y).not.toBe(controls.CONTROLS_CONFIG.dragHeight);

      // Clean up
      const mu = new MouseEvent('mouseup', { clientX: 100, clientY: 100, bubbles: true });
      document.dispatchEvent(mu);
    });

    // ── Sensitivity configuration ──

    it('should have defaultMouseSensitivity set to 0.002', async () => {
      expect(controls.CONTROLS_CONFIG.defaultMouseSensitivity).toBe(0.002);
    });

    it('should have sensitivityMin set to 0.0002', async () => {
      expect(controls.CONTROLS_CONFIG.sensitivityMin).toBe(0.0002);
    });

    it('should have sensitivityMax set to 0.004', async () => {
      expect(controls.CONTROLS_CONFIG.sensitivityMax).toBe(0.004);
    });

    it('should have slider range 1–100', async () => {
      expect(controls.CONTROLS_CONFIG.sensitivitySliderMin).toBe(1);
      expect(controls.CONTROLS_CONFIG.sensitivitySliderMax).toBe(100);
    });

    it('should have sensitivitySliderBase set to 20', async () => {
      expect(controls.CONTROLS_CONFIG.sensitivitySliderBase).toBe(20);
    });

    it('should produce correct exponential mapping at slider endpoints', async () => {
      const cfg = controls.CONTROLS_CONFIG;
      // sliderMin (1) → sensitivityMin
      const minVal =
        cfg.sensitivityMin *
        Math.pow(
          cfg.sensitivitySliderBase,
          (cfg.sensitivitySliderMin - cfg.sensitivitySliderMin) /
            (cfg.sensitivitySliderMax - cfg.sensitivitySliderMin)
        );
      expect(minVal).toBe(cfg.sensitivityMin);

      // sliderMax (100) → sensitivityMax
      const maxVal =
        cfg.sensitivityMin *
        Math.pow(
          cfg.sensitivitySliderBase,
          (cfg.sensitivitySliderMax - cfg.sensitivitySliderMin) /
            (cfg.sensitivitySliderMax - cfg.sensitivitySliderMin)
        );
      expect(maxVal).toBeCloseTo(cfg.sensitivityMax, 6);

      // defaultMouseSensitivity should fall within the range
      expect(cfg.defaultMouseSensitivity).toBeGreaterThan(cfg.sensitivityMin);
      expect(cfg.defaultMouseSensitivity).toBeLessThan(cfg.sensitivityMax);

      // Verify the slider value that produces the default sensitivity
      const sliderForDefault =
        cfg.sensitivitySliderMin +
        ((cfg.sensitivitySliderMax - cfg.sensitivitySliderMin) *
          Math.log(cfg.defaultMouseSensitivity / cfg.sensitivityMin)) /
          Math.log(cfg.sensitivitySliderBase);
      expect(sliderForDefault).toBeGreaterThan(cfg.sensitivitySliderMin);
      expect(sliderForDefault).toBeLessThan(cfg.sensitivitySliderMax);
    });
  });

  // ── 2D board integration with camera mode ──

  describe('2D board save/restore on camera mode toggle', () => {
    let board2d;

    beforeEach(async () => {
      vi.clearAllMocks();
      vi.resetModules();
      mockPieceMeshes.length = 0;

      // Set up DOM with 2D board overlay
      document.body.innerHTML = `
        <div id="hud" class="hidden"></div>
        <div id="board-2d-overlay"><div id="board-2d-container"></div></div>
      `;

      // Mock ResizeObserver (not available in JSDOM)
      if (!globalThis.window.ResizeObserver) {
        globalThis.window.ResizeObserver = class {
          observe() {}
          unobserve() {}
          disconnect() {}
        };
      }

      // Re-import after reset
      network = await import('../../client/network.js');
      ui = await import('../../client/ui.js');
      board = await import('../../client/board.js');
      chess = await import('../../shared/chess.mjs');
      board2d = await import('../../client/board_2d.js');
      controls = await import('../../client/controls.js');
    });

    afterEach(() => {
      delete globalThis.__mockRaycasterResult;
    });

    it('toggleMouseMode hides 2D board on enter and restores on exit (mode 1)', async () => {
      const overlay = document.getElementById('board-2d-overlay');

      // Enter 2D board mode 1 (small)
      board2d.toggle2DBoard();
      expect(board2d.is2DBoardVisible()).toBe(true);
      expect(overlay.classList.contains('visible')).toBe(true);

      // Enter camera mode via toggleMouseMode
      controls.toggleMouseMode();
      expect(controls.mouseLookOn).toBe(true);
      expect(board2d.is2DBoardVisible()).toBe(false);
      expect(overlay.classList.contains('visible')).toBe(false);

      // Exit camera mode
      controls.toggleMouseMode();
      expect(controls.mouseLookOn).toBe(false);
      expect(board2d.is2DBoardVisible()).toBe(true);
      expect(overlay.classList.contains('visible')).toBe(true);
      expect(overlay.classList.contains('fullscreen')).toBe(false);
    });

    it('toggleMouseMode hides and restores 2D board from fullscreen (mode 2)', async () => {
      const overlay = document.getElementById('board-2d-overlay');

      // Enter 2D board mode 2 (fullscreen)
      board2d.toggle2DBoard(); // mode 1
      board2d.toggle2DBoard(); // mode 2
      expect(board2d.is2DBoardVisible()).toBe(true);
      expect(overlay.classList.contains('fullscreen')).toBe(true);

      // Enter camera mode
      controls.toggleMouseMode();
      expect(board2d.is2DBoardVisible()).toBe(false);
      expect(overlay.classList.contains('visible')).toBe(false);

      // Exit camera mode — should restore fullscreen
      controls.toggleMouseMode();
      expect(board2d.is2DBoardVisible()).toBe(true);
      expect(overlay.classList.contains('visible')).toBe(true);
      expect(overlay.classList.contains('fullscreen')).toBe(true);
    });

    it('toggleMouseMode handles 2D board off (mode 0) correctly', async () => {
      const overlay = document.getElementById('board-2d-overlay');

      // 2D board is off
      expect(board2d.is2DBoardVisible()).toBe(false);

      // Enter and exit camera mode
      controls.toggleMouseMode();
      expect(board2d.is2DBoardVisible()).toBe(false);

      controls.toggleMouseMode();
      expect(board2d.is2DBoardVisible()).toBe(false);
      expect(overlay.classList.contains('visible')).toBe(false);
    });

    it('pointerlockchange acquire hides 2D board and release restores it', async () => {
      const canvas = document.createElement('canvas');
      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: canvas };
      controls.setRenderer(renderer, camera);

      const overlay = document.getElementById('board-2d-overlay');

      // Enter 2D board mode 1
      board2d.toggle2DBoard();
      expect(board2d.is2DBoardVisible()).toBe(true);

      // Enter camera mode via toggleMouseMode (sets mouseLookOn)
      controls.toggleMouseMode();
      expect(controls.mouseLookOn).toBe(true);
      expect(board2d.is2DBoardVisible()).toBe(false);

      // Simulate pointer lock acquired
      Object.defineProperty(globalThis.document, 'pointerLockElement', {
        value: canvas,
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('pointerlockchange'));

      // Board should still be hidden (already hidden by toggleMouseMode)
      expect(board2d.is2DBoardVisible()).toBe(false);

      // Simulate pointer lock lost (ESC)
      Object.defineProperty(globalThis.document, 'pointerLockElement', {
        value: null,
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('pointerlockchange'));

      // mouseLookOn should be off and board restored
      expect(controls.mouseLookOn).toBe(false);
      expect(board2d.is2DBoardVisible()).toBe(true);
      expect(overlay.classList.contains('visible')).toBe(true);
    });

    it('pointerlockchange acquire auto-enters camera mode and hides 2D board', async () => {
      const canvas = document.createElement('canvas');
      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: canvas };
      controls.setRenderer(renderer, camera);

      const overlay = document.getElementById('board-2d-overlay');

      // Enter 2D board mode 1
      board2d.toggle2DBoard();
      expect(board2d.is2DBoardVisible()).toBe(true);

      // mouseLookOn is false, then pointer lock is acquired externally
      expect(controls.mouseLookOn).toBe(false);

      Object.defineProperty(globalThis.document, 'pointerLockElement', {
        value: canvas,
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('pointerlockchange'));

      // Should auto-enter camera mode and hide board
      expect(controls.mouseLookOn).toBe(true);
      expect(board2d.is2DBoardVisible()).toBe(false);
      expect(overlay.classList.contains('visible')).toBe(false);

      // Lose pointer lock
      Object.defineProperty(globalThis.document, 'pointerLockElement', {
        value: null,
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('pointerlockchange'));

      // Should restore board
      expect(controls.mouseLookOn).toBe(false);
      expect(board2d.is2DBoardVisible()).toBe(true);
    });

    it('pointerlockchange acquire/loss preserves mode 0 (off)', async () => {
      const canvas = document.createElement('canvas');
      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: canvas };
      controls.setRenderer(renderer, camera);

      const overlay = document.getElementById('board-2d-overlay');

      // 2D board is off (mode 0)
      expect(board2d.is2DBoardVisible()).toBe(false);

      // Acquire pointer lock — auto-enters camera mode
      Object.defineProperty(globalThis.document, 'pointerLockElement', {
        value: canvas,
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('pointerlockchange'));

      expect(controls.mouseLookOn).toBe(true);
      expect(board2d.is2DBoardVisible()).toBe(false);

      // Lose pointer lock — should restore to off
      Object.defineProperty(globalThis.document, 'pointerLockElement', {
        value: null,
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('pointerlockchange'));

      expect(controls.mouseLookOn).toBe(false);
      expect(board2d.is2DBoardVisible()).toBe(false);
      expect(overlay.classList.contains('visible')).toBe(false);
    });

    it('pointerlockchange acquire/loss preserves mode 2 (fullscreen)', async () => {
      const canvas = document.createElement('canvas');
      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: canvas };
      controls.setRenderer(renderer, camera);

      const overlay = document.getElementById('board-2d-overlay');

      // Enter 2D board mode 2 (fullscreen)
      board2d.toggle2DBoard(); // mode 1
      board2d.toggle2DBoard(); // mode 2
      expect(board2d.is2DBoardVisible()).toBe(true);
      expect(overlay.classList.contains('fullscreen')).toBe(true);

      // Acquire pointer lock — auto-enters camera mode, hides board
      Object.defineProperty(globalThis.document, 'pointerLockElement', {
        value: canvas,
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('pointerlockchange'));

      expect(controls.mouseLookOn).toBe(true);
      expect(board2d.is2DBoardVisible()).toBe(false);

      // Lose pointer lock — should restore fullscreen
      Object.defineProperty(globalThis.document, 'pointerLockElement', {
        value: null,
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('pointerlockchange'));

      expect(controls.mouseLookOn).toBe(false);
      expect(board2d.is2DBoardVisible()).toBe(true);
      expect(overlay.classList.contains('visible')).toBe(true);
      expect(overlay.classList.contains('fullscreen')).toBe(true);
    });
  });
});
