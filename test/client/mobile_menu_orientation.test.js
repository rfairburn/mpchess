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
const mockOrientationLock = vi.fn().mockResolvedValue(true);

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

describe('mobile menu orientation', () => {
  let ui;

  beforeEach(async () => {
    vi.resetAllMocks();
    // Restore default implementations after reset
    mockRequestFullscreen.mockImplementation(() => {
      globalThis.__mockFullscreenElement = document.documentElement;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    });
    mockExitFullscreen.mockImplementation(() => {
      globalThis.__mockFullscreenElement = null;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    });
    mockOrientationLock.mockResolvedValue(true);

    // Reset fullscreen state
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

    // Mock Screen Orientation API
    Object.defineProperty(globalThis, 'screen', {
      value: { orientation: { type: 'landscape-primary', lock: mockOrientationLock } },
      writable: true,
      configurable: true,
    });

    // Mock mobile phone
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
    // Reset module state from previous test
    await ui.hideMenu();
  });

  afterEach(() => {
    globalThis.__mockFullscreenElement = null;
    delete globalThis.screen;
  });

  it('should lock portrait when menu opens on mobile', async () => {
    await ui.showMenu();

    expect(mockRequestFullscreen).toHaveBeenCalled();
    expect(mockOrientationLock).toHaveBeenCalledWith('portrait');
  });

  it('should restore prior orientation and exit fullscreen when menu closes', async () => {
    await ui.showMenu();
    vi.clearAllMocks();

    await ui.hideMenu();

    expect(mockOrientationLock).toHaveBeenCalledWith('landscape-primary');
    expect(mockExitFullscreen).toHaveBeenCalled();
  });

  it('should lock landscape when entering fullscreen outside menu', async () => {
    // Simulate user entering fullscreen via button (not via menu)
    globalThis.__mockFullscreenElement = document.documentElement;
    document.dispatchEvent(new Event('fullscreenchange'));

    expect(mockOrientationLock).toHaveBeenCalledWith('landscape');
  });

  it('should NOT lock landscape when entering fullscreen while menu is open', async () => {
    await ui.showMenu();
    vi.clearAllMocks();

    // showMenu entered fullscreen; hideMenu exited it. Re-enter for the test.
    globalThis.__mockFullscreenElement = document.documentElement;
    document.dispatchEvent(new Event('fullscreenchange'));

    // menuOpen is true, so landscape lock should NOT be called
    expect(mockOrientationLock).not.toHaveBeenCalledWith('landscape');
  });

  it('should release landscape lock when exiting fullscreen', async () => {
    // Enter fullscreen via the handler (sets gameLandscapeLocked)
    globalThis.__mockFullscreenElement = document.documentElement;
    document.dispatchEvent(new Event('fullscreenchange'));
    // Wait for the async lockOrientation .then() to set gameLandscapeLocked
    await vi.waitFor(() => {
      expect(mockOrientationLock).toHaveBeenCalledWith('landscape');
    });
    // Extra tick to ensure .then() callback has run
    await new Promise((r) => setTimeout(r, 10));

    vi.clearAllMocks();

    // Exit fullscreen
    globalThis.__mockFullscreenElement = null;
    document.dispatchEvent(new Event('fullscreenchange'));

    expect(mockOrientationLock).toHaveBeenCalled();
  });

  it('should update fullscreen button icon on fullscreenchange', async () => {
    const btn = document.getElementById('btn-fullscreen');

    globalThis.__mockFullscreenElement = document.documentElement;
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(btn.textContent).toBe('✕');

    globalThis.__mockFullscreenElement = null;
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(btn.textContent).toBe('⛶');
  });

  it('should skip orientation locking when screen.orientation.lock is unavailable', async () => {
    Object.defineProperty(globalThis.screen, 'orientation', {
      value: { type: 'landscape-primary' },
      writable: true,
      configurable: true,
    });

    await expect(ui.showMenu()).resolves.not.toThrow();
    await expect(ui.hideMenu()).resolves.not.toThrow();
  });

  it('should fall back gracefully when fullscreen is rejected', async () => {
    mockRequestFullscreen.mockRejectedValueOnce(new Error('Permission denied'));

    await expect(ui.showMenu()).resolves.not.toThrow();
    expect(mockOrientationLock).not.toHaveBeenCalled();
  });

  it('should not race landscape lock with deferred exitFullscreen', async () => {
    // Use a deferred promise so exitFullscreen doesn't resolve immediately.
    // This exercises the stale fullscreenElement window.
    let resolveExit;
    const deferredExit = new Promise((resolve) => {
      resolveExit = resolve;
    });
    mockExitFullscreen.mockImplementationOnce(() => {
      return deferredExit.then(() => {
        globalThis.__mockFullscreenElement = null;
        document.dispatchEvent(new Event('fullscreenchange'));
      });
    });

    await ui.showMenu();
    vi.clearAllMocks();

    // hideMenu awaits exitFullscreen, so landscape lock should NOT fire
    // while fullscreenElement is still stale
    const hidePromise = ui.hideMenu();

    // At this point, hideMenu has restored portrait orientation
    // and is awaiting exitFullscreen. It should NOT have locked landscape.
    expect(mockOrientationLock).toHaveBeenCalledWith('landscape-primary');
    expect(mockOrientationLock).not.toHaveBeenCalledWith('landscape');

    // Resolve the deferred exit
    resolveExit();
    await hidePromise;

    // Should still only have the portrait restore, no landscape lock
    expect(mockOrientationLock).toHaveBeenCalledWith('landscape-primary');
    expect(mockOrientationLock).not.toHaveBeenCalledWith('landscape');
  });

  it('should not set gameLandscapeLocked when fullscreen exits before landscape resolves', async () => {
    // Deferred landscape lock
    let resolveLandscape;
    const deferredLandscape = new Promise((resolve) => {
      resolveLandscape = resolve;
    });
    mockOrientationLock.mockImplementationOnce(() => deferredLandscape.then(() => true));

    // Enter fullscreen (triggers landscape lock)
    globalThis.__mockFullscreenElement = document.documentElement;
    document.dispatchEvent(new Event('fullscreenchange'));

    // Landscape lock is pending. Now exit fullscreen before it resolves.
    globalThis.__mockFullscreenElement = null;
    document.dispatchEvent(new Event('fullscreenchange'));

    // Resolve the deferred landscape lock — it should detect stale state
    // and restore 'any' orientation instead of setting gameLandscapeLocked
    resolveLandscape();
    await deferredLandscape;
    // Give microtask queue time to process the stale callback
    await new Promise((r) => setTimeout(r, 0));

    // The stale landscape lock should have been detected and 'any' restored
    expect(mockOrientationLock).toHaveBeenCalledWith('landscape');
    expect(mockOrientationLock).toHaveBeenCalledWith('any');
  });

  it('should not set gameLandscapeLocked when menu opens before landscape resolves', async () => {
    // Deferred landscape lock
    let resolveLandscape;
    const deferredLandscape = new Promise((resolve) => {
      resolveLandscape = resolve;
    });
    mockOrientationLock.mockImplementationOnce(() => deferredLandscape.then(() => true));

    // Enter fullscreen (triggers landscape lock)
    globalThis.__mockFullscreenElement = document.documentElement;
    document.dispatchEvent(new Event('fullscreenchange'));

    // Landscape lock is pending. Now open the menu before it resolves.
    await ui.showMenu();

    // Resolve the deferred landscape lock — stale callback should restore portrait
    resolveLandscape();
    await deferredLandscape;
    await new Promise((r) => setTimeout(r, 0));

    // Portrait must be the LAST orientation call (restored after stale landscape)
    expect(mockOrientationLock).toHaveBeenLastCalledWith('portrait');
    // Clean up
    await ui.hideMenu();
  });

  it('should not set gameLandscapeLocked when fullscreen exits before hideMenu landscape resolves', async () => {
    // Enter fullscreen independently (not via menu)
    globalThis.__mockFullscreenElement = document.documentElement;
    document.dispatchEvent(new Event('fullscreenchange'));
    await new Promise((r) => setTimeout(r, 0));

    // Open menu
    await ui.showMenu();
    vi.clearAllMocks();

    // Deferred landscape lock: only defer 'landscape' calls
    let resolveLandscape;
    const deferredLandscape = new Promise((resolve) => {
      resolveLandscape = resolve;
    });
    let landscapeDeferred = true;
    mockOrientationLock.mockImplementation((orientation) => {
      if (orientation === 'landscape' && landscapeDeferred) {
        landscapeDeferred = false;
        return deferredLandscape.then(() => true);
      }
      return Promise.resolve(true);
    });

    // hideMenu will call requestGameLandscape (deferred landscape)
    const hidePromise = ui.hideMenu();
    await new Promise((r) => setTimeout(r, 0));

    // Exit fullscreen before the landscape lock resolves
    globalThis.__mockFullscreenElement = null;
    document.dispatchEvent(new Event('fullscreenchange'));

    resolveLandscape();
    await hidePromise;
    await deferredLandscape;
    await new Promise((r) => setTimeout(r, 0));

    // Should have restored 'any' after stale landscape resolved
    expect(mockOrientationLock).toHaveBeenCalledWith('landscape');
    expect(mockOrientationLock).toHaveBeenCalledWith('any');
  });
});
