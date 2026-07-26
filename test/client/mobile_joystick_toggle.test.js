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

  it('should default to off', () => {
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
