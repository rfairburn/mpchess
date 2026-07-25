import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load the actual stylesheet so tests reflect real CSS
const cssText = readFileSync(join(__dirname, '../../client/style.css'), 'utf-8');

function loadCSS() {
  const style = document.createElement('style');
  style.textContent = cssText;
  document.head.appendChild(style);
}

function buildProductionDOM() {
  document.body.innerHTML = `
    <div id="move-log"></div>
    <div id="menu-overlay"><div id="menu-box"></div></div>
    <button id="btn-menu-toggle" aria-label="Menu"></button>
    <button id="btn-fullscreen" aria-label="Toggle fullscreen">⛶</button>
    <div id="hud" class="hidden"></div>
    <div id="role-badge"></div>
    <div id="player-count"></div>
    <div id="turn-indicator"></div>
    <div id="mouse-mode"></div>
    <div id="draw-info"></div>
    <div id="promo-overlay"><div id="promo-choices"><button data-type="queen"></button><button data-type="rook"></button><button data-type="bishop"></button><button data-type="knight"></button></div></div>
    <div id="concede-overlay"><div id="concede-box"><button id="btn-concede-confirm"></button><button id="btn-concede-cancel"></button></div></div>
    <div id="give-up-spot-overlay"><div id="give-up-spot-box"><button id="btn-give-up-spot-confirm"></button><button id="btn-give-up-spot-cancel"></button></div></div>
    <div id="draw-offer-overlay"><div id="draw-offer-box"><p id="draw-offer-text"></p><button id="btn-draw-accept"></button><button id="btn-draw-decline"></button></div></div>
    <div id="import-fen-overlay"><div id="import-fen-box"><textarea id="fen-input"></textarea><button id="btn-import-fen-confirm"></button><button id="btn-import-fen-cancel"></button></div></div>
    <div id="game-over-overlay"><div id="game-over-box"><p id="game-over-text"></p><button id="btn-new-game"></button></div></div>
    <div id="error-toast"></div>
    <div id="join-overlay"><div id="join-box"><button id="btn-join-white"></button><button id="btn-join-black"></button><button id="btn-join-spectator"></button></div></div>
    <div id="reconnecting-overlay"><div id="reconnecting-box"><button id="btn-give-up"></button></div></div>
    <div id="connection-error-overlay"><div id="connection-error-box"><button id="btn-retry-connection"></button></div></div>
    <div id="opponent-disconnected-banner"><button id="btn-drop-player"></button></div>
    <div id="second-disconnected-banner"></div>
    <div id="game-available-banner"><button id="btn-join-game"></button></div>
    <button id="btn-resume"></button>
    <button id="btn-give-up-spot"></button>
    <button id="btn-reconnect-as-player"></button>
    <button id="btn-restart"></button>
    <button id="btn-offer-draw"></button>
    <button id="btn-concede"></button>
    <button id="btn-export-fen"></button>
    <button id="btn-export-pgn"></button>
    <button id="btn-import-fen"></button>
    <div id="menu-computer-section" class="hidden"><select id="menu-computer-skill-dropdown"></select><button id="btn-menu-activate-computer"></button></div>
    <div id="menu-skill-change-section" class="hidden"><select id="menu-skill-change-dropdown"></select><button id="btn-menu-change-skill"></button></div>
    <div id="sensitivity-row"><input type="range" id="sensitivity-slider" /><span id="sensitivity-value"></span></div>
    <div id="btn-claim-draw" class="hidden"></div>
    <div id="captured-white"><span class="cap-pieces"></span></div>
    <div id="captured-black"><span class="cap-pieces"></span></div>
    <div id="computer-thinking"></div>
  `;
}

// ── CSS contract tests ──────────────────────────────────

describe('portrait HUD CSS contract', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.className = '';
    buildProductionDOM();
    loadCSS();
  });

  const nonessentialIds = [
    'role-badge',
    'turn-indicator',
    'player-count',
    'captured-white',
    'captured-black',
    'move-log',
    'draw-info',
    'btn-claim-draw',
    'hud',
    'computer-thinking',
  ];

  const essentialIds = ['btn-fullscreen', 'btn-menu-toggle', 'mouse-mode'];

  const overlayIds = [
    'join-overlay',
    'menu-overlay',
    'game-over-overlay',
    'promo-overlay',
    'concede-overlay',
    'give-up-spot-overlay',
    'draw-offer-overlay',
    'import-fen-overlay',
    'error-toast',
    'reconnecting-overlay',
    'connection-error-overlay',
    'opponent-disconnected-banner',
    'second-disconnected-banner',
    'game-available-banner',
  ];

  it('hides all nonessential HUD elements in portrait-mobile', () => {
    document.body.classList.add('portrait-mobile');

    for (const id of nonessentialIds) {
      const el = document.getElementById(id);
      expect(el, `Expected ${id} to exist in DOM`).not.toBeNull();
      expect(getComputedStyle(el).visibility, `${id} should be hidden`).toBe('hidden');
    }
  });

  it('keeps essential HUD elements visible in portrait-mobile', () => {
    document.body.classList.add('portrait-mobile');

    for (const id of essentialIds) {
      const el = document.getElementById(id);
      expect(el, `Expected ${id} to exist in DOM`).not.toBeNull();
      expect(getComputedStyle(el).visibility, `${id} should remain visible`).toBe('visible');
    }
  });

  it('keeps all overlays visible in portrait-mobile', () => {
    document.body.classList.add('portrait-mobile');

    for (const id of overlayIds) {
      const el = document.getElementById(id);
      expect(el, `Expected ${id} to exist in DOM`).not.toBeNull();
      expect(getComputedStyle(el).visibility, `${id} should remain visible`).toBe('visible');
    }
  });

  it('shows all nonessential HUD elements without portrait-mobile class', () => {
    // No portrait-mobile class
    for (const id of nonessentialIds) {
      const el = document.getElementById(id);
      expect(el, `Expected ${id} to exist in DOM`).not.toBeNull();
      expect(getComputedStyle(el).visibility, `${id} should be visible`).toBe('visible');
    }
  });

  it('declares portrait-mobile rules for all nonessential elements in CSS', () => {
    for (const id of nonessentialIds) {
      expect(cssText, `CSS should contain .portrait-mobile #${id} rule`).toContain(
        `.portrait-mobile #${id}`
      );
    }
  });

  it('does not declare portrait-mobile rules for essential elements in CSS', () => {
    for (const id of essentialIds) {
      expect(cssText, `CSS should NOT contain .portrait-mobile #${id} rule`).not.toContain(
        `.portrait-mobile #${id}`
      );
    }
  });

  it('does not declare portrait-mobile rules for overlays in CSS', () => {
    for (const id of overlayIds) {
      expect(cssText, `CSS should NOT contain .portrait-mobile #${id} rule`).not.toContain(
        `.portrait-mobile #${id}`
      );
    }
  });
});

// ── JS behavior tests ───────────────────────────────────

describe('portrait HUD JS behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    document.head.innerHTML = '';
    buildProductionDOM();
  });

  afterEach(() => {
    delete globalThis.screen;
  });

  function commonMocks() {
    vi.mock('../../client/network.js', () => ({
      myRole: null,
      serverBoard: null,
      serverTurn: 'white',
      serverPromotingPiece: null,
      serverGameOver: false,
      serverGameResult: null,
      moveHistory: [],
      seatStatus: {},
      tokenKey: () => '',
      halfmoveClock: 0,
      threefoldCount: 0,
      canClaimDraw: false,
      sendPromotion: vi.fn(),
      sendRestart: vi.fn(),
      sendConcede: vi.fn(),
      sendLeave: vi.fn(),
      sendExportFen: vi.fn(),
      sendExportPgn: vi.fn(),
      sendImportFen: vi.fn(),
      sendOfferDraw: vi.fn(),
      sendDrawResponse: vi.fn(),
      sendClaimDraw: vi.fn(),
      onStateUpdate: vi.fn(),
      onRestart: vi.fn(),
      onError: vi.fn(),
      onInfo: vi.fn(),
      onDrawOffer: vi.fn(),
      onDrawResult: vi.fn(),
      onDrawOfferCancelled: vi.fn(),
      onPlayerLeft: vi.fn(),
      onFenImportWarning: vi.fn(),
    }));

    vi.mock('../../client/controls.js', () => ({
      setCameraForRole: vi.fn(),
      toggleMouseMode: vi.fn(),
    }));

    vi.mock('../../client/dom_ref.js', () => ({
      domRef: vi.fn((id) => document.getElementById(id)),
      domRefOptional: vi.fn((id) => document.getElementById(id)),
      domRefQuery: vi.fn((sel) => document.querySelector(sel)),
    }));

    vi.mock('../../client/ui/toast.js', () => ({
      showError: vi.fn(),
      showInfo: vi.fn(),
      showWarning: vi.fn(),
    }));

    vi.mock('../../client/ui/disconnected.js', () => ({
      syncDisconnectedBanners: vi.fn(),
    }));

    vi.mock('../../client/ui/join.js', () => ({
      showJoinOverlay: vi.fn(),
      hideJoinOverlay: vi.fn(),
      updateJoinButtons: vi.fn(),
    }));

    vi.mock('../../client/ui/computer.js', () => ({
      updateMenuComputerSections: vi.fn(),
      initComputerMenu: vi.fn(() => {}),
    }));

    vi.mock('../../client/ui/connection.js', () => ({}));
  }

  it('adds portrait-mobile class on mobile in portrait orientation', async () => {
    commonMocks();

    Object.defineProperty(globalThis.navigator, 'maxTouchPoints', { value: 5, configurable: true });
    globalThis.window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    Object.defineProperty(globalThis.window, 'innerWidth', { value: 390, configurable: true });
    Object.defineProperty(globalThis.window, 'innerHeight', { value: 844, configurable: true });

    await import('../../client/ui.js');

    expect(document.body.classList.contains('portrait-mobile')).toBe(true);
  });

  it('does not add portrait-mobile class on mobile in landscape orientation', async () => {
    commonMocks();

    Object.defineProperty(globalThis.navigator, 'maxTouchPoints', { value: 5, configurable: true });
    globalThis.window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    Object.defineProperty(globalThis.window, 'innerWidth', { value: 844, configurable: true });
    Object.defineProperty(globalThis.window, 'innerHeight', { value: 390, configurable: true });

    await import('../../client/ui.js');

    expect(document.body.classList.contains('portrait-mobile')).toBe(false);
  });

  it('does not add portrait-mobile class on desktop regardless of orientation', async () => {
    commonMocks();

    Object.defineProperty(globalThis.navigator, 'maxTouchPoints', { value: 0, configurable: true });
    globalThis.window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    Object.defineProperty(globalThis.window, 'innerWidth', { value: 1080, configurable: true });
    Object.defineProperty(globalThis.window, 'innerHeight', { value: 1920, configurable: true });

    await import('../../client/ui.js');

    expect(document.body.classList.contains('portrait-mobile')).toBe(false);
  });

  it('removes portrait-mobile class when rotating from portrait to landscape', async () => {
    commonMocks();

    Object.defineProperty(globalThis.navigator, 'maxTouchPoints', { value: 5, configurable: true });
    globalThis.window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    Object.defineProperty(globalThis.window, 'innerWidth', { value: 390, configurable: true });
    Object.defineProperty(globalThis.window, 'innerHeight', { value: 844, configurable: true });

    await import('../../client/ui.js');

    expect(document.body.classList.contains('portrait-mobile')).toBe(true);

    Object.defineProperty(globalThis.window, 'innerWidth', { value: 844, configurable: true });
    Object.defineProperty(globalThis.window, 'innerHeight', { value: 390, configurable: true });

    window.dispatchEvent(new Event('resize'));

    expect(document.body.classList.contains('portrait-mobile')).toBe(false);
  });

  it('adds portrait-mobile class when rotating from landscape to portrait', async () => {
    commonMocks();

    Object.defineProperty(globalThis.navigator, 'maxTouchPoints', { value: 5, configurable: true });
    globalThis.window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    Object.defineProperty(globalThis.window, 'innerWidth', { value: 844, configurable: true });
    Object.defineProperty(globalThis.window, 'innerHeight', { value: 390, configurable: true });

    await import('../../client/ui.js');

    expect(document.body.classList.contains('portrait-mobile')).toBe(false);

    Object.defineProperty(globalThis.window, 'innerWidth', { value: 390, configurable: true });
    Object.defineProperty(globalThis.window, 'innerHeight', { value: 844, configurable: true });

    window.dispatchEvent(new Event('resize'));

    expect(document.body.classList.contains('portrait-mobile')).toBe(true);
  });

  it('does not affect tablet-sized devices (short edge > 768px)', async () => {
    commonMocks();

    Object.defineProperty(globalThis.navigator, 'maxTouchPoints', { value: 5, configurable: true });
    globalThis.window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    Object.defineProperty(globalThis.window, 'innerWidth', { value: 1024, configurable: true });
    Object.defineProperty(globalThis.window, 'innerHeight', { value: 1366, configurable: true });

    await import('../../client/ui.js');

    expect(document.body.classList.contains('portrait-mobile')).toBe(false);
  });
});
