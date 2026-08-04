import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { setupControlsDOM } from './mobile-test-helpers.js';

// ── Module mocks ──────────────────────────────────────────

vi.mock('../../client/network.js', () => ({
  myRole: null,
  serverBoard: null,
  serverTurn: 'white',
  serverPromotingPiece: null,
  serverGameOver: false,
  castlingRights: { wK: true, wQ: true, bK: true, bQ: true },
  enPassantTarget: null,
  previousMove: null,
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
  settingsOpen: false,
  helpOpen: false,
  showMenu: vi.fn(),
  hideMenu: vi.fn(),
  updateMouseModeDisplay: vi.fn(),
  hidePromotionPicker: vi.fn(),
  hideConcedeConfirm: vi.fn(),
  mouseSensitivity: 0.002,
  showError: vi.fn(),
  setThreeScene: vi.fn(),
}));

vi.mock('../../client/board.js', () => ({
  squares: [],
  clearHighlights: vi.fn(),
  highlightSelected: vi.fn(),
  highlightValidMoves: vi.fn(),
  highlightCheck: vi.fn(),
  highlightPreviousMove: vi.fn(),
}));

vi.mock('../../shared/chess.mjs', () => ({
  pieceColor: vi.fn((piece) => (piece > 0 ? 'white' : 'black')),
  getValidMoves: vi.fn(() => []),
  findKing: vi.fn(() => null),
  isInCheck: vi.fn(() => false),
}));

vi.mock('../../client/pieces.js', () => ({
  setSvgPieceSet: vi.fn(),
  getModelSet: () => 'simple-classic',
  setModelSet: vi.fn(),
  SVG_PIECE_SETS: ['mpchess', 'maestro', 'dubrovny'],
  MODEL_SETS: ['simple-classic', 'low-poly', 'jeu'],
  getPieceSvgUrl(pieceId) {
    const f = {
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
    return `files/pieces/2d/mpchess/${f[pieceId]}.svg`;
  },
  pieceMeshes: [],
}));

// ── Helper: create a fresh module with given pointer-lock support ──

async function loadControls(withPointerLock) {
  vi.resetModules();
  setupControlsDOM();

  const spy = vi.fn();
  Object.defineProperty(HTMLCanvasElement.prototype, 'requestPointerLock', {
    value: withPointerLock ? spy : undefined,
    writable: true,
    configurable: true,
  });

  const controls = await import('../../client/controls.js');
  const ui = await import('../../client/ui.js');

  return { controls, ui, requestPointerLockSpy: spy };
}

// ── Tests ─────────────────────────────────────────────────

describe('controls.js — pointer lock behavior by API availability', () => {
  let pointerLockElement;
  let exitPointerLockSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    pointerLockElement = null;
    exitPointerLockSpy = vi.fn();

    Object.defineProperty(globalThis.document, 'pointerLockElement', {
      get: () => pointerLockElement,
      configurable: true,
    });

    Object.defineProperty(globalThis.document, 'exitPointerLock', {
      value: exitPointerLockSpy,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    delete globalThis.__mockRaycasterResult;
  });

  // ── iPadOS / touch-only: requestPointerLock not available ──

  describe('no requestPointerLock (iPadOS Safari/Chrome)', () => {
    it('should NOT call requestPointerLock when entering Camera Mode', async () => {
      const { controls, requestPointerLockSpy } = await loadControls(false);

      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: document.createElement('canvas') };
      controls.setRenderer(renderer, camera);

      controls.toggleMouseMode();

      expect(controls.mouseLookOn).toBe(true);
      expect(requestPointerLockSpy).not.toHaveBeenCalled();
    });

    it('should keep mouseLookOn true after pointerlockchange with no lock', async () => {
      const { controls } = await loadControls(false);

      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: document.createElement('canvas') };
      controls.setRenderer(renderer, camera);

      controls.toggleMouseMode();
      expect(controls.mouseLookOn).toBe(true);

      // pointerlockchange fires with no lock (lock was never available)
      pointerLockElement = null;
      document.dispatchEvent(new Event('pointerlockchange'));

      expect(controls.mouseLookOn).toBe(true);
    });

    it('should keep joystick visible after pointerlockchange', async () => {
      const { controls } = await loadControls(false);

      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: document.createElement('canvas') };
      controls.setRenderer(renderer, camera);

      controls.setJoystickEnabled(true);
      controls.toggleMouseMode();

      pointerLockElement = null;
      document.dispatchEvent(new Event('pointerlockchange'));

      expect(document.getElementById('virtual-joystick').classList.contains('visible')).toBe(true);
      expect(document.getElementById('virtual-look-area').classList.contains('visible')).toBe(true);
      expect(document.getElementById('vertical-joystick').classList.contains('visible')).toBe(true);
    });

    it('should NOT call requestPointerLock on canvas click in Camera Mode', async () => {
      const { controls, requestPointerLockSpy } = await loadControls(false);

      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: document.createElement('canvas') };
      controls.setRenderer(renderer, camera);
      controls.setClickHandler(renderer);

      controls.toggleMouseMode();

      const clickEvent = new MouseEvent('click', { bubbles: true });
      renderer.domElement.dispatchEvent(clickEvent);

      expect(requestPointerLockSpy).not.toHaveBeenCalled();
    });
  });

  // ── Desktop: requestPointerLock available ──

  describe('requestPointerLock available (desktop)', () => {
    it('should call requestPointerLock when entering Camera Mode', async () => {
      const { controls, requestPointerLockSpy } = await loadControls(true);

      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: document.createElement('canvas') };
      controls.setRenderer(renderer, camera);

      controls.toggleMouseMode();

      expect(controls.mouseLookOn).toBe(true);
      expect(requestPointerLockSpy).toHaveBeenCalledTimes(1);
    });

    it('should disable mouseLookOn when pointer lock is lost (ESC)', async () => {
      const { controls, ui } = await loadControls(true);

      const canvas = document.createElement('canvas');
      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: canvas };
      controls.setRenderer(renderer, camera);

      // Enter Camera Mode
      controls.toggleMouseMode();
      expect(controls.mouseLookOn).toBe(true);

      // Simulate lock acquired
      pointerLockElement = canvas;
      document.dispatchEvent(new Event('pointerlockchange'));

      // Simulate lock lost (ESC)
      pointerLockElement = null;
      document.dispatchEvent(new Event('pointerlockchange'));

      expect(controls.mouseLookOn).toBe(false);
      expect(ui.updateMouseModeDisplay).toHaveBeenCalledWith(false);
    });

    it('should enable mouseLookOn when pointer lock is acquired externally', async () => {
      const { controls, ui } = await loadControls(true);

      const canvas = document.createElement('canvas');
      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: canvas };
      controls.setRenderer(renderer, camera);

      expect(controls.mouseLookOn).toBe(false);

      pointerLockElement = canvas;
      document.dispatchEvent(new Event('pointerlockchange'));

      expect(controls.mouseLookOn).toBe(true);
      expect(ui.updateMouseModeDisplay).toHaveBeenCalledWith(true);
    });

    it('should call requestPointerLock on canvas click in Camera Mode', async () => {
      const { controls, requestPointerLockSpy } = await loadControls(true);

      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: document.createElement('canvas') };
      controls.setRenderer(renderer, camera);
      controls.setClickHandler(renderer);

      controls.toggleMouseMode();
      requestPointerLockSpy.mockClear(); // clear toggle call

      const clickEvent = new MouseEvent('click', { bubbles: true });
      renderer.domElement.dispatchEvent(clickEvent);

      expect(requestPointerLockSpy).toHaveBeenCalledTimes(1);
    });

    it('should call exitPointerLock when exiting Camera Mode with lock active', async () => {
      const { controls } = await loadControls(true);

      const canvas = document.createElement('canvas');
      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: canvas };
      controls.setRenderer(renderer, camera);

      controls.toggleMouseMode();

      pointerLockElement = canvas;
      document.dispatchEvent(new Event('pointerlockchange'));

      controls.toggleMouseMode();

      expect(exitPointerLockSpy).toHaveBeenCalled();
    });

    it('should not re-exit Camera Mode after stale unlock event (regression)', async () => {
      // Regression: acquire lock, manually toggle Camera Mode off,
      // receive the unlock event from exitPointerLock, then re-enter
      // Camera Mode without a successful lock. The stale
      // pointerLockAcquired flag must not cause a spurious exit.
      const { controls, ui } = await loadControls(true);

      const canvas = document.createElement('canvas');
      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: canvas };
      controls.setRenderer(renderer, camera);

      // 1. Enter Camera Mode
      controls.toggleMouseMode();
      expect(controls.mouseLookOn).toBe(true);

      // 2. Simulate lock acquired
      pointerLockElement = canvas;
      document.dispatchEvent(new Event('pointerlockchange'));

      // 3. Manually toggle Camera Mode off (calls exitPointerLock)
      controls.toggleMouseMode();
      expect(controls.mouseLookOn).toBe(false);

      // 4. Receive the unlock event from exitPointerLock
      pointerLockElement = null;
      document.dispatchEvent(new Event('pointerlockchange'));

      // mouseLookOn should still be false (not toggled by the event)
      expect(controls.mouseLookOn).toBe(false);

      // 5. Re-enter Camera Mode (no lock acquired, e.g. user dismissed)
      controls.toggleMouseMode();
      expect(controls.mouseLookOn).toBe(true);

      // 6. Another unlock event should NOT exit Camera Mode
      //    (pointerLockAcquired was cleared in step 4)
      pointerLockElement = null;
      document.dispatchEvent(new Event('pointerlockchange'));

      expect(controls.mouseLookOn).toBe(true);
    });
  });

  // ── Hybrid: coarse primary pointer, fine secondary, requestPointerLock available ──

  describe('hybrid device (pointer: coarse, any-pointer: fine, requestPointerLock available)', () => {
    beforeEach(() => {
      // Simulate a hybrid: coarse primary pointer (touchscreen),
      // fine pointer available (mouse), touch points present.
      Object.defineProperty(globalThis.navigator, 'maxTouchPoints', {
        value: 5,
        writable: true,
        configurable: true,
      });
      globalThis.window.matchMedia = vi.fn().mockImplementation((query) => {
        if (query === '(pointer: coarse)') return { matches: true };
        if (query === '(any-pointer: fine)') return { matches: true };
        return { matches: false };
      });
    });

    it('should call requestPointerLock when entering Camera Mode', async () => {
      const { controls, requestPointerLockSpy } = await loadControls(true);

      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: document.createElement('canvas') };
      controls.setRenderer(renderer, camera);

      controls.toggleMouseMode();

      expect(controls.mouseLookOn).toBe(true);
      expect(requestPointerLockSpy).toHaveBeenCalledTimes(1);
    });

    it('should disable mouseLookOn when pointer lock is lost on hybrid', async () => {
      const { controls, ui } = await loadControls(true);

      const canvas = document.createElement('canvas');
      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: canvas };
      controls.setRenderer(renderer, camera);

      controls.toggleMouseMode();
      expect(controls.mouseLookOn).toBe(true);

      // Lock acquired
      pointerLockElement = canvas;
      document.dispatchEvent(new Event('pointerlockchange'));

      // Lock lost (ESC)
      pointerLockElement = null;
      document.dispatchEvent(new Event('pointerlockchange'));

      expect(controls.mouseLookOn).toBe(false);
      expect(ui.updateMouseModeDisplay).toHaveBeenCalledWith(false);
    });

    it('should call requestPointerLock on canvas click for hybrid device', async () => {
      const { controls, requestPointerLockSpy } = await loadControls(true);

      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: document.createElement('canvas') };
      controls.setRenderer(renderer, camera);
      controls.setClickHandler(renderer);

      controls.toggleMouseMode();
      requestPointerLockSpy.mockClear();

      const clickEvent = new MouseEvent('click', { bubbles: true });
      renderer.domElement.dispatchEvent(clickEvent);

      expect(requestPointerLockSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ── Joystick visibility ──

  describe('joystick visibility', () => {
    it('should show joystick when in Camera Mode with joystick enabled', async () => {
      const { controls } = await loadControls(false);

      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: document.createElement('canvas') };
      controls.setRenderer(renderer, camera);

      controls.setJoystickEnabled(true);
      controls.toggleMouseMode();

      expect(document.getElementById('virtual-joystick').classList.contains('visible')).toBe(true);
    });

    it('should hide joystick when joystick is disabled', async () => {
      const { controls } = await loadControls(false);

      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: document.createElement('canvas') };
      controls.setRenderer(renderer, camera);

      controls.setJoystickEnabled(false);
      controls.toggleMouseMode();

      expect(document.getElementById('virtual-joystick').classList.contains('visible')).toBe(false);
    });

    it('should hide joystick when exiting Camera Mode', async () => {
      const { controls } = await loadControls(false);

      const camera = new THREE.PerspectiveCamera();
      const renderer = { domElement: document.createElement('canvas') };
      controls.setRenderer(renderer, camera);

      controls.setJoystickEnabled(true);
      controls.toggleMouseMode();
      expect(document.getElementById('virtual-joystick').classList.contains('visible')).toBe(true);

      controls.toggleMouseMode();
      expect(document.getElementById('virtual-joystick').classList.contains('visible')).toBe(false);
    });
  });
});
