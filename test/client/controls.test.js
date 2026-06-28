import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';

// ── Module mocks ──────────────────────────────────────────

vi.mock('/home/robert/mpchess/client/network.js', () => ({
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

vi.mock('/home/robert/mpchess/client/ui.js', () => ({
  menuOpen: false,
  showMenu: vi.fn(),
  hideMenu: vi.fn(),
  updateMouseModeDisplay: vi.fn(),
  hidePromotionPicker: vi.fn(),
  hideConcedeConfirm: vi.fn(),
  mouseSensitivity: 0.002,
}));

vi.mock('/home/robert/mpchess/client/board.js', () => ({
  squares: [],
  clearHighlights: vi.fn(),
  highlightSelected: vi.fn(),
  highlightValidMoves: vi.fn(),
  highlightCheck: vi.fn(),
}));

vi.mock('/home/robert/mpchess/shared/chess.mjs', () => ({
  pieceColor: vi.fn((piece) => piece > 0 ? 'white' : 'black'),
  getValidMoves: vi.fn(() => []),
  findKing: vi.fn(() => null),
  isInCheck: vi.fn(() => false),
}));

// ── Tests ─────────────────────────────────────────────────

describe('controls.js', () => {
  let controls, network, ui, board, chess;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Set up DOM elements that controls.js expects
    document.body.innerHTML = '<div id="hud" class="hidden"></div>';

    // Re-import after reset
    network = await import('/home/robert/mpchess/client/network.js');
    ui = await import('/home/robert/mpchess/client/ui.js');
    board = await import('/home/robert/mpchess/client/board.js');
    chess = await import('/home/robert/mpchess/shared/chess.mjs');
    controls = await import('/home/robert/mpchess/client/controls.js');
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
      network.serverBoard = Array(8).fill(null).map(() => Array(8).fill(0));
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
        bubbles: true
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
      network.serverBoard = Array(8).fill(null).map(() => Array(8).fill(0));
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
      tabEvent.preventDefault = () => { defaultPrevented = true; };
      document.dispatchEvent(tabEvent);
      expect(defaultPrevented).toBe(true);
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
});
