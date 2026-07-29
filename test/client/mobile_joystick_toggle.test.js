import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import './mobile-mocks.js';
import {
  setupUIDOMWithJoystick,
  setupFullscreenMocks,
  setupMobileViewport,
  cleanupMobileMocks,
} from './mobile-test-helpers.js';

describe('M4.0 — joystick toggle', () => {
  let ui;
  let controls;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    setupUIDOMWithJoystick();
    setupFullscreenMocks();
    setupMobileViewport(390, 844);

    ui = await import('../../client/ui.js');
    controls = await import('../../client/controls.js');
    await ui.hideMenu();
  });

  afterEach(() => {
    cleanupMobileMocks();
  });

  it('should default to on for touch devices', () => {
    const toggle = document.getElementById('joystick-toggle');
    expect(toggle.checked).toBe(true);
  });

  it('should default to off for non-touch devices', async () => {
    vi.clearAllMocks();
    vi.resetModules();

    setupUIDOMWithJoystick();
    setupFullscreenMocks();
    // Simulate a desktop/non-touch device
    Object.defineProperty(globalThis.navigator, 'maxTouchPoints', {
      value: 0,
      writable: true,
      configurable: true,
    });
    globalThis.window.matchMedia = vi.fn().mockReturnValue({ matches: false });

    const freshUi = await import('../../client/ui.js');
    await freshUi.hideMenu();

    const toggle = document.getElementById('joystick-toggle');
    expect(toggle.checked).toBe(false);
  });

  it('should respect persisted false even on touch devices', async () => {
    vi.clearAllMocks();
    vi.resetModules();

    setupUIDOMWithJoystick();
    setupFullscreenMocks();
    setupMobileViewport(390, 844);

    // User previously turned joystick off
    localStorage.setItem('virtualJoystick', 'false');

    const freshUi = await import('../../client/ui.js');
    await freshUi.hideMenu();

    const toggle = document.getElementById('joystick-toggle');
    expect(toggle.checked).toBe(false);
  });

  it('should call setJoystickEnabled(true) when toggled on', () => {
    const toggle = document.getElementById('joystick-toggle');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));

    expect(controls.setJoystickEnabled).toHaveBeenCalledWith(true);
  });

  it('should call setJoystickEnabled(false) when toggled off', () => {
    const toggle = document.getElementById('joystick-toggle');
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));

    expect(controls.setJoystickEnabled).toHaveBeenCalledWith(false);
  });

  it('should persist toggle state to localStorage', () => {
    const toggle = document.getElementById('joystick-toggle');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));

    expect(localStorage.getItem('virtualJoystick')).toBe('true');
  });
});
