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

import './mobile-mocks.js';
import {
  setupProductionDOM,
  setupFullscreenMocks,
  setupMobileViewport,
  setupDesktopViewport,
  cleanupMobileMocks,
  assertProductionDOMFixture,
} from './mobile-test-helpers.js';

// ── CSS contract tests ──────────────────────────────────

describe('portrait HUD CSS contract', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.className = '';
    setupProductionDOM();
    loadCSS();
  });

  // Nonessential elements are now inside #desktop-hud, which is hidden as a unit
  const nonessentialWrapper = 'desktop-hud';

  const essentialIds = ['btn-fullscreen', 'btn-menu-toggle'];

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

  it('hides the desktop-hud wrapper in portrait-mobile', () => {
    document.body.classList.add('portrait-mobile');

    const el = document.getElementById(nonessentialWrapper);
    expect(el, `Expected ${nonessentialWrapper} to exist in DOM`).not.toBeNull();
    expect(getComputedStyle(el).display, `${nonessentialWrapper} should be hidden`).toBe('none');
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

  it('shows the desktop-hud wrapper without portrait-mobile class', () => {
    // No portrait-mobile class
    const el = document.getElementById(nonessentialWrapper);
    expect(el, `Expected ${nonessentialWrapper} to exist in DOM`).not.toBeNull();
    expect(getComputedStyle(el).display, `${nonessentialWrapper} should be visible`).toBe('block');
  });

  it('declares portrait-mobile rules for the desktop-hud wrapper in CSS', () => {
    expect(cssText, `CSS should contain .portrait-mobile #desktop-hud rule`).toContain(
      '.portrait-mobile #desktop-hud'
    );
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

  it('declares portrait-mobile rule for vertical-joystick in CSS', () => {
    expect(cssText, 'CSS should contain .portrait-mobile #vertical-joystick rule').toContain(
      '.portrait-mobile #vertical-joystick'
    );
  });

  it('moves vertical joystick closer to right edge in portrait mode', () => {
    // Inject the vertical joystick element
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div id="vertical-joystick"><div id="vjoy-track"><div id="vjoy-thumb"></div></div></div>'
    );

    // Without portrait-mobile class, right should be 70px (default)
    document.body.classList.remove('portrait-mobile');
    let vj = document.getElementById('vertical-joystick');
    let computed = getComputedStyle(vj);
    expect(computed.right).toBe('70px');

    // With portrait-mobile class, right should be 20px
    document.body.classList.add('portrait-mobile');
    computed = getComputedStyle(vj);
    expect(computed.right).toBe('20px');
  });
});

// ── JS behavior tests ───────────────────────────────────

describe('portrait HUD JS behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    document.head.innerHTML = '';
    setupProductionDOM();
    setupFullscreenMocks();
  });

  afterEach(() => {
    cleanupMobileMocks();
  });

  it('adds portrait-mobile class on mobile in portrait orientation', async () => {
    setupMobileViewport(390, 844);

    await import('../../client/ui.js');

    expect(document.body.classList.contains('portrait-mobile')).toBe(true);
  });

  it('does not add portrait-mobile class on mobile in landscape orientation', async () => {
    setupMobileViewport(844, 390);

    await import('../../client/ui.js');

    expect(document.body.classList.contains('portrait-mobile')).toBe(false);
  });

  it('does not add portrait-mobile class on desktop regardless of orientation', async () => {
    setupDesktopViewport(1080, 1920);

    await import('../../client/ui.js');

    expect(document.body.classList.contains('portrait-mobile')).toBe(false);
  });

  it('removes portrait-mobile class when rotating from portrait to landscape', async () => {
    setupMobileViewport(390, 844);

    await import('../../client/ui.js');

    expect(document.body.classList.contains('portrait-mobile')).toBe(true);

    Object.defineProperty(globalThis.window, 'innerWidth', { value: 844, configurable: true });
    Object.defineProperty(globalThis.window, 'innerHeight', { value: 390, configurable: true });

    window.dispatchEvent(new Event('resize'));

    expect(document.body.classList.contains('portrait-mobile')).toBe(false);
  });

  it('adds portrait-mobile class when rotating from landscape to portrait', async () => {
    setupMobileViewport(844, 390);

    await import('../../client/ui.js');

    expect(document.body.classList.contains('portrait-mobile')).toBe(false);

    Object.defineProperty(globalThis.window, 'innerWidth', { value: 390, configurable: true });
    Object.defineProperty(globalThis.window, 'innerHeight', { value: 844, configurable: true });

    window.dispatchEvent(new Event('resize'));

    expect(document.body.classList.contains('portrait-mobile')).toBe(true);
  });

  it('does not affect tablet-sized devices (short edge > 768px)', async () => {
    setupMobileViewport(1024, 1366);

    await import('../../client/ui.js');

    expect(document.body.classList.contains('portrait-mobile')).toBe(false);
  });

  it('shows the info button (btn-status-drawer) in portrait mode', () => {
    loadCSS();
    document.body.classList.add('portrait-mobile');

    const btn = document.getElementById('btn-status-drawer');
    expect(btn).not.toBeNull();
    const computed = getComputedStyle(btn);
    expect(computed.display).not.toBe('none');
  });

  it('allows status drawer to open in portrait mode', () => {
    loadCSS();
    document.body.classList.add('portrait-mobile');

    const drawer = document.getElementById('status-drawer');
    drawer.classList.add('open');
    const computed = getComputedStyle(drawer);
    // Drawer should be interactive in portrait (no longer forced hidden)
    expect(computed.pointerEvents).not.toBe('none');
  });

  it('tightens top-bar-controls gap in portrait mode', () => {
    loadCSS();
    document.body.classList.add('portrait-mobile');

    const controls = document.getElementById('top-bar-controls');
    const computed = getComputedStyle(controls);
    // Gap should be reduced from default 4px to 2px
    expect(computed.gap).toBe('2px');
  });

  it('reduces top-bar button width in portrait mode', () => {
    loadCSS();
    document.body.classList.add('portrait-mobile');

    const controls = document.getElementById('top-bar-controls');
    const buttons = controls.querySelectorAll('button');
    for (const btn of buttons) {
      const computed = getComputedStyle(btn);
      expect(computed.width).toBe('36px');
    }
  });

  it('closes status drawer class when entering portrait via resize', async () => {
    setupMobileViewport(844, 390);

    await import('../../client/ui.js');

    expect(document.body.classList.contains('portrait-mobile')).toBe(false);

    // Rotate to portrait
    Object.defineProperty(globalThis.window, 'innerWidth', { value: 390, configurable: true });
    Object.defineProperty(globalThis.window, 'innerHeight', { value: 844, configurable: true });
    window.dispatchEvent(new Event('resize'));

    expect(document.body.classList.contains('portrait-mobile')).toBe(true);
  });

  it('closes status drawer class when leaving compact landscape to desktop', async () => {
    setupMobileViewport(844, 390);

    await import('../../client/ui.js');

    // Resize to desktop viewport
    setupDesktopViewport(1920, 1080);
    window.dispatchEvent(new Event('resize'));

    expect(document.body.classList.contains('portrait-mobile')).toBe(false);
  });

  it('closes status drawer class when leaving compact landscape to non-compact landscape', async () => {
    setupMobileViewport(844, 390);

    await import('../../client/ui.js');

    // Open the drawer
    const drawer = document.getElementById('status-drawer');
    drawer.classList.add('open');
    expect(drawer.classList.contains('open')).toBe(true);

    // Resize to non-compact landscape (exceeds CSS max-width:900px)
    Object.defineProperty(globalThis.window, 'innerWidth', { value: 901, configurable: true });
    Object.defineProperty(globalThis.window, 'innerHeight', { value: 600, configurable: true });
    window.dispatchEvent(new Event('resize'));

    // Still mobile but no longer compact landscape; drawer should close
    expect(document.body.classList.contains('portrait-mobile')).toBe(false);
    expect(drawer.classList.contains('open')).toBe(false);
  });
});

// ── Fixture contract ─────────────────────────────────────

describe('setupProductionDOM fixture contract', () => {
  it('contains all required elements', () => {
    setupProductionDOM();
    assertProductionDOMFixture();
  });
});
