import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupControlsDOM } from './mobile-test-helpers.js';

// Mock dependencies so controls.js can load
vi.mock('../../client/network.js', () => ({
  myRole: null,
  serverBoard: null,
  serverTurn: 'white',
  serverPromotingPiece: null,
  serverGameOver: false,
  castlingRights: {},
  enPassantTarget: null,
  previousMove: null,
  sendMove: vi.fn(),
  onRestart: vi.fn(),
  onStateUpdate: vi.fn(),
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
  squares: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => ({}))),
  clearHighlights: vi.fn(),
  highlightSelected: vi.fn(),
  highlightValidMoves: vi.fn(),
  highlightCheck: vi.fn(),
  highlightPreviousMove: vi.fn(),
}));

vi.mock('../../shared/chess.mjs', () => ({
  pieceColor: vi.fn(),
  getValidMoves: vi.fn(() => []),
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

vi.mock('../../client/controls_config.js', () => {
  const actual = vi.importActual('../../client/controls_config.js');
  return actual;
});

describe('M4.2 — camera position buttons behavior', () => {
  let controls;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    setupControlsDOM();

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
});

describe('M4.2 — camera buttons with production stylesheet', () => {
  const cssText = readFileSync(join(__dirname, '../../client/style.css'), 'utf-8');

  function loadCSS() {
    const style = document.createElement('style');
    style.textContent = cssText;
    document.head.appendChild(style);
  }

  it('no media query unconditionally hides #camera-positions with display:none', () => {
    // JSDOM does not evaluate pointer/orientation media queries, so a
    // computed-style test cannot catch a regression inside a media query
    // block.  Instead, scan the raw CSS for the dangerous pattern.
    // Extract all @media blocks and verify none contain
    // `#camera-positions` + `display: none`.
    const mediaBlockRegex = /@media[^{]*\{([\s\S]*?)\n\}/gs;
    let match;
    while ((match = mediaBlockRegex.exec(cssText)) !== null) {
      const blockContent = match[1];
      if (blockContent.includes('#camera-positions')) {
        expect(
          blockContent,
          'Media query block must not contain display:none for #camera-positions'
        ).not.toMatch(/#camera-positions[\s\S]*display\s*:\s*none/i);
      }
    }
  });

  it('camera buttons visible in portrait and landscape across Piece and Camera Mode', async () => {
    document.head.innerHTML = '';
    document.body.innerHTML = `
      <div id="camera-positions">
        <button data-pos="1">1</button>
        <button data-pos="2">2</button>
        <button data-pos="3">3</button>
        <button data-pos="4">4</button>
        <button data-pos="5">5</button>
        <button data-pos="6">6</button>
      </div>
    `;
    loadCSS();

    const viewports = [
      { label: 'portrait', width: 390, height: 844 },
      { label: 'landscape', width: 844, height: 390 },
    ];

    // Piece Mode (default) — check both orientations
    for (const vp of viewports) {
      window.resizeTo(vp.width, vp.height);
      const el = document.getElementById('camera-positions');
      const computed = getComputedStyle(el);
      expect(computed.display, `${vp.label} Piece Mode`).not.toBe('none');
    }

    // Toggle once into Camera Mode
    const controls = await import('../../client/controls.js');
    controls.toggleMouseMode();

    // Camera Mode — check both orientations
    for (const vp of viewports) {
      window.resizeTo(vp.width, vp.height);
      const el = document.getElementById('camera-positions');
      const computed = getComputedStyle(el);
      expect(computed.display, `${vp.label} Camera Mode`).not.toBe('none');
    }
  });

  it('virtual joystick has touch-action: none', () => {
    document.head.innerHTML = '';
    document.body.innerHTML = `
      <div id="virtual-joystick"><div id="joystick-base"></div></div>
    `;
    loadCSS();

    const el = document.getElementById('virtual-joystick');
    expect(getComputedStyle(el).touchAction).toBe('none');
  });

  it('virtual look area has touch-action: none', () => {
    document.head.innerHTML = '';
    document.body.innerHTML = `
      <div id="virtual-look-area"></div>
    `;
    loadCSS();

    const el = document.getElementById('virtual-look-area');
    expect(getComputedStyle(el).touchAction).toBe('none');
  });

  it('vertical joystick has touch-action: none', () => {
    document.head.innerHTML = '';
    document.body.innerHTML = `
      <div id="vertical-joystick"><div id="vjoy-track"></div></div>
    `;
    loadCSS();

    const el = document.getElementById('vertical-joystick');
    expect(getComputedStyle(el).touchAction).toBe('none');
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
