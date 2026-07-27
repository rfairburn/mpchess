// ═══════════════════════════════════════════════════════════
//  MOBILE TEST HELPERS — shared DOM fixtures, viewport setup,
//  fullscreen/orientation mocks, and mock factories for all
//  mobile test files.
// ═══════════════════════════════════════════════════════════

import { vi } from 'vitest';

// ── Fullscreen / orientation mock functions ────────────────

export const mockRequestFullscreen = vi.fn().mockImplementation(() => {
  globalThis.__mockFullscreenElement = document.documentElement;
  document.dispatchEvent(new Event('fullscreenchange'));
  return Promise.resolve();
});

export const mockExitFullscreen = vi.fn().mockImplementation(() => {
  globalThis.__mockFullscreenElement = null;
  document.dispatchEvent(new Event('fullscreenchange'));
  return Promise.resolve();
});

export const mockOrientationLock = vi.fn().mockResolvedValue(undefined);

// ── Shared DOM fixture fragments ──────────────────────────
// Both setupUIDOM and setupProductionDOM share these overlays,
// buttons, menu sections, and HUD elements. Defined once here
// to avoid duplication.

const OVERLAYS_HTML = `
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
`;

const MENU_BUTTONS_HTML = `
    <button id="btn-resume"></button>
    <button id="btn-give-up-spot"></button>
    <button id="btn-reconnect-as-player"></button>
    <button id="btn-restart"></button>
    <button id="btn-offer-draw"></button>
    <button id="btn-concede"></button>
    <button id="btn-export-fen"></button>
    <button id="btn-export-pgn"></button>
    <button id="btn-import-fen"></button>
`;

const MENU_SECTIONS_HTML = `
    <div id="menu-computer-section" class="hidden"><select id="menu-computer-skill-dropdown"></select><button id="btn-menu-activate-computer"></button></div>
    <div id="menu-skill-change-section" class="hidden"><select id="menu-skill-change-dropdown"></select><button id="btn-menu-change-skill"></button></div>
    <div id="sensitivity-row"><input type="range" id="sensitivity-slider" /><span id="sensitivity-value"></span></div>
`;

const HUD_ELEMENTS_HTML = `
    <div id="btn-claim-draw" class="hidden"></div>
    <div id="captured-white"><span class="cap-pieces"></span></div>
    <div id="captured-black"><span class="cap-pieces"></span></div>
    <div id="computer-thinking"></div>
`;

// ── DOM fixtures ──────────────────────────────────────────

// Standard UI DOM fixture used by fullscreen, joystick_toggle, menu tests.
// Does NOT include top-bar, status-drawer, or joystick elements.
export function setupUIDOM() {
  document.body.innerHTML = `
    <div id="menu-overlay"><div id="menu-box"></div></div>
    <button id="btn-menu-toggle" aria-label="Menu"></button>
    <button id="btn-sound" aria-label="Toggle sound">🔊</button>
    <button id="btn-fullscreen" aria-label="Toggle fullscreen">⛶</button>
    <div id="hud" class="hidden"></div>
    <div id="role-badge"></div>
    <div id="player-count"></div>
    <div id="turn-indicator"></div>
    <div id="mouse-mode"></div>
    <div id="move-log"></div>
    <div id="draw-info"></div>
    ${OVERLAYS_HTML}
    ${MENU_BUTTONS_HTML}
    ${MENU_SECTIONS_HTML}
    ${HUD_ELEMENTS_HTML}
  `;
}

// Extended UI DOM fixture with joystick toggle (for joystick_toggle tests).
export function setupUIDOMWithJoystick() {
  setupUIDOM();
  // Inject joystick toggle row after sensitivity row
  const sensitivityRow = document.getElementById('sensitivity-row');
  sensitivityRow.insertAdjacentHTML(
    'afterend',
    `
    <div id="joystick-toggle-row">
      <label for="joystick-toggle">Virtual Joystick</label>
      <label class="toggle-switch">
        <input type="checkbox" id="joystick-toggle" />
        <span class="toggle-slider"></span>
      </label>
    </div>
  `
  );
}

// Full production DOM fixture with top-bar, status-drawer, desktop-hud
// (for portrait_hud tests). Uses shared fragments for overlays, buttons,
// menu sections, and HUD elements.
export function setupProductionDOM() {
  document.body.innerHTML = `
    <div id="hud" class="hidden"></div>
    <div id="desktop-hud">
      <div id="computer-thinking"></div>
      <div id="move-log"></div>
      <div id="role-badge"></div>
      <div id="player-count"></div>
      <div id="turn-indicator"></div>
      <div id="mouse-mode"></div>
      <div id="draw-info"></div>
      <button id="btn-menu-toggle-desktop" aria-label="Menu"></button>
      <button id="btn-sound-desktop" aria-label="Toggle sound">🔊</button>
      <button id="btn-fullscreen-desktop" aria-label="Toggle fullscreen">⛶</button>
      <div id="btn-claim-draw" class="hidden"></div>
      <div id="captured-white"><span class="cap-pieces"></span></div>
      <div id="captured-black"><span class="cap-pieces"></span></div>
    </div>
    <div id="top-bar">
      <button id="btn-menu-toggle" aria-label="Menu"></button>
      <div id="top-bar-status">
        <span id="top-bar-role">Connecting...</span>
        <span id="top-bar-turn">⬤ White's Turn</span>
      </div>
      <div id="top-bar-controls">
        <button id="btn-mode-toggle" aria-label="Toggle mode">♟</button>
        <button id="btn-sound" aria-label="Toggle sound">🔊</button>
        <button id="btn-fullscreen" aria-label="Toggle fullscreen">⛶</button>
        <button id="btn-status-drawer" aria-label="Toggle status drawer">ℹ</button>
      </div>
    </div>
    <div id="status-drawer"><div id="status-drawer-content"></div></div>
    <div id="menu-overlay"><div id="menu-box"></div></div>
    ${OVERLAYS_HTML}
    ${MENU_BUTTONS_HTML}
    ${MENU_SECTIONS_HTML}
  `;
}

// Controls DOM fixture (for camera_buttons, joystick, pointer_lock tests).
export function setupControlsDOM() {
  document.body.innerHTML = `
    <div id="hud" class="hidden"></div>
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
}

// ── Viewport / capability setup ───────────────────────────

export function setupMobileViewport(width = 390, height = 844) {
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

export function setupDesktopViewport(width = 1920, height = 1080) {
  Object.defineProperty(globalThis.navigator, 'maxTouchPoints', {
    value: 0,
    writable: true,
    configurable: true,
  });
  globalThis.window.matchMedia = vi.fn().mockReturnValue({ matches: false });
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

// ── Fullscreen mock setup ─────────────────────────────────

export function setupFullscreenMocks() {
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

// ── Combined setup helpers ────────────────────────────────

// Full setup for UI tests: DOM + fullscreen mocks + mobile viewport.
export function setupUIFixture(width, height) {
  setupUIDOM();
  setupFullscreenMocks();
  setupMobileViewport(width, height);
}

// Cleanup after tests.
export function cleanupMobileMocks() {
  globalThis.__mockFullscreenElement = null;
  delete globalThis.screen;
}

// ── Fixture contract assertion ────────────────────────────
// Verify that setupUIDOM produces all required elements.
// Call once in a test to catch fixture regressions.
const REQUIRED_UIDOM_IDS = [
  'menu-overlay',
  'menu-box',
  'btn-menu-toggle',
  'btn-sound',
  'btn-fullscreen',
  'hud',
  'role-badge',
  'player-count',
  'turn-indicator',
  'mouse-mode',
  'move-log',
  'draw-info',
  'promo-overlay',
  'promo-choices',
  'concede-overlay',
  'concede-box',
  'btn-concede-confirm',
  'btn-concede-cancel',
  'give-up-spot-overlay',
  'give-up-spot-box',
  'btn-give-up-spot-confirm',
  'btn-give-up-spot-cancel',
  'draw-offer-overlay',
  'draw-offer-box',
  'draw-offer-text',
  'btn-draw-accept',
  'btn-draw-decline',
  'import-fen-overlay',
  'import-fen-box',
  'fen-input',
  'btn-import-fen-confirm',
  'btn-import-fen-cancel',
  'game-over-overlay',
  'game-over-box',
  'game-over-text',
  'btn-new-game',
  'error-toast',
  'join-overlay',
  'join-box',
  'btn-join-white',
  'btn-join-black',
  'btn-join-spectator',
  'reconnecting-overlay',
  'reconnecting-box',
  'btn-give-up',
  'connection-error-overlay',
  'connection-error-box',
  'btn-retry-connection',
  'opponent-disconnected-banner',
  'btn-drop-player',
  'second-disconnected-banner',
  'game-available-banner',
  'btn-join-game',
  'btn-resume',
  'btn-give-up-spot',
  'btn-reconnect-as-player',
  'btn-restart',
  'btn-offer-draw',
  'btn-concede',
  'btn-export-fen',
  'btn-export-pgn',
  'btn-import-fen',
  'menu-computer-section',
  'menu-computer-skill-dropdown',
  'btn-menu-activate-computer',
  'menu-skill-change-section',
  'menu-skill-change-dropdown',
  'btn-menu-change-skill',
  'sensitivity-row',
  'sensitivity-slider',
  'sensitivity-value',
  'btn-claim-draw',
  'captured-white',
  'captured-black',
  'computer-thinking',
];

export function assertUIDOMFixture() {
  for (const id of REQUIRED_UIDOM_IDS) {
    const el = document.getElementById(id);
    if (!el) {
      throw new Error(`setupUIDOM fixture missing required element: #${id}`);
    }
  }
}

// Production DOM fixture contract — verifies setupProductionDOM elements.
const REQUIRED_PRODUCTION_DOM_IDS = [
  ...REQUIRED_UIDOM_IDS.filter(
    // Production DOM uses different structure for some elements
    (id) =>
      ![
        'role-badge',
        'player-count',
        'turn-indicator',
        'mouse-mode',
        'move-log',
        'draw-info',
        'btn-claim-draw',
        'captured-white',
        'captured-black',
        'computer-thinking',
      ].includes(id)
  ),
  // Production-specific elements
  'desktop-hud',
  'btn-menu-toggle-desktop',
  'btn-sound-desktop',
  'btn-fullscreen-desktop',
  'top-bar',
  'top-bar-role',
  'top-bar-turn',
  'btn-mode-toggle',
  'btn-status-drawer',
  'status-drawer',
  'status-drawer-content',
];

export function assertProductionDOMFixture() {
  for (const id of REQUIRED_PRODUCTION_DOM_IDS) {
    const el = document.getElementById(id);
    if (!el) {
      throw new Error(`setupProductionDOM fixture missing required element: #${id}`);
    }
  }
}
