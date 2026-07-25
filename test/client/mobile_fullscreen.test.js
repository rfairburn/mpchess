import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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

describe('mobile fullscreen button', () => {
  let ui;

  beforeEach(async () => {
    vi.clearAllMocks();

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

    Object.defineProperty(globalThis, 'screen', {
      value: { orientation: { type: 'landscape-primary', lock: mockOrientationLock } },
      writable: true,
      configurable: true,
    });

    // Mobile phone
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

    setupDOM();

    ui = await import('../../client/ui.js');
    await ui.hideMenu();
  });

  afterEach(() => {
    globalThis.__mockFullscreenElement = null;
    delete globalThis.screen;
  });

  it('should call requestFullscreen when button is clicked', async () => {
    const btn = document.getElementById('btn-fullscreen');
    btn.click();

    expect(mockRequestFullscreen).toHaveBeenCalled();
  });

  it('should call exitFullscreen when already in fullscreen', async () => {
    globalThis.__mockFullscreenElement = document.documentElement;
    const btn = document.getElementById('btn-fullscreen');
    btn.click();

    expect(mockExitFullscreen).toHaveBeenCalled();
  });

  it('should update icon to exit symbol on fullscreen entry', async () => {
    const btn = document.getElementById('btn-fullscreen');
    btn.click();

    expect(btn.textContent).toBe('✕');
    expect(btn.getAttribute('aria-label')).toBe('Exit fullscreen');
  });

  it('should update icon to enter symbol on fullscreen exit', async () => {
    const btn = document.getElementById('btn-fullscreen');
    btn.click(); // enter
    expect(btn.textContent).toBe('✕');

    btn.click(); // exit
    expect(btn.textContent).toBe('⛶');
    expect(btn.getAttribute('aria-label')).toBe('Toggle fullscreen');
  });

  it('should hide button when Fullscreen API is unavailable', async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // No Fullscreen API
    Object.defineProperty(globalThis.document.documentElement, 'requestFullscreen', {
      value: undefined,
      writable: true,
      configurable: true,
    });

    setupDOM();
    const freshUi = await import('../../client/ui.js');
    await freshUi.hideMenu();

    const btn = document.getElementById('btn-fullscreen');
    expect(btn.style.display).toBe('none');
  });

  it('should NOT lock landscape on desktop (non-mobile)', async () => {
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

    setupDOM();
    const desktopUi = await import('../../client/ui.js');
    await desktopUi.hideMenu();

    // Enter fullscreen
    globalThis.__mockFullscreenElement = document.documentElement;
    document.dispatchEvent(new Event('fullscreenchange'));

    // Should NOT lock landscape on desktop
    expect(mockOrientationLock).not.toHaveBeenCalledWith('landscape');
  });
});
