import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import './mobile-mocks.js';
import {
  setupUIFixture,
  setupUIDOM,
  cleanupMobileMocks,
  mockRequestFullscreen,
  mockExitFullscreen,
  mockOrientationLock,
  assertUIDOMFixture,
} from './mobile-test-helpers.js';

describe('mobile fullscreen button', () => {
  let ui;

  beforeEach(async () => {
    vi.clearAllMocks();

    setupUIFixture(390, 844);

    ui = await import('../../client/ui.js');
    await ui.hideMenu();
  });

  afterEach(() => {
    cleanupMobileMocks();
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

    setupUIFixture(390, 844);
    // Override requestFullscreen AFTER setupUIFixture so it's not overwritten
    Object.defineProperty(globalThis.document.documentElement, 'requestFullscreen', {
      value: undefined,
      writable: true,
      configurable: true,
    });

    const freshUi = await import('../../client/ui.js');
    await freshUi.hideMenu();

    const btn = document.getElementById('btn-fullscreen');
    expect(btn.style.display).toBe('none');
  });

  it('should NOT lock landscape on desktop (non-mobile)', async () => {
    vi.clearAllMocks();
    vi.resetModules();

    setupUIFixture(1920, 1080);
    // Override to desktop after setupUIFixture (which sets mobile viewport)
    Object.defineProperty(globalThis.navigator, 'maxTouchPoints', {
      value: 0,
      writable: true,
      configurable: true,
    });
    globalThis.window.matchMedia = vi.fn().mockReturnValue({ matches: false });

    const desktopUi = await import('../../client/ui.js');
    await desktopUi.hideMenu();

    // Enter fullscreen
    globalThis.__mockFullscreenElement = document.documentElement;
    document.dispatchEvent(new Event('fullscreenchange'));

    // Should NOT lock landscape on desktop
    expect(mockOrientationLock).not.toHaveBeenCalledWith('landscape');
  });
});

// ── Fixture contract ─────────────────────────────────────

describe('setupUIDOM fixture contract', () => {
  it('contains all required elements', () => {
    setupUIDOM();
    assertUIDOMFixture();
  });
});
