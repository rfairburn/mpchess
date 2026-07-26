import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const STYLE_CSS = readFileSync(resolve(__dirname, '../../client/style.css'), 'utf8');

import './mobile-mocks.js';
import {
  setupUIFixture,
  setupUIDOM,
  setupFullscreenMocks,
  setupMobileViewport,
  cleanupMobileMocks,
  mockRequestFullscreen,
  mockExitFullscreen,
  mockOrientationLock,
} from './mobile-test-helpers.js';

// ── Menu: orientation-neutral, synchronous ───────────────

describe('mobile menu — no fullscreen or orientation locking', () => {
  let ui;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    setupUIFixture(390, 844);

    ui = await import('../../client/ui.js');
  });

  afterEach(() => {
    cleanupMobileMocks();
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

    setupUIFixture(844, 390);

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

    setupUIFixture(844, 390);

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

    setupUIFixture(390, 844);
    // No orientation lock API
    Object.defineProperty(globalThis, 'screen', {
      value: { orientation: { type: 'portrait-primary' } },
      writable: true,
      configurable: true,
    });

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

    setupUIFixture(390, 844);

    ui = await import('../../client/ui.js');
    ui.hideMenu();
  });

  afterEach(() => {
    cleanupMobileMocks();
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

    setupUIFixture(390, 844);
    // Override requestFullscreen AFTER setupUIFixture so it's not overwritten
    Object.defineProperty(globalThis.document.documentElement, 'requestFullscreen', {
      value: undefined,
      writable: true,
      configurable: true,
    });

    const freshUi = await import('../../client/ui.js');
    freshUi.hideMenu();

    const btn = document.getElementById('btn-fullscreen');
    expect(btn.style.display).toBe('none');
  });

  it('should NOT lock orientation on gameplay fullscreen entry (mobile)', () => {
    // Simulate user-entered fullscreen
    globalThis.__mockFullscreenElement = document.documentElement;
    document.dispatchEvent(new Event('fullscreenchange'));

    expect(mockOrientationLock).not.toHaveBeenCalled();
  });

  it('should NOT lock landscape on desktop (non-mobile)', async () => {
    vi.clearAllMocks();
    vi.resetModules();

    setupUIFixture(1920, 1080);

    const desktopUi = await import('../../client/ui.js');
    desktopUi.hideMenu();

    globalThis.__mockFullscreenElement = document.documentElement;
    document.dispatchEvent(new Event('fullscreenchange'));

    expect(mockOrientationLock).not.toHaveBeenCalledWith('landscape');
  });
});
