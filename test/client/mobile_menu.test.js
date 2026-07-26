import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const STYLE_CSS = readFileSync(resolve(__dirname, '../../client/style.css'), 'utf8');

// ── Top-level shared mock functions ──────────────────────
const mockRequestFullscreen = vi.fn().mockImplementation(() => {
  globalThis.__mockFullscreenElement = document.documentElement;
  document.dispatchEvent(new Event('fullscreenchange'));
  return Promise.resolve();
});
const mockExitFullscreen = vi.fn().mockImplementation(() => {
  globalThis.__mockFullscreenElement = null;
  document.dispatchEvent(new Event('fullscreenchange'));
  return Promise.resolve();
});
const mockOrientationLock = vi.fn().mockResolvedValue(undefined);

// ── Top-level module mocks ───────────────────────────────
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

function setupDOM() {
  document.body.innerHTML = `
    <div id="menu-overlay"><div id="menu-box"></div></div>
    <button id="btn-menu-toggle" aria-label="Menu"></button>
    <button id="btn-fullscreen" aria-label="Toggle fullscreen">⛶</button>
    <div id="hud" class="hidden"></div>
    <div id="role-badge"></div>
    <div id="player-count"></div>
    <div id="turn-indicator"></div>
    <div id="mouse-mode"></div>
    <div id="move-log"></div>
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

function setupDOMFixture() {
  setupDOM();
  // Mocks must be set AFTER setupDOM so they attach to the real documentElement
  globalThis.__mockFullscreenElement = null;
  Object.defineProperty(globalThis.document, 'fullscreenElement', {
    get: () => globalThis.__mockFullscreenElement || null,
    configurable: true,
  });
  Object.defineProperty(globalThis.document.documentElement, 'requestFullscreen', {
    value: mockRequestFullscreen,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis.document, 'exitFullscreen', {
    value: mockExitFullscreen,
    writable: true,
    configurable: true,
  });
}

function setupMobileViewport(width, height) {
  Object.defineProperty(globalThis, 'screen', {
    value: { orientation: { type: 'landscape-primary', lock: mockOrientationLock } },
    writable: true,
    configurable: true,
  });

  Object.defineProperty(globalThis.navigator, 'maxTouchPoints', {
    value: 5,
    writable: true,
    configurable: true,
  });
  globalThis.window.matchMedia = vi.fn().mockReturnValue({ matches: true });
  Object.defineProperty(globalThis.window, 'innerWidth', {
    value: width,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis.window, 'innerHeight', {
    value: height,
    writable: true,
    configurable: true,
  });
}

// ── Menu: orientation-neutral, synchronous ───────────────

describe('mobile menu — no fullscreen or orientation locking', () => {
  let ui;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    setupMobileViewport(390, 844); // portrait phone
    setupDOMFixture();

    ui = await import('../../client/ui.js');
  });

  afterEach(() => {
    globalThis.__mockFullscreenElement = null;
    delete globalThis.screen;
  });

  it('should open menu synchronously without requesting fullscreen', () => {
    ui.showMenu();

    expect(mockRequestFullscreen).not.toHaveBeenCalled();
    expect(mockOrientationLock).not.toHaveBeenCalled();
    expect(ui.menuOpen).toBe(true);
    expect(document.getElementById('menu-overlay').classList.contains('visible')).toBe(true);
  });

  it('should close menu synchronously without restoring orientation', () => {
    ui.showMenu();
    ui.hideMenu();

    expect(mockOrientationLock).not.toHaveBeenCalled();
    expect(mockExitFullscreen).not.toHaveBeenCalled();
    expect(ui.menuOpen).toBe(false);
    expect(document.getElementById('menu-overlay').classList.contains('visible')).toBe(false);
  });

  it('should not request orientation lock on rapid toggle', () => {
    ui.showMenu();
    ui.hideMenu();
    ui.showMenu();
    ui.hideMenu();
    ui.showMenu();

    expect(mockOrientationLock).not.toHaveBeenCalled();
    expect(mockRequestFullscreen).not.toHaveBeenCalled();
    expect(ui.menuOpen).toBe(true);
  });

  it('should remain deterministic after many rapid toggles', () => {
    for (let i = 0; i < 20; i++) {
      if (i % 2 === 0) {
        ui.showMenu();
        expect(ui.menuOpen).toBe(true);
      } else {
        ui.hideMenu();
        expect(ui.menuOpen).toBe(false);
      }
    }

    expect(mockOrientationLock).not.toHaveBeenCalled();
    expect(mockRequestFullscreen).not.toHaveBeenCalled();
  });

  it('should work on a landscape phone viewport', async () => {
    vi.resetModules();
    vi.clearAllMocks();

    setupMobileViewport(844, 390); // landscape phone
    setupDOMFixture();

    const landscapeUi = await import('../../client/ui.js');

    landscapeUi.showMenu();

    expect(mockRequestFullscreen).not.toHaveBeenCalled();
    expect(mockOrientationLock).not.toHaveBeenCalled();
    expect(landscapeUi.menuOpen).toBe(true);

    landscapeUi.hideMenu();
    expect(landscapeUi.menuOpen).toBe(false);
  });

  it('should constrain menu height and enable scrolling on landscape phone', async () => {
    vi.resetModules();
    vi.clearAllMocks();

    setupMobileViewport(844, 390); // landscape phone — short height
    setupDOMFixture();

    // Inject the actual stylesheet so JSDOM can compute styles
    document.head.innerHTML = `<style>${STYLE_CSS}</style>`;

    // Populate menu box with enough buttons to exceed 390px viewport height
    const menuBox = document.getElementById('menu-box');
    for (let i = 0; i < 15; i++) {
      const btn = document.createElement('button');
      btn.textContent = `Menu item ${i + 1}`;
      btn.style.cssText = 'display:block;width:100%;margin:10px 0;padding:14px 30px;';
      menuBox.appendChild(btn);
    }

    const lastBtn = menuBox.lastElementChild;

    const landscapeUi = await import('../../client/ui.js');
    landscapeUi.showMenu();

    const style = window.getComputedStyle(menuBox);

    // max-height must be set (90dvh), not 'none'
    const maxHeight = style.maxHeight;
    expect(maxHeight).not.toBe('none');
    expect(maxHeight).toMatch(/dvh|px/); // viewport-relative or resolved pixels

    // overflow-y must allow scrolling
    expect(style.overflowY).toBe('auto');

    // The last button must exist inside the scrollable container
    expect(menuBox.contains(lastBtn)).toBe(true);
  });

  it('should work when screen.orientation.lock is unavailable', async () => {
    vi.resetModules();
    vi.clearAllMocks();

    setupMobileViewport(390, 844);
    // No orientation lock API
    Object.defineProperty(globalThis, 'screen', {
      value: { orientation: { type: 'portrait-primary' } },
      writable: true,
      configurable: true,
    });
    setupDOMFixture();

    const noLockUi = await import('../../client/ui.js');

    expect(() => noLockUi.showMenu()).not.toThrow();
    expect(() => noLockUi.hideMenu()).not.toThrow();
    expect(noLockUi.menuOpen).toBe(false);
  });
});

// ── Fullscreen button and gameplay orientation ───────────

describe('fullscreen button and gameplay orientation', () => {
  let ui;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    setupMobileViewport(390, 844);
    setupDOMFixture();

    ui = await import('../../client/ui.js');
    ui.hideMenu();
  });

  afterEach(() => {
    globalThis.__mockFullscreenElement = null;
    delete globalThis.screen;
  });

  it('should call requestFullscreen when button is clicked', () => {
    const btn = document.getElementById('btn-fullscreen');
    btn.click();

    expect(mockRequestFullscreen).toHaveBeenCalled();
  });

  it('should call exitFullscreen when already in fullscreen', () => {
    globalThis.__mockFullscreenElement = document.documentElement;
    const btn = document.getElementById('btn-fullscreen');
    btn.click();

    expect(mockExitFullscreen).toHaveBeenCalled();
  });

  it('should update icon to exit symbol on fullscreen entry', () => {
    const btn = document.getElementById('btn-fullscreen');
    btn.click();

    expect(btn.textContent).toBe('✕');
    expect(btn.getAttribute('aria-label')).toBe('Exit fullscreen');
  });

  it('should update icon to enter symbol on fullscreen exit', () => {
    const btn = document.getElementById('btn-fullscreen');

    // Simulate fullscreen entry
    globalThis.__mockFullscreenElement = document.documentElement;
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(btn.textContent).toBe('✕');

    // Simulate fullscreen exit
    globalThis.__mockFullscreenElement = null;
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(btn.textContent).toBe('⛶');
    expect(btn.getAttribute('aria-label')).toBe('Toggle fullscreen');
  });

  it('should hide button when Fullscreen API is unavailable', async () => {
    vi.clearAllMocks();
    vi.resetModules();

    setupMobileViewport(390, 844);
    setupDOM();
    // Override requestFullscreen AFTER setupDOM so it applies to the real element
    Object.defineProperty(globalThis.document.documentElement, 'requestFullscreen', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    // Set up the rest of the fullscreen mocks
    globalThis.__mockFullscreenElement = null;
    Object.defineProperty(globalThis.document, 'fullscreenElement', {
      get: () => globalThis.__mockFullscreenElement || null,
      configurable: true,
    });
    Object.defineProperty(globalThis.document, 'exitFullscreen', {
      value: mockExitFullscreen,
      writable: true,
      configurable: true,
    });

    const freshUi = await import('../../client/ui.js');
    freshUi.hideMenu();

    const btn = document.getElementById('btn-fullscreen');
    expect(btn.style.display).toBe('none');
  });

  it('should lock landscape on gameplay fullscreen entry (mobile)', () => {
    // Simulate user-entered fullscreen
    globalThis.__mockFullscreenElement = document.documentElement;
    document.dispatchEvent(new Event('fullscreenchange'));

    expect(mockOrientationLock).toHaveBeenCalledWith('landscape');
  });

  it('should NOT lock landscape on desktop (non-mobile)', async () => {
    vi.clearAllMocks();
    vi.resetModules();

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

    Object.defineProperty(globalThis, 'screen', {
      value: { orientation: { type: 'landscape-primary', lock: mockOrientationLock } },
      writable: true,
      configurable: true,
    });

    setupDOMFixture();
    const desktopUi = await import('../../client/ui.js');
    desktopUi.hideMenu();

    globalThis.__mockFullscreenElement = document.documentElement;
    document.dispatchEvent(new Event('fullscreenchange'));

    expect(mockOrientationLock).not.toHaveBeenCalledWith('landscape');
  });
});
