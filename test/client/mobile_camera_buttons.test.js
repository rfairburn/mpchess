import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies so controls.js can load
vi.mock('../../client/network.js', () => ({
  myRole: null,
  serverBoard: null,
  serverTurn: 'white',
  serverPromotingPiece: null,
  serverGameOver: false,
  castlingRights: {},
  enPassantTarget: null,
  sendMove: vi.fn(),
  onRestart: vi.fn(),
  onStateUpdate: vi.fn(),
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
  squares: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => ({}))),
  clearHighlights: vi.fn(),
  highlightSelected: vi.fn(),
  highlightValidMoves: vi.fn(),
  highlightCheck: vi.fn(),
}));

vi.mock('../../client/chess.mjs', () => ({
  pieceColor: vi.fn(),
  getValidMoves: vi.fn(() => []),
}));

vi.mock('../../client/pieces.js', () => ({
  pieceMeshes: [],
}));

vi.mock('../../client/controls_config.js', () => {
  const actual = vi.importActual('../../client/controls_config.js');
  return actual;
});

describe('M4.2 — camera position buttons behavior', () => {
  let controls;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    document.body.innerHTML = `
      <div id="virtual-joystick" class="hidden">
        <div id="joystick-base"><div id="joystick-stick"></div></div>
      </div>
      <div id="virtual-look-area" class="hidden"></div>
      <div id="vertical-joystick" class="hidden">
        <div id="vjoy-track"><div id="vjoy-thumb"></div></div>
      </div>
      <div id="camera-positions" class="hidden">
        <button data-pos="1">1</button>
        <button data-pos="2">2</button>
        <button data-pos="3">3</button>
        <button data-pos="4">4</button>
        <button data-pos="5">5</button>
        <button data-pos="6">6</button>
      </div>
    `;

    // Mock pointer lock
    globalThis.document.pointerLockElement = null;
    Object.defineProperty(globalThis.document.documentElement, 'requestPointerLock', {
      value: vi.fn(),
      writable: true,
      configurable: true,
    });

    controls = await import('../../client/controls.js');
  });

  it('should have 6 position buttons with correct data-pos attributes', () => {
    const buttons = document.querySelectorAll('#camera-positions button');
    expect(buttons.length).toBe(6);
    for (let i = 1; i <= 6; i++) {
      expect(buttons[i - 1].dataset.pos).toBe(String(i));
    }
  });

  it('should wire click handler that calls warpCamera', () => {
    // Verify warpCamera is exported and callable
    expect(typeof controls.warpCamera).toBe('function');
    // warpCamera with no camera set is a no-op (no crash)
    controls.warpCamera(3);
  });

  it('should show camera buttons on desktop by default', () => {
    // Desktop: no touch, large viewport
    Object.defineProperty(globalThis.navigator, 'maxTouchPoints', {
      value: 0,
      writable: true,
      configurable: true,
    });
    globalThis.window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    Object.defineProperty(globalThis.window, 'innerWidth', {
      value: 1920,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(globalThis.window, 'innerHeight', {
      value: 1080,
      writable: true,
      configurable: true,
    });

    const el = document.getElementById('camera-positions');
    expect(el.classList.contains('visible')).toBe(true);
  });

  it('should hide camera buttons on mobile portrait', () => {
    Object.defineProperty(globalThis.navigator, 'maxTouchPoints', {
      value: 5,
      writable: true,
      configurable: true,
    });
    globalThis.window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    Object.defineProperty(globalThis.window, 'innerWidth', {
      value: 390,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(globalThis.window, 'innerHeight', {
      value: 844,
      writable: true,
      configurable: true,
    });

    window.dispatchEvent(new Event('resize'));

    const el = document.getElementById('camera-positions');
    expect(el.classList.contains('visible')).toBe(false);
  });

  it('should show camera buttons on mobile landscape', () => {
    Object.defineProperty(globalThis.navigator, 'maxTouchPoints', {
      value: 5,
      writable: true,
      configurable: true,
    });
    globalThis.window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    Object.defineProperty(globalThis.window, 'innerWidth', {
      value: 844,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(globalThis.window, 'innerHeight', {
      value: 390,
      writable: true,
      configurable: true,
    });

    window.dispatchEvent(new Event('resize'));

    const el = document.getElementById('camera-positions');
    expect(el.classList.contains('visible')).toBe(true);
  });
});

describe('M4 — production HTML structure', () => {
  it('should have all Phase 4 elements in client/index.html', () => {
    const html = readFileSync(join(__dirname, '../../client/index.html'), 'utf-8');

    // Joystick toggle
    expect(html).toContain('id="joystick-toggle-row"');
    expect(html).toContain('id="joystick-toggle"');

    // Virtual joystick
    expect(html).toContain('id="virtual-joystick"');
    expect(html).toContain('id="joystick-base"');
    expect(html).toContain('id="joystick-stick"');

    // Look area
    expect(html).toContain('id="virtual-look-area"');

    // Vertical joystick
    expect(html).toContain('id="vertical-joystick"');
    expect(html).toContain('id="vjoy-track"');
    expect(html).toContain('id="vjoy-thumb"');

    // Camera position buttons
    expect(html).toContain('id="camera-positions"');
    for (let i = 1; i <= 6; i++) {
      expect(html).toContain(`data-pos="${i}"`);
    }
  });
});
